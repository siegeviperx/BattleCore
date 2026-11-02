// Cross-checks the shared rules engine against chess.js (kept as a dev dependency for exactly this).
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { ChessGame, START_FEN } from '../../../shared/rules/game.ts';

/** Standard perft test positions: castling, en passant, promotions, pins and checks all show up early. */
const STARTS = [
  START_FEN,
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', // "Kiwipete"
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
  '4k3/8/8/2pP4/8/8/8/4K3 w - c6 0 2', // en passant available
  '4k3/8/8/8/8/8/8/4K2R w K - 98 80', // fifty-move rule one move away
];

/** chess.js is slow, so the default run is modest; set RULES_GAMES=1000 for a deep check before releases. */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const GAMES = Number(env.RULES_GAMES ?? 60);
const MAX_PLIES = 220;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function compare(ours: ChessGame, ref: Chess, where: string, refMoves = ref.moves({ verbose: true })): void {
  const mine = ours.moves().map((m) => `${m.uci} ${m.san}`).sort();
  const theirs = refMoves.map((m) => `${m.lan} ${m.san}`).sort();
  expect(mine, `${where}: legal moves`).toEqual(theirs);
  expect(ours.fen(), `${where}: fen`).toBe(ref.fen());
  expect(ours.turn).toBe(ref.turn());
  expect(ours.inCheck(), `${where}: check`).toBe(ref.inCheck());
  expect(ours.isCheckmate(), `${where}: checkmate`).toBe(ref.isCheckmate());
  expect(ours.isStalemate(), `${where}: stalemate`).toBe(ref.isStalemate());
  expect(ours.isInsufficientMaterial(), `${where}: insufficient`).toBe(ref.isInsufficientMaterial());
  expect(ours.isDrawByFiftyMoves(), `${where}: fifty`).toBe(ref.isDrawByFiftyMoves());
  expect(ours.isThreefoldRepetition(), `${where}: repetition`).toBe(ref.isThreefoldRepetition());
}

describe('shared rules vs chess.js', () => {
  it(`agree on every position of ${GAMES} random games`, () => {
    const rand = rng(20261027);
    let positions = 0;
    const ends: Record<string, number> = {};
    for (let g = 0; g < GAMES; g++) {
      const fen = STARTS[g % STARTS.length];
      const ours = new ChessGame(fen);
      const ref = new Chess(fen);
      for (let ply = 0; ply < MAX_PLIES; ply++) {
        const where = `game ${g} ply ${ply} (${ref.fen()})`;
        const legal = ref.moves({ verbose: true });
        compare(ours, ref, where, legal);
        positions++;
        const outcome = ours.outcome();
        if (outcome.over) {
          ends[outcome.reason] = (ends[outcome.reason] ?? 0) + 1;
          break;
        }
        const pick = legal[Math.floor(rand() * legal.length)];
        const played = ours.move(pick.lan);
        expect(played?.san, `${where}: san of ${pick.lan}`).toBe(pick.san);
        expect(played?.captured).toBe(pick.captured);
        expect(played?.enPassant).toBe(pick.isEnPassant());
        expect(played?.castle).toBe(pick.isKingsideCastle() ? 'k' : pick.isQueensideCastle() ? 'q' : null);
        ref.move(pick.lan);
        // Now and then take a move back and replay it, to exercise undo.
        if (rand() < 0.05) {
          expect(ours.undo()?.uci).toBe(pick.lan);
          ref.undo();
          compare(ours, ref, `${where} after undo`);
          ours.move(pick.lan);
          ref.move(pick.lan);
        }
      }
    }
    expect(positions).toBeGreaterThan(GAMES * 50);
    // The random games should reach several kinds of ending, so each rule actually got exercised.
    expect(Object.keys(ends).length).toBeGreaterThanOrEqual(3);
  }, 600_000);

  it('detects threefold repetition', () => {
    const g = new ChessGame();
    for (const uci of ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']) g.move(uci);
    expect(g.outcome()).toEqual({ over: true, reason: 'repetition' });
  });

  it('refuses illegal and malformed moves', () => {
    const g = new ChessGame();
    expect(g.move('e2e5')).toBeNull();
    expect(g.move('e7e5')).toBeNull(); // not black's turn
    expect(g.move('zz')).toBeNull();
    const promo = new ChessGame('7k/4P3/8/8/8/8/8/K7 w - - 0 1');
    expect(promo.move('e7e8')).toBeNull(); // a promotion must name its piece
    expect(promo.move('e7e8n')?.san).toBe('e8=N');
  });
});
