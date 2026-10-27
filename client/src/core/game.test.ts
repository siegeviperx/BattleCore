import { describe, expect, it } from 'vitest';
import { Game } from './game';

describe('Game', () => {
  it('starts with 32 pieces and white to move', () => {
    const g = new Game();
    expect(g.pieces()).toHaveLength(32);
    expect(g.turn).toBe('w');
  });

  it('collapses promotion variants into one target', () => {
    const g = new Game('8/P7/8/8/8/8/8/k6K w - - 0 1');
    expect(g.legalTargets('a7')).toEqual([{ square: 'a8', capture: false }]);
    expect(g.isPromotion('a7', 'a8')).toBe(true);
    const played = g.move('a7', 'a8', 'q');
    expect(played?.anim.promotion).toBe('q');
    expect(played?.uci).toBe('a7a8q');
  });

  it('rejects illegal moves', () => {
    expect(new Game().move('e2', 'e5')).toBeNull();
  });

  it('describes en passant captures on the correct square', () => {
    const g = new Game('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const played = g.move('e5', 'd6');
    expect(played?.anim.captured).toEqual({ square: 'd5', type: 'p', color: 'b' });
  });

  it('describes castling rook moves', () => {
    const g = new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(g.move('e1', 'g1')?.anim.rookMove).toEqual({ from: 'h1', to: 'f1' });
    expect(g.move('e8', 'c8')?.anim.rookMove).toEqual({ from: 'a8', to: 'd8' });
  });

  it('detects checkmate and the winner', () => {
    const g = new Game();
    for (const uci of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) expect(g.moveUci(uci)).not.toBeNull();
    expect(g.outcome()).toEqual({ over: true, reason: 'checkmate', winner: 'b' });
    expect(g.checkSquare()).toBe('e1');
  });

  it('tracks captures, history and undo', () => {
    const g = new Game();
    for (const uci of ['e2e4', 'd7d5', 'e4d5']) g.moveUci(uci);
    expect(g.captured()).toEqual({ byWhite: ['p'], byBlack: [] });
    expect(g.sanHistory()).toEqual(['e4', 'd5', 'exd5']);
    expect(g.uciHistory()).toEqual(['e2e4', 'd7d5', 'e4d5']);
    expect(g.undo()).toBe(true);
    expect(g.ply).toBe(2);
    expect(g.lastMove()).toEqual({ from: 'd7', to: 'd5' });
  });
});
