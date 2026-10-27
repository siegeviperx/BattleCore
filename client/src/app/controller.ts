// Wires the game state, 3D board, HUD, AI and online client together. Owns turn flow; holds no rendering or DOM code.
import type { GameOverReason, GameResult, ServerMessage, Snapshot } from '../../../shared/protocol';
import type { Engine } from '../ai/types';
import { Game, type PlayedMove } from '../core/game';
import type { Color, MoveTarget, Square } from '../core/types';
import data from '../data/pieces.json';
import { OnlineClient, type ConnectionState } from '../net/client';
import type { BoardView } from '../render/types';
import type { Hud, MenuChoice, OnlineRequest } from '../ui/types';

/** Minimum time the AI appears to think, so its replies don't feel instant. */
const MIN_AI_DELAY_MS = 450;

const RESULT_TEXT: Record<GameOverReason, string> = {
  checkmate: 'by checkmate.',
  resign: 'by resignation.',
  abandon: 'Their opponent abandoned the battlefield.',
  stalemate: 'Stalemate: nobody can move.',
  repetition: 'Draw by threefold repetition.',
  insufficient: 'Not enough troops left to win.',
  'fifty-move': 'Draw by the fifty-move rule.',
  agreement: 'Both sides agreed to a truce.',
};

const factionName = (c: Color) => data.factions[c].name;
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

interface OnlineSession {
  net: OnlineClient;
  side: Color | null;
  started: boolean;
  over: boolean;
}

export class Controller {
  private game = new Game();
  private choice: MenuChoice = { mode: 'local', autoRotate: true, fights: 'full' };
  private selected: Square | null = null;
  private targets: MoveTarget[] = [];
  private animating = false;
  private inMenu = false;
  private aiToken = 0;
  private viewSide: Color = 'w';
  private online: OnlineSession | null = null;
  /** Serialises move animations so moves arriving from the network never overlap. */
  private animQueue: Promise<void> = Promise.resolve();

  constructor(
    private board: BoardView,
    private hud: Hud,
    private engine: Engine,
  ) {
    board.onSquareClick((sq) => this.onSquareClick(sq));
    hud.onUndo(() => this.undo());
    hud.onFlip(() => this.setView(other(this.viewSide), true));
    hud.onMenu(() => void this.openMenu());
    hud.onResign(() => this.online?.net.send({ t: 'resign' }));
    hud.onOfferDraw(() => {
      if (!this.online?.started || this.online.over) return;
      this.online.net.send({ t: 'offerDraw' });
      this.hud.showBanner('Truce offered', 'info');
    });
  }

  async start(): Promise<void> {
    this.board.setPosition(this.game.pieces());
    await this.openMenu();
  }

  private async openMenu(): Promise<void> {
    if (this.inMenu) return;
    this.inMenu = true;
    this.stopAi();
    this.leaveOnline();
    this.choice = await this.hud.showMenu();
    this.inMenu = false;
    this.board.setFightMode(this.choice.fights);
    if (this.choice.mode === 'online' && this.choice.online) void this.startOnline(this.choice.online);
    else this.newGame();
  }

  private newGame(fen?: string): void {
    this.stopAi();
    this.game = new Game(fen);
    this.clearSelection();
    this.board.setPosition(this.game.pieces());
    this.board.setLastMove(null, null);
    this.board.setCheck(null);
    this.setView(this.humanSide() ?? 'w', true);
    this.refreshHud();
    void this.maybeAiMove();
  }

  /** The side the local player controls, or null if they control both (local 2P). */
  private humanSide(): Color | null {
    if (this.choice.mode === 'ai') return this.choice.humanColor ?? 'w';
    if (this.choice.mode === 'online') return this.online?.side ?? null;
    return null;
  }

  private isHumanTurn(): boolean {
    if (this.choice.mode === 'online' && (!this.online?.started || this.online.over)) return false;
    const side = this.humanSide();
    return side === null || this.game.turn === side;
  }

  private onSquareClick(square: Square): void {
    if (this.animating || this.inMenu || !this.isHumanTurn() || this.game.outcome().over) return;
    if (this.selected && this.targets.some((t) => t.square === square)) {
      void this.humanMove(this.selected, square);
      return;
    }
    const piece = this.game.pieceAt(square);
    if (piece && piece.color === this.game.turn && square !== this.selected) {
      this.selected = square;
      this.targets = this.game.legalTargets(square);
      this.board.setSelection(square, this.targets);
    } else {
      this.clearSelection();
    }
  }

  private async humanMove(from: Square, to: Square): Promise<void> {
    const promotion = this.game.isPromotion(from, to)
      ? await this.hud.choosePromotion(this.game.turn)
      : undefined;
    const played = this.game.move(from, to, promotion);
    this.clearSelection();
    if (!played) return;
    // Online: apply locally right away; the server's echo of this move is ignored as an ack.
    this.online?.net.send({ t: 'move', uci: played.uci, ply: this.game.ply - 1 });
    await this.play(played);
  }

  private play(played: PlayedMove): Promise<void> {
    this.animQueue = this.animQueue.then(async () => {
      this.animating = true;
      this.hud.setUndoEnabled(false);
      this.board.setCheck(null);
      await this.board.animateMove(played.anim);
      this.animating = false;
      this.afterMove();
    });
    return this.animQueue;
  }

  private afterMove(): void {
    this.syncBoardMarks();
    this.refreshHud();
    const outcome = this.game.outcome();
    // Online results come from the server's gameOver message instead.
    if (outcome.over && !this.online) {
      void this.showResult(
        outcome.reason === 'checkmate'
          ? { winner: outcome.winner, reason: 'checkmate' }
          : { winner: 'draw', reason: outcome.reason },
      );
      return;
    }
    if (outcome.over) return;
    if (this.game.checkSquare()) this.hud.showBanner('CHECK!', 'check');
    if (this.choice.mode === 'local' && this.choice.autoRotate) this.setView(this.game.turn, true);
    void this.maybeAiMove();
  }

  private async maybeAiMove(): Promise<void> {
    if (this.choice.mode !== 'ai' || this.isHumanTurn() || this.game.outcome().over) return;
    const token = ++this.aiToken;
    this.hud.setThinking(true);
    const started = performance.now();
    try {
      const result = await this.engine.think({
        fen: this.game.startFen,
        history: this.game.uciHistory(),
        level: this.choice.level ?? 'medium',
      });
      const wait = MIN_AI_DELAY_MS - (performance.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (token !== this.aiToken) return;
      this.hud.setThinking(false);
      const played = this.game.moveUci(result.move);
      if (!played) throw new Error(`AI returned illegal move ${result.move}`);
      await this.play(played);
    } catch (err) {
      if (token === this.aiToken) {
        this.hud.setThinking(false);
        console.error(err);
        this.hud.showBanner('AI malfunction!', 'info');
      }
    }
  }

  private stopAi(): void {
    this.aiToken++;
    this.engine.cancel();
    this.hud.setThinking(false);
  }

  private undo(): void {
    if (this.animating || this.online || this.game.ply === 0) return;
    this.stopAi();
    if (this.choice.mode === 'ai') {
      // Take back the AI's reply and the human's move, so it's the human's turn again.
      this.game.undo();
      if (!this.isHumanTurn() && this.game.ply > 0) this.game.undo();
    } else {
      this.game.undo();
      if (this.choice.autoRotate) this.setView(this.game.turn, true);
    }
    this.clearSelection();
    this.board.setPosition(this.game.pieces());
    this.syncBoardMarks();
    this.refreshHud();
    void this.maybeAiMove();
  }

  private async showResult(result: GameResult): Promise<void> {
    let title: string;
    let subtitle: string;
    if (result.winner === 'draw') {
      this.hud.showBanner('DRAW', 'draw');
      title = 'Draw';
      subtitle = RESULT_TEXT[result.reason];
    } else {
      this.hud.showBanner(result.reason === 'checkmate' ? 'CHECKMATE!' : 'VICTORY!', 'mate');
      const me = this.humanSide();
      title = me !== null && result.winner !== me ? 'Defeat!' : 'Victory!';
      subtitle =
        result.reason === 'abandon'
          ? `${factionName(result.winner)} wins. ${RESULT_TEXT.abandon}`
          : `${factionName(result.winner)} wins ${RESULT_TEXT[result.reason]}`;
    }
    await new Promise((r) => setTimeout(r, 1200));
    const session = this.online;
    const next = await this.hud.showGameOver(title, subtitle);
    if (session !== this.online) return;
    if (next === 'menu') await this.openMenu();
    else if (session) {
      session.net.send({ t: 'rematch' });
      this.hud.showBanner('Rematch requested…', 'info', 2500);
    } else this.newGame();
  }

  // --- Online play ---

  private async startOnline(request: OnlineRequest): Promise<void> {
    const net = new OnlineClient();
    const session: OnlineSession = { net, side: null, started: false, over: false };
    this.online = session;
    this.showLobby(session, null);
    net.onMessage((msg) => this.onServerMessage(session, msg));
    net.onStateChange((state) => this.onConnectionState(session, state));
    try {
      await net.connect();
    } catch {
      if (this.online !== session) return;
      await this.abortOnline('No signal', "Couldn't reach the BattleCore server. Is it running?");
      return;
    }
    if (this.online !== session) return;
    net.send(request.action === 'create' ? { t: 'create', side: request.side } : { t: 'join', code: request.code });
  }

  private showLobby(session: OnlineSession, code: string | null): void {
    const lobby = this.hud.showLobby(code, session.side);
    void lobby.cancelled.then(() => {
      if (this.online === session) void this.openMenu();
    });
    this.closeLobby = () => lobby.close();
  }

  private closeLobby: () => void = () => {};

  private onServerMessage(session: OnlineSession, msg: ServerMessage): void {
    if (this.online !== session) return;
    switch (msg.t) {
      case 'seated':
        session.side = msg.you;
        break;
      case 'snapshot':
        this.applySnapshot(session, msg.snapshot);
        break;
      case 'moved':
        // Our own moves come back as acks (already applied); only play moves we haven't seen.
        if (msg.ply === this.game.ply) {
          const played = this.game.moveUci(msg.uci);
          if (played) void this.play(played);
        }
        break;
      case 'opponent': {
        const status = msg.status === 'joined' || msg.status === 'reconnected' ? 'connected' : msg.status;
        this.hud.setOpponentStatus(status, other(session.side ?? 'w'));
        if (msg.status === 'disconnected') this.hud.showBanner('Enemy signal lost…', 'info');
        if (msg.status === 'left') this.hud.showBanner('The enemy fled!', 'info');
        break;
      }
      case 'drawOffered':
        void this.hud.askDraw().then((accept) => {
          if (this.online === session) session.net.send({ t: 'answerDraw', accept });
        });
        break;
      case 'drawDeclined':
        this.hud.showBanner('Truce rejected!', 'info');
        break;
      case 'gameOver':
        session.over = true;
        void this.animQueue.then(() => this.showResult(msg.result));
        break;
      case 'rematchOffered':
        this.hud.showBanner('The enemy wants a rematch!', 'info', 2500);
        break;
      case 'error':
        if (['room-not-found', 'room-full', 'resume-failed', 'bad-version'].includes(msg.code)) {
          void this.abortOnline('Mission aborted', msg.message);
        } else {
          console.warn('Server rejected request:', msg.code, msg.message);
        }
        break;
      case 'pong':
        break;
    }
  }

  private applySnapshot(session: OnlineSession, s: Snapshot): void {
    session.side = s.you;
    session.started = s.started;
    session.over = s.result !== null;
    this.hud.setOnlineMode(true);
    if (!s.started) {
      this.showLobby(session, s.code);
      this.hud.setOpponentStatus('waiting', other(s.you));
      return;
    }
    this.closeLobby();
    this.animQueue = Promise.resolve();
    this.animating = false;
    this.game = new Game(s.startFen);
    for (const uci of s.moves) this.game.moveUci(uci);
    this.clearSelection();
    this.board.setPosition(this.game.pieces());
    this.syncBoardMarks();
    this.setView(s.you, true);
    this.refreshHud();
    this.hud.setOpponentStatus(s.opponentConnected ? 'connected' : 'disconnected', other(s.you));
    if (s.moves.length === 0) {
      this.hud.showBanner(s.you === 'w' ? 'You move first!' : 'Enemy moves first', 'info');
    }
    if (s.drawOffered) this.onServerMessage(session, { t: 'drawOffered' });
  }

  private onConnectionState(session: OnlineSession, state: ConnectionState): void {
    if (this.online !== session) return;
    if (state === 'reconnecting') this.hud.showBanner('Signal lost, reconnecting…', 'info', 3000);
    if (state === 'connected') this.hud.showBanner('Back online!', 'info');
    if (state === 'lost') void this.abortOnline('Connection lost', 'We lost contact with the server.');
  }

  private async abortOnline(title: string, text: string): Promise<void> {
    this.leaveOnline();
    await this.hud.showMessage(title, text);
    await this.openMenu();
  }

  private leaveOnline(): void {
    if (!this.online) return;
    this.online.net.leave();
    this.online = null;
    this.closeLobby();
    this.hud.setOnlineMode(false);
  }

  // --- Shared helpers ---

  private syncBoardMarks(): void {
    const last = this.game.lastMove();
    this.board.setLastMove(last?.from ?? null, last?.to ?? null);
    this.board.setCheck(this.game.checkSquare());
  }

  private refreshHud(): void {
    const { byWhite, byBlack } = this.game.captured();
    this.hud.setTurn(this.game.turn);
    this.hud.setMoves(this.game.sanHistory());
    this.hud.setCaptured(byWhite, byBlack);
    const humanPlies = this.choice.mode === 'ai' && this.choice.humanColor === 'b' ? 2 : 1;
    this.hud.setUndoEnabled(!this.online && this.game.ply >= humanPlies);
  }

  private clearSelection(): void {
    this.selected = null;
    this.targets = [];
    this.board.setSelection(null, []);
  }

  private setView(color: Color, animate: boolean): void {
    this.viewSide = color;
    this.board.setViewSide(color, animate);
  }
}
