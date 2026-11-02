// Shared types used across core, render, ui and ai. Keep this file free of imports from other layers.

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
/** Algebraic square name, e.g. "e4". */
export type Square = string;

export type Level = 'easy' | 'medium' | 'hard' | 'max';

/** Capture fight scenes: full cinematic, a sped-up version, or the plain board poof. */
export type FightMode = 'full' | 'quick' | 'off';

export interface BoardPiece {
  square: Square;
  color: Color;
  type: PieceType;
  /** Art variant (index into the pack piece's looks); 0 or absent = default. */
  look?: number;
}

/** Everything the renderer needs to animate one move. Produced by core/game.ts from a rules move. */
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
