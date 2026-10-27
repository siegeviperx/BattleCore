// Wires the game state, 3D board, HUD and AI together. Owns turn flow; holds no rendering or DOM code.
import type { Engine } from '../ai/types';
import { Game, type GameOutcome, type PlayedMove } from '../core/game';
import type { Color, MoveTarget, Square } from '../core/types';
import data from '../data/pieces.json';
import type { BoardView } from '../render/types';
import type { Hud, MenuChoice } from '../ui/types';

/** Minimum time the AI appears to think, so its replies don't feel instant. */
const MIN_AI_DELAY_MS = 450;

const DRAW_REASONS: Record<string, string> = {
  stalemate: 'Stalemate: nobody can move.',
  repetition: 'Draw by threefold repetition.',
  insufficient: 'Not enough troops left to win.',
  'fifty-move': 'Draw by the fifty-move rule.',
};

const factionName = (c: Color) => data.factions[c].name;
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export class Controller {
  private game = new Game();
  private choice: MenuChoice = { mode: 'local', autoRotate: true };
  private selected: Square | null = null;
  private targets: MoveTarget[] = [];
  private animating = false;
  private inMenu = false;
  private aiToken = 0;
  private viewSide: Color = 'w';

  constructor(
    private board: BoardView,
    private hud: Hud,
    private engine: Engine,
  ) {
    board.onSquareClick((sq) => this.onSquareClick(sq));
    hud.onUndo(() => this.undo());
    hud.onFlip(() => this.setView(other(this.viewSide), true));
    hud.onMenu(() => void this.openMenu());
  }

  async start(): Promise<void> {
    this.board.setPosition(this.game.pieces());
    await this.openMenu();
  }

  private async openMenu(): Promise<void> {
    if (this.inMenu) return;
    this.inMenu = true;
    this.stopAi();
    this.choice = await this.hud.showMenu();
    this.inMenu = false;
    this.newGame();
  }

  private newGame(): void {
    this.stopAi();
    this.game = new Game();
    this.clearSelection();
    this.board.setPosition(this.game.pieces());
    this.board.setLastMove(null, null);
    this.board.setCheck(null);
    this.setView(this.choice.mode === 'ai' ? (this.choice.humanColor ?? 'w') : 'w', true);
    this.refreshHud();
    void this.maybeAiMove();
  }

  private isHumanTurn(): boolean {
    return this.choice.mode === 'local' || this.game.turn === this.choice.humanColor;
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
    if (played) await this.play(played);
  }

  private async play(played: PlayedMove): Promise<void> {
    this.animating = true;
    this.hud.setUndoEnabled(false);
    this.board.setCheck(null);
    await this.board.animateMove(played.anim);
    this.animating = false;
    this.afterMove();
  }

  private afterMove(): void {
    this.syncBoardMarks();
    this.refreshHud();
    const outcome = this.game.outcome();
    if (outcome.over) {
      void this.gameOver(outcome);
      return;
    }
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
    if (this.animating || this.game.ply === 0) return;
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

  private async gameOver(outcome: Extract<GameOutcome, { over: true }>): Promise<void> {
    let title: string;
    let subtitle: string;
    if (outcome.reason === 'checkmate') {
      this.hud.showBanner('CHECKMATE!', 'mate');
      const humanLost = this.choice.mode === 'ai' && outcome.winner !== this.choice.humanColor;
      title = humanLost ? 'Defeat!' : 'Victory!';
      subtitle = `${factionName(outcome.winner)} wins by checkmate.`;
    } else {
      this.hud.showBanner('DRAW', 'draw');
      title = 'Draw';
      subtitle = DRAW_REASONS[outcome.reason];
    }
    await new Promise((r) => setTimeout(r, 1200));
    const next = await this.hud.showGameOver(title, subtitle);
    if (next === 'rematch') this.newGame();
    else await this.openMenu();
  }

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
    this.hud.setUndoEnabled(this.game.ply >= humanPlies);
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
