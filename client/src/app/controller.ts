// Wires the game state, 3D board, HUD, AI and online client together. Owns turn flow; holds no rendering or DOM code.
import type { GameOverReason, GameResult, ServerMessage, Snapshot } from '../../../shared/protocol';
import type { Engine } from '../ai/types';
import { audio, sfx } from '../audio';
import { Game, type PlayedMove } from '../core/game';
import { LESSON_GROUPS, lessonById, lessonText, markLessonDone, nextLesson, type Lesson } from '../core/lessons';
import type { Color, MoveTarget, Square } from '../core/types';
import { OnlineClient, type ConnectionState } from '../net/client';
import { DEFAULT_MATCHUP, army, getMatchup, setMatchup } from '../packs';
import type { BoardView } from '../render/types';
import type { Hud, IntroMode, MenuChoice, OnlineRequest } from '../ui/types';

/** The start card waits this long at most for the intro's models before letting the player in anyway. */
const INTRO_LOAD_TIMEOUT_MS = 30_000;
/** Minimum time the AI appears to think, so its replies don't feel instant. */
const MIN_AI_DELAY_MS = 450;
/** Training: pause before a scripted reply, and how long praise or a correction stays up. */
const LESSON_REPLY_DELAY_MS = 900;
const LESSON_OOPS_MS = 2600;

const RESULT_TEXT: Record<GameOverReason, string> = {
  checkmate: 'by checkmate.',
  resign: 'by forfeit.',
  abandon: 'Their opponent abandoned the battlefield.',
  stalemate: 'Stalemate: nobody can move.',
  repetition: 'Draw by threefold repetition.',
  insufficient: 'Not enough troops left to win.',
  'fifty-move': 'Draw by the fifty-move rule.',
  agreement: 'Both sides agreed to a truce.',
};

const factionName = (c: Color) => army(c).name;
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

interface LessonRun {
  lesson: Lesson;
  /** Index into lesson.steps of the move the student is looking for. */
  step: number;
  /** Scripted moves or the end-of-lesson card are playing; the student can't move. */
  busy: boolean;
  /** Bumped on restart/exit so pending timers from an old run do nothing. */
  token: number;
}

interface OnlineSession {
  net: OnlineClient;
  side: Color | null;
  opponentName: string | null;
  started: boolean;
  over: boolean;
}

export class Controller {
  private game = new Game();
  private choice: MenuChoice = { mode: 'local', autoRotate: true, fights: 'full' };
  private selected: Square | null = null;
  private targets: MoveTarget[] = [];
  private animating = false;
  /** Offline: the player gave up; the game is over even though the position isn't. */
  private forfeited = false;
  private inMenu = false;
  private aiToken = 0;
  private viewSide: Color = 'w';
  private online: OnlineSession | null = null;
  private lesson: LessonRun | null = null;
  private lessonToken = 0;
  /** Serialises move animations so moves arriving from the network never overlap. */
  private animQueue: Promise<void> = Promise.resolve();

  constructor(
    private board: BoardView,
    private hud: Hud,
    private engine: Engine,
  ) {
    board.onSquareClick((sq) => this.onSquareClick(sq));
    board.onSquareHover((sq, x, y) => this.onSquareHover(sq, x, y));
    hud.onUndo(() => this.undo());
    hud.onFlip(() => this.setView(other(this.viewSide), true));
    hud.onMenu(() => void this.openMenu());
    hud.onResign(() => this.forfeit());
    hud.onCoachAction((a) => this.onCoachAction(a));
    hud.onOfferDraw(() => {
      if (!this.online?.started || this.online.over) return;
      this.online.net.send({ t: 'offerDraw' });
      this.hud.showBanner('Truce offered', 'info');
    });
  }

  async start(): Promise<void> {
    // The intro cinematic opens the app (per the menu's intro setting, or ?intro=1 / ?intro=0), before the menu.
    // The intro stars the Baby Army and the Dinos, so it only plays for that matchup (no generic intro yet).
    const m = getMatchup();
    const introArmies = m.w === DEFAULT_MATCHUP.w && m.b === DEFAULT_MATCHUP.b;
    if (introArmies && shouldPlayIntro(this.hud.introMode())) {
      // Browsers only start audio after a tap or key press, so the intro waits behind a title card.
      const loaded = Promise.race([this.board.introReady(), new Promise<void>((r) => setTimeout(r, INTRO_LOAD_TIMEOUT_MS))]);
      await this.hud.showStart(loaded);
      this.setView('w', false);
      this.hud.setCinematic(true);
      audio.music('intro');
      await this.board.playIntro(this.game.pieces());
      this.hud.setCinematic(false);
      markIntroSeen();
    } else {
      this.board.setPosition(this.game.pieces());
    }
    await this.openMenu();
  }

  private async openMenu(): Promise<void> {
    if (this.inMenu) return;
    this.inMenu = true;
    this.stopAi();
    this.leaveOnline();
    this.endLesson();
    audio.music('menu');
    this.choice = await this.hud.showMenu();
    this.inMenu = false;
    if (this.choice.matchup) setMatchup(this.choice.matchup); // online games take theirs from the server
    this.board.setFightMode(this.choice.fights);
    if (this.choice.mode === 'online' && this.choice.online) void this.startOnline(this.choice.online);
    else if (this.choice.mode === 'learn') void this.startLesson(this.choice.lesson ?? '');
    else this.newGame();
  }

  private newGame(fen?: string): void {
    this.stopAi();
    this.forfeited = false;
    this.game = new Game(fen);
    this.clearSelection();
    this.board.setPosition(this.game.pieces());
    this.board.setLastMove(null, null);
    this.board.setCheck(null);
    this.setView(this.humanSide() ?? 'w', true);
    this.refreshHud();
    audio.music('battle');
    void this.maybeAiMove();
  }

  /** The side the local player controls, or null if they control both (local 2P). */
  private humanSide(): Color | null {
    if (this.lesson) return this.lesson.lesson.side;
    if (this.choice.mode === 'ai') return this.choice.humanColor ?? 'w';
    if (this.choice.mode === 'online') return this.online?.side ?? null;
    return null;
  }

  private isHumanTurn(): boolean {
    if (this.forfeited) return false;
    if (this.lesson?.busy) return false;
    if (this.choice.mode === 'online' && (!this.online?.started || this.online.over)) return false;
    const side = this.humanSide();
    return side === null || this.game.turn === side;
  }

  private onSquareHover(square: Square | null, x: number, y: number): void {
    const piece = square && !this.inMenu ? this.game.pieceAt(square) : null;
    if (!piece) {
      this.hud.showPieceTip(null);
      return;
    }
    const me = this.humanSide();
    const owner = me === null ? null : piece.color === me ? 'yours' : 'enemy';
    this.hud.showPieceTip({ color: piece.color, type: piece.type, owner }, x, y);
  }

  /** Forfeit button (confirmed in the HUD). Online the server decides the result; offline it ends the game here. */
  private forfeit(): void {
    if (this.online) {
      this.online.net.send({ t: 'resign' });
      return;
    }
    if (this.inMenu || this.lesson || this.forfeited || this.game.outcome().over) return;
    this.forfeited = true;
    this.stopAi();
    this.clearSelection();
    this.hud.setUndoEnabled(false);
    const loser = this.humanSide() ?? this.game.turn;
    void this.animQueue.then(() => this.showResult({ winner: other(loser), reason: 'resign' }));
  }

  private onSquareClick(square: Square): void {
    if (this.animating || this.inMenu || !this.isHumanTurn() || this.game.outcome().over) return;
    if (this.selected && this.targets.some((t) => t.square === square)) {
      void this.humanMove(this.selected, square);
      return;
    }
    // Lessons: tapping the selected (often hinted) piece again keeps it selected instead of dropping it.
    if (this.lesson && square === this.selected) return;
    const piece = this.game.pieceAt(square);
    if (piece && piece.color === this.game.turn && square !== this.selected) {
      this.selected = square;
      this.targets = this.game.legalTargets(square);
      this.board.setSelection(square, this.targets);
      sfx('select');
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
    if (this.lesson && !this.lessonAccepts(played)) return;
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
    if (this.lesson) {
      const checked = this.game.checkSquare();
      if (checked && !outcome.over) {
        this.hud.showBanner('CHECK!', 'check');
        sfx('check');
        this.board.showCheck(checked);
      }
      return;
    }
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
    const checked = this.game.checkSquare();
    if (checked) {
      this.hud.showBanner('CHECK!', 'check');
      sfx('check');
      this.board.showCheck(checked);
    }
    if (this.choice.mode === 'local' && this.choice.autoRotate) this.setView(this.game.turn, true);
    void this.maybeAiMove();
  }

  private async maybeAiMove(): Promise<void> {
    if (this.forfeited) return;
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
    if (this.animating || this.online || this.lesson || this.forfeited || this.game.ply === 0) return;
    this.stopAi();
    sfx('undo');
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
    audio.music(null);
    if (result.winner === 'draw') {
      this.hud.showBanner('DRAW', 'draw');
      sfx('draw');
      title = 'Draw';
      subtitle = RESULT_TEXT[result.reason];
    } else {
      this.hud.showBanner(result.reason === 'checkmate' ? 'CHECKMATE!' : 'VICTORY!', 'mate');
      const me = this.humanSide();
      title = me !== null && result.winner !== me ? 'Defeat!' : 'Victory!';
      const king = result.reason === 'checkmate' ? this.game.checkSquare() : null;
      if (king) {
        sfx('mate');
        await this.board.playCheckmate(king, result.winner);
      }
      sfx(title === 'Defeat!' ? 'defeat' : 'victory');
      subtitle =
        result.reason === 'abandon'
          ? `${factionName(result.winner)} wins. ${RESULT_TEXT.abandon}`
          : `${factionName(result.winner)} wins ${RESULT_TEXT[result.reason]}`;
    }
    await new Promise((r) => setTimeout(r, 1200));
    if (result.winner !== 'draw') audio.music(title === 'Defeat!' ? 'defeat' : 'victory');
    const session = this.online;
    const next = await this.hud.showGameOver(title, subtitle);
    if (session !== this.online) return;
    if (next === 'menu') await this.openMenu();
    else if (session) {
      session.net.send({ t: 'rematch' });
      this.hud.showBanner('Rematch requested…', 'info', 2500);
    } else this.newGame();
  }

  // --- Training ---

  private async startLesson(id: string): Promise<void> {
    const lesson = lessonById(id);
    if (!lesson) {
      await this.openMenu();
      return;
    }
    this.stopAi();
    this.forfeited = false;
    const token = ++this.lessonToken;
    const run: LessonRun = { lesson, step: 0, busy: true, token };
    this.lesson = run;
    this.animQueue = Promise.resolve();
    this.animating = false;
    this.game = new Game(lesson.fen);
    this.clearSelection();
    this.board.setPosition(this.game.pieces());
    this.board.setLastMove(null, null);
    this.board.setCheck(null);
    this.setView(lesson.side, true);
    this.refreshHud();
    audio.music('battle');
    this.coach(run, 'task', lessonText(lesson.steps[0].say));
    await this.hud.showLessonIntro(this.lessonKicker(lesson), lesson.title, lesson.intro);
    if (this.lesson !== run || run.token !== token) return;
    for (const uci of lesson.setup ?? []) {
      await this.pause(LESSON_REPLY_DELAY_MS / 2);
      if (run.token !== this.lessonToken) return;
      const played = this.game.moveUci(uci);
      if (played) await this.play(played);
    }
    if (run.token !== this.lessonToken) return;
    run.busy = false;
  }

  /** Checks a legal move the student just made against the lesson. Wrong moves are taken back. */
  private lessonAccepts(played: PlayedMove): boolean {
    const run = this.lesson!;
    const step = run.lesson.steps[run.step];
    if (step.accept.includes(played.uci)) {
      run.busy = true;
      if (run.step < run.lesson.steps.length - 1) this.coach(run, 'good', lessonText(step.praise ?? 'Nice move!'));
      void this.play(played).then(() => this.lessonStepDone(run));
      return true;
    }
    this.game.undo();
    sfx('undo');
    this.coach(run, 'oops', lessonText(step.wrong ?? 'Not quite! That move is legal, but it isn\'t this lesson\'s move. Try again, or tap Hint.'));
    const token = run.token;
    const step0 = run.step;
    window.setTimeout(() => {
      if (this.lesson === run && run.token === token && run.step === step0 && !run.busy) this.coach(run, 'task', lessonText(step.say));
    }, LESSON_OOPS_MS);
    return false;
  }

  private async lessonStepDone(run: LessonRun): Promise<void> {
    if (run.token !== this.lessonToken) return; // restarted or left while the move animated
    const step = run.lesson.steps[run.step];
    const last = run.step === run.lesson.steps.length - 1;
    if (last) {
      await this.finishLesson(run);
      return;
    }
    sfx('promote');
    await this.pause(step.praise ? LESSON_REPLY_DELAY_MS * 1.6 : LESSON_REPLY_DELAY_MS);
    if (run.token !== this.lessonToken) return;
    if (step.reply) {
      const played = this.game.moveUci(step.reply);
      if (played) await this.play(played);
      if (run.token !== this.lessonToken) return;
    }
    run.step++;
    run.busy = false;
    this.coach(run, 'task', lessonText(run.lesson.steps[run.step].say));
  }

  private async finishLesson(run: LessonRun): Promise<void> {
    const token = run.token;
    const outcome = this.game.outcome();
    if (outcome.over && outcome.reason === 'checkmate') {
      this.hud.showBanner('CHECKMATE!', 'mate');
      sfx('mate');
      const king = this.game.checkSquare();
      if (king) await this.board.playCheckmate(king, outcome.winner);
    } else {
      this.hud.showBanner('LESSON COMPLETE!', 'info');
    }
    if (token !== this.lessonToken) return;
    sfx('victory');
    markLessonDone(run.lesson.id);
    this.coach(run, 'good', 'Lesson complete!');
    await this.pause(900);
    if (token !== this.lessonToken) return;
    const next = nextLesson(run.lesson.id);
    const choice = await this.hud.showLessonDone(run.lesson.title, run.lesson.done, next !== undefined);
    if (token !== this.lessonToken) return;
    if (choice === 'next' && next) void this.startLesson(next.id);
    else if (choice === 'replay') void this.startLesson(run.lesson.id);
    else await this.openMenu();
  }

  private onCoachAction(action: 'hint' | 'restart' | 'guide'): void {
    const run = this.lesson;
    if (!run) return;
    if (action === 'guide') {
      void this.hud.showGuide();
      return;
    }
    if (action === 'restart') {
      void this.startLesson(run.lesson.id);
      return;
    }
    if (run.busy || this.animating) return;
    // Hint: select the piece to move and show only the square it should go to.
    const uci = run.lesson.steps[run.step].accept[0];
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    this.selected = from;
    this.targets = this.game.legalTargets(from).filter((t) => t.square === to);
    this.board.setSelection(from, this.targets);
    sfx('select');
  }

  private coach(run: LessonRun, mood: 'task' | 'good' | 'oops', text: string): void {
    const n = run.lesson.steps.length;
    const kicker = n > 1 ? `${this.lessonKicker(run.lesson)} · Step ${Math.min(run.step + 1, n)} of ${n}` : this.lessonKicker(run.lesson);
    this.hud.setCoach({ kicker, title: run.lesson.title, text, mood });
  }

  private lessonKicker(lesson: Lesson): string {
    return LESSON_GROUPS.find((g) => g.id === lesson.group)?.title ?? 'Training';
  }

  private endLesson(): void {
    if (!this.lesson) return;
    this.lesson = null;
    this.lessonToken++;
    this.hud.setCoach(null);
  }

  private pause(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  // --- Online play ---

  private async startOnline(request: OnlineRequest): Promise<void> {
    const net = new OnlineClient();
    const session: OnlineSession = { net, side: null, opponentName: null, started: false, over: false };
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
    const name = request.name || undefined;
    const army = request.army || undefined;
    net.send(request.action === 'create' ? { t: 'create', side: request.side, name, army } : { t: 'join', code: request.code, name, army });
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
        this.hud.setOpponentStatus(status, other(session.side ?? 'w'), session.opponentName);
        if (status === 'connected') sfx('notify');
        if (msg.status === 'disconnected') this.hud.showBanner('Enemy signal lost…', 'info');
        if (msg.status === 'left') this.hud.showBanner('The enemy fled!', 'info');
        break;
      }
      case 'drawOffered':
        sfx('notify');
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
        sfx('notify');
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
    session.opponentName = s.opponentName ?? null;
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
    setMatchup(s.armies ?? {}); // both players see the same armies; unknown ones (a newer friend's pack) fall back
    this.game = new Game(s.startFen);
    for (const uci of s.moves) this.game.moveUci(uci);
    this.clearSelection();
    this.board.setPosition(this.game.pieces());
    this.syncBoardMarks();
    this.setView(s.you, true);
    this.refreshHud();
    audio.music('battle');
    this.hud.setOpponentStatus(s.opponentConnected ? 'connected' : 'disconnected', other(s.you), session.opponentName);
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

const INTRO_SEEN_KEY = 'battlecore.intro.seen';

function shouldPlayIntro(mode: IntroMode): boolean {
  const forced = new URLSearchParams(location.search).get('intro'); // ?intro=1 forces it, ?intro=0 skips it
  if (forced !== null) return forced !== '0';
  if (mode !== 'first') return mode === 'always';
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === null;
  } catch {
    return false;
  }
}

function markIntroSeen(): void {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch {
    /* storage unavailable: the intro just plays again next time */
  }
}
