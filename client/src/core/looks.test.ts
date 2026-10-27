import { describe, expect, it } from 'vitest';
import { Game } from './game';

const lookAt = (g: Game, sq: string) => g.pieces().find((p) => p.square === sq)?.look;

describe('piece looks', () => {
  it('white pawns cycle looks by starting file', () => {
    const g = new Game();
    expect(['a2', 'b2', 'c2', 'd2', 'e2', 'h2'].map((s) => lookAt(g, s))).toEqual([0, 1, 2, 3, 0, 3]);
    expect(lookAt(g, 'a7')).toBeUndefined(); // dinos have one look
    expect(lookAt(g, 'e1')).toBeUndefined();
  });

  it('a pawn keeps its look after capturing into another file', () => {
    const g = new Game();
    for (const uci of ['e2e4', 'd7d5', 'e4d5']) g.moveUci(uci);
    expect(lookAt(g, 'd5')).toBe(0); // the e-pawn, not a d-pawn
  });
});
