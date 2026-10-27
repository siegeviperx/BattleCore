// Piece "looks": art/model variants of one piece type (data/pieces.json `looks`), e.g. the white pawns
// cycle through four different babies by starting file. Look 0 is the default; keys name both the sticker
// (assets/pieces/<key>.png) and the fight model (assets/fighters/<key>.glb).
import data from '../data/pieces.json';
import type { Color, PieceType } from './types';

function looks(color: Color, type: PieceType): string[] | undefined {
  return (data.pieces[color][type] as { looks?: string[] }).looks;
}

export function lookCount(color: Color, type: PieceType): number {
  return looks(color, type)?.length ?? 1;
}

export function lookKey(color: Color, type: PieceType, look = 0): string {
  const l = looks(color, type);
  return l?.[look % l.length] ?? `${color}-${type}`;
}
