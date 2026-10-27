import { describe, expect, it } from 'vitest';
import { MATE, START_FEN, findMove, legalMovesUci, loadPosition, perft } from './engine';
import type { Level } from '../core/types';

const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const POS3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';
const POS4 = 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1';

const LEVELS: Level[] = ['easy', 'medium', 'hard', 'max'];

describe('perft', () => {
  it('start position', () => {
    expect([1, 2, 3, 4].map((d) => perft(START_FEN, d))).toEqual([20, 400, 8902, 197281]);
  });
  it('kiwipete', () => {
    expect([1, 2, 3].map((d) => perft(KIWIPETE, d))).toEqual([48, 2039, 97862]);
  });
  it('position 3', () => {
    expect([1, 2, 3, 4].map((d) => perft(POS3, d))).toEqual([14, 191, 2812, 43238]);
  });
  it('position 4', () => {
    expect([1, 2, 3].map((d) => perft(POS4, d))).toEqual([6, 264, 9467]);
  });
});

describe('findMove', () => {
  it.each(LEVELS)('finds a back-rank mate in 1 (%s)', (level) => {
    const r = findMove({ fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', history: [], level });
    expect(r.move).toBe('a1a8');
    expect(r.score).toBe(MATE - 1);
  });

  it.each(['medium', 'hard', 'max'] as Level[])('finds a mate in 2 (%s)', (level) => {
    // 1.Kf7 Kh7 2.Rh1# or 1.Kg6 Kg8 2.Rb8#
    const r = findMove({ fen: '7k/8/5K2/8/8/8/8/1R6 w - - 0 1', history: [], level }, { timeMs: 1000 });
    expect(r.score).toBe(MATE - 3);
    expect(['f6f7', 'f6g6']).toContain(r.move);
  });

  it('plays the only legal move', () => {
    const r = findMove({ fen: 'k7/8/8/8/8/8/1q6/K7 w - - 0 1', history: [], level: 'max' });
    expect(r.move).toBe('a1b2');
  });

  it('replays history before searching (scholar\'s mate)', () => {
    const history = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6'];
    const r = findMove({ fen: START_FEN, history, level: 'medium' });
    expect(r.move).toBe('h5f7');
    expect(r.score).toBe(MATE - 1);
  });

  it('rejects an illegal history move', () => {
    expect(() => findMove({ fen: START_FEN, history: ['e2e5'], level: 'easy' })).toThrow(/Illegal move/);
  });

  it('throws when the game is already over', () => {
    expect(() =>
      findMove({ fen: START_FEN, history: ['f2f3', 'e7e5', 'g2g4', 'd8h4'], level: 'hard' }),
    ).toThrow(/No legal moves/);
  });

  it('formats promotions as UCI with the piece letter', () => {
    const r = findMove({ fen: '8/P6k/8/8/8/8/8/K7 w - - 0 1', history: [], level: 'hard' });
    expect(r.move).toBe('a7a8q');
    expect(legalMovesUci('8/P6k/8/8/8/8/8/K7 w - - 0 1')).toEqual(
      expect.arrayContaining(['a7a8q', 'a7a8r', 'a7a8b', 'a7a8n']),
    );
  });

  it('counts repetitions from the game history', () => {
    // Knight shuffles from the real game bring the start position back again.
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1'];
    const b = loadPosition(START_FEN, shuffle);
    const m = b.parseUci('f6g8');
    b.make(m);
    expect(b.isRepetition()).toBe(true);
  });

  it('returns a legal move even with a tiny time budget', () => {
    const r = findMove({ fen: KIWIPETE, history: [], level: 'max' }, { timeMs: 1 });
    expect(legalMovesUci(KIWIPETE)).toContain(r.move);
    expect(r.depth).toBeGreaterThanOrEqual(1);
  });

  it('plays legal moves throughout a self-play game', () => {
    const history: string[] = [];
    for (let i = 0; i < 40; i++) {
      const legal = legalMovesUci(START_FEN, history);
      if (legal.length === 0) break;
      const r = findMove({ fen: START_FEN, history, level: i % 2 ? 'easy' : 'medium' });
      expect(legal).toContain(r.move);
      history.push(r.move);
    }
  });

  it('hard level completes within ~1.5s', () => {
    const t0 = Date.now();
    const r = findMove({ fen: START_FEN, history: [], level: 'hard' });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(legalMovesUci(START_FEN)).toContain(r.move);
    expect(r.depth).toBeGreaterThanOrEqual(3);
  });

  it('converts K+Q vs K to mate', () => {
    const fen = '8/8/8/3k4/8/8/8/3QK3 w - - 0 1';
    const history: string[] = [];
    let mated = false;
    for (let i = 0; i < 60; i++) {
      if (legalMovesUci(fen, history).length === 0) { mated = true; break; }
      history.push(findMove({ fen, history, level: 'hard' }, { timeMs: 150 }).move);
    }
    expect(mated).toBe(true);
    expect(loadPosition(fen, history).inCheck()).toBe(true);
  });
});
