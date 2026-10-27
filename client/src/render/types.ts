import type { BoardPiece, Color, FightMode, MoveAnim, MoveTarget, Square } from '../core/types';

export interface BoardView {
  /** Replace all pieces instantly (new game, undo). */
  setPosition(pieces: BoardPiece[]): void;
  /** Animate a move (hop, capture poof, castling rook, promotion swap). Resolves when finished. */
  animateMove(move: MoveAnim): Promise<void>;
  /** Highlight a selected square and its legal targets. Pass null to clear. */
  setSelection(square: Square | null, targets: MoveTarget[]): void;
  setLastMove(from: Square | null, to: Square | null): void;
  /** Square of a king in check, or null. */
  setCheck(square: Square | null): void;
  /** How captures are shown from now on. */
  setFightMode(mode: FightMode): void;
  /** Rotate the camera to view from this side. */
  setViewSide(color: Color, animate: boolean): void;
  /** Fired when the user clicks/taps a board square or a piece standing on it. */
  onSquareClick(cb: (square: Square) => void): void;
  /** Play the intro cinematic, ending with `pieces` on the board. Any key or tap skips it. */
  playIntro(pieces: BoardPiece[]): Promise<void>;
}
