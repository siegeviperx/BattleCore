import type { Square } from '../core/types';

/** Board top surface height. */
export const BOARD_Y = 0;

export function squareToFR(sq: Square): { f: number; r: number } {
  return { f: sq.charCodeAt(0) - 97, r: parseInt(sq.slice(1), 10) - 1 };
}

export function squareToXZ(sq: Square): { x: number; z: number } {
  const { f, r } = squareToFR(sq);
  return { x: f - 3.5, z: 3.5 - r };
}

/** World x/z → square, or null when off the board. */
export function xzToSquare(x: number, z: number): Square | null {
  const f = Math.floor(x + 4);
  const r = Math.floor(4 - z);
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return String.fromCharCode(97 + f) + (r + 1);
}
