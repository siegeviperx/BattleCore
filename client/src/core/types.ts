// Shared types used across core, render, ui and ai. Keep this file free of imports from other layers.

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
/** Algebraic square name, e.g. "e4". */
export type Square = string;

export type Level = 'easy' | 'medium' | 'hard' | 'max';

export interface BoardPiece {
  square: Square;
  color: Color;
  type: PieceType;
}

/** Everything the renderer needs to animate one move. Produced by the app controller from a chess.js move. */
export interface MoveAnim {
  from: Square;
  to: Square;
  color: Color;
  piece: PieceType;
  /** Captured piece; `square` differs from `to` for en passant. */
  captured?: BoardPiece;
  /** Piece type after promotion. */
  promotion?: PieceType;
  /** Rook movement for castling. */
  rookMove?: { from: Square; to: Square };
}

export interface MoveTarget {
  square: Square;
  capture: boolean;
}
