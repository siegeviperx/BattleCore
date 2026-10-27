import type { Insets } from './camera';
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
  /** One-shot check effect on the king's square (the steady glow is setCheck). */
  showCheck(square: Square): void;
  /** The mated king topples and the winning side cheers. Resolves when it's over. */
  playCheckmate(king: Square, winner: Color): Promise<void>;
  /** Screen edges covered by the HUD; the board is framed in the rest. */
  setInsets(insets: Insets): void;
  /** How captures are shown from now on. */
  setFightMode(mode: FightMode): void;
  /** Rotate the camera to view from this side. */
  setViewSide(color: Color, animate: boolean): void;
  /** Mouse hovering over a square (null when it leaves the board or a drag starts), with client coordinates. */
  onSquareHover(cb: (square: Square | null, x: number, y: number) => void): void;
  /** Fired when the user clicks/taps a board square or a piece standing on it. */
  onSquareClick(cb: (square: Square) => void): void;
  /** Resolves once the intro's 3D models have downloaded (so it never shows stand-ins on a slow connection). */
  introReady(): Promise<void>;
  /** Play the intro cinematic, ending with `pieces` on the board. Any key or tap skips it. */
  playIntro(pieces: BoardPiece[]): Promise<void>;
}
