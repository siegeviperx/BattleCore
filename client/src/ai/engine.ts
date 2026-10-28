// BattleCore chess engine: alpha-beta search and a simple tapered evaluation over the shared rules board.
// Pure and DOM-free so it can run in a Web Worker or directly under tests.

import {
  BISHOP,
  BLACK,
  Board,
  F_CAPTURE,
  F_EP,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  formatUci,
  moveFlags,
  moveFrom,
  movePromo,
  moveTo,
} from '../../../shared/rules/board.ts';
import type { Level } from '../core/types';
import type { ThinkRequest, ThinkResult } from './types';

export { START_FEN, formatUci, perft } from '../../../shared/rules/board.ts';

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const PIECE_VALUE = [0, 100, 320, 330, 500, 900, 0];

// Piece-square tables (Michniewski's "simplified evaluation function"), white's view,
// written rank 8 first so they read like a board diagram.
const PST_SRC: number[][] = [
  [],
  [ // pawn
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  [ // knight
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  [ // bishop
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  [ // rook
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  [ // queen
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
];

const KING_MG_SRC = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];

const KING_EG_SRC = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50,
];

// Combined material + PST per piece code and 0x88 square, signed from white's view.
const PST = new Int16Array(16 * 128);
// King tables indexed by color * 128 + square (unsigned; sign applied in evaluate).
const KING_MG = new Int16Array(256);
const KING_EG = new Int16Array(256);
for (let sq = 0; sq < 128; sq++) {
  if (sq & 0x88) continue;
  const r = sq >> 4;
  const f = sq & 7;
  const wIdx = (7 - r) * 8 + f;
  const bIdx = r * 8 + f;
  for (let t = PAWN; t <= QUEEN; t++) {
    PST[t * 128 + sq] = PIECE_VALUE[t] + PST_SRC[t][wIdx];
    PST[(t | 8) * 128 + sq] = -(PIECE_VALUE[t] + PST_SRC[t][bIdx]);
  }
  KING_MG[sq] = KING_MG_SRC[wIdx];
  KING_EG[sq] = KING_EG_SRC[wIdx];
  KING_MG[128 + sq] = KING_MG_SRC[bIdx];
  KING_EG[128 + sq] = KING_EG_SRC[bIdx];
}

/** Mop-up bonus for the winning side: losing king to the edge, kings close together. */
function mopUp(winnerKing: number, loserKing: number): number {
  const lf = loserKing & 7;
  const lr = loserKing >> 4;
  const centerDist = Math.max(3 - lf, lf - 4) + Math.max(3 - lr, lr - 4);
  const kingDist = Math.abs(lf - (winnerKing & 7)) + Math.abs(lr - (winnerKing >> 4));
  return 10 * centerDist + 4 * (14 - kingDist);
}

/** Static evaluation in centipawns from the side to move's point of view. */
export function evaluate(b: Board): number {
  const s = b.sq;
  let score = 0;
  let phase = 0;
  let wPawns = 0, bPawns = 0, wBishops = 0, bBishops = 0;
  let wMinors = 0, bMinors = 0, majors = 0;
  let wMat = 0, bMat = 0;

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 8) { sq += 7; continue; }
    const p = s[sq];
    if (p === 0) continue;
    switch (p) {
      case PAWN: wPawns++; wMat += 100; break;
      case PAWN | 8: bPawns++; bMat += 100; break;
      case KNIGHT: wMinors++; phase += 1; wMat += 320; break;
      case KNIGHT | 8: bMinors++; phase += 1; bMat += 320; break;
      case BISHOP: wMinors++; wBishops++; phase += 1; wMat += 330; break;
      case BISHOP | 8: bMinors++; bBishops++; phase += 1; bMat += 330; break;
      case ROOK: majors++; phase += 2; wMat += 500; break;
      case ROOK | 8: majors++; phase += 2; bMat += 500; break;
      case QUEEN: majors++; phase += 4; wMat += 900; break;
      case QUEEN | 8: majors++; phase += 4; bMat += 900; break;
      default: continue; // kings handled below
    }
    score += PST[p * 128 + sq];
  }

  // Bare minor pieces cannot mate.
  if (wPawns + bPawns === 0 && majors === 0 && wMinors <= 1 && bMinors <= 1) return 0;

  if (phase > 24) phase = 24;
  const wk = b.kingSq[WHITE];
  const bk = b.kingSq[BLACK];
  const kMg = KING_MG[wk] - KING_MG[128 + bk];
  const kEg = KING_EG[wk] - KING_EG[128 + bk];
  score += ((kMg * phase + kEg * (24 - phase)) / 24) | 0;

  if (wBishops >= 2) score += 30;
  if (bBishops >= 2) score -= 30;

  if (bPawns === 0 && wMat - bMat >= 400) score += mopUp(wk, bk);
  else if (wPawns === 0 && bMat - wMat >= 400) score -= mopUp(bk, wk);

  return b.side === WHITE ? score : -score;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const MATE = 30000;
const MATE_BOUND = MATE - 1000;
const INF = 32000;
const MAX_PLY = 128;

// Transposition table: 2^19 entries in parallel typed arrays.
const TT_BITS = 19;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const TT_EXACT = 1;
const TT_LOWER = 2;
const TT_UPPER = 3;
const ttLo = new Int32Array(TT_SIZE);
const ttHi = new Int32Array(TT_SIZE);
const ttMove = new Int32Array(TT_SIZE);
const ttScore = new Int16Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE);
const ttFlag = new Uint8Array(TT_SIZE);

/** Clears the transposition table (e.g. for a new game). */
export function clearTT(): void {
  ttFlag.fill(0);
}

// Per-ply move buffers and ordering scores.
const MOVES = new Int32Array(MAX_PLY * 256);
const ORDER = new Int32Array(MAX_PLY * 256);
const killers = new Int32Array(MAX_PLY * 2);
const historyTable = new Int32Array(2 * 128 * 128);

let board: Board;
let nodes = 0;
let stopped = false;
let canStop = false;
let deadline = Infinity;

function checkTime(): void {
  if (canStop && Date.now() >= deadline) stopped = true;
}

/** Scores moves in [start, end) for ordering: TT move, MVV-LVA captures, promotions, killers, history. */
function scoreMoves(start: number, end: number, hashMove: number, ply: number): void {
  const s = board.sq;
  const hBase = board.side * 16384;
  const k0 = killers[ply * 2];
  const k1 = killers[ply * 2 + 1];
  for (let i = start; i < end; i++) {
    const m = MOVES[i];
    let sc: number;
    if (m === hashMove) {
      sc = 10_000_000;
    } else if (moveFlags(m) & F_CAPTURE) {
      const victim = moveFlags(m) & F_EP ? PAWN : s[moveTo(m)] & 7;
      sc = 1_000_000 + PIECE_VALUE[victim] * 10 - (s[moveFrom(m)] & 7) + (movePromo(m) === QUEEN ? 9000 : 0);
    } else if (movePromo(m) === QUEEN) {
      sc = 900_000;
    } else if (m === k0) {
      sc = 800_000;
    } else if (m === k1) {
      sc = 790_000;
    } else {
      sc = historyTable[hBase + moveFrom(m) * 128 + moveTo(m)];
    }
    ORDER[i] = sc;
  }
}

/** Selection step: swaps the best-scored remaining move into slot i. */
function pickNext(i: number, end: number): number {
  let best = i;
  for (let j = i + 1; j < end; j++) if (ORDER[j] > ORDER[best]) best = j;
  if (best !== i) {
    const m = MOVES[i]; MOVES[i] = MOVES[best]; MOVES[best] = m;
    const o = ORDER[i]; ORDER[i] = ORDER[best]; ORDER[best] = o;
  }
  return MOVES[i];
}

function quiesce(alpha: number, beta: number, ply: number): number {
  if ((++nodes & 2047) === 0) checkTime();
  if (stopped) return 0;
  const b = board;
  const stand = evaluate(b);
  if (ply >= MAX_PLY - 1) return stand;
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  let best = stand;

  const start = ply * 256;
  const end = b.generate(MOVES, start, false);
  scoreMoves(start, end, 0, ply);
  for (let i = start; i < end; i++) {
    const m = pickNext(i, end);
    // Delta pruning: skip captures that cannot raise alpha even with a margin.
    if (!movePromo(m)) {
      const victim = moveFlags(m) & F_EP ? PAWN : b.sq[moveTo(m)] & 7;
      if (stand + PIECE_VALUE[victim] + 200 <= alpha) continue;
    }
    if (!b.make(m)) continue;
    const sc = -quiesce(-beta, -alpha, ply + 1);
    b.unmake();
    if (stopped) return 0;
    if (sc > best) {
      best = sc;
      if (sc > alpha) {
        alpha = sc;
        if (sc >= beta) break;
      }
    }
  }
  return best;
}

function negamax(depth: number, alpha: number, beta: number, ply: number, nullOk: boolean): number {
  if ((++nodes & 2047) === 0) checkTime();
  if (stopped) return 0;
  const b = board;

  if (b.halfmove >= 100 || b.isRepetition()) return 0;

  const inCheck = b.inCheck();
  if (inCheck) depth++; // check extension
  if (depth <= 0) return quiesce(alpha, beta, ply);
  if (ply >= MAX_PLY - 1) return evaluate(b);

  // Transposition table probe.
  const idx = b.hashLo & TT_MASK;
  let hashMove = 0;
  if (ttFlag[idx] && ttLo[idx] === b.hashLo && ttHi[idx] === b.hashHi) {
    hashMove = ttMove[idx];
    if (ttDepth[idx] >= depth) {
      let sc = ttScore[idx];
      if (sc > MATE_BOUND) sc -= ply;
      else if (sc < -MATE_BOUND) sc += ply;
      const flag = ttFlag[idx];
      if (flag === TT_EXACT || (flag === TT_LOWER && sc >= beta) || (flag === TT_UPPER && sc <= alpha)) {
        return sc;
      }
    }
  }

  const pvNode = beta - alpha > 1;

  // Null-move pruning: if passing still fails high, this node is very likely a cut node.
  if (nullOk && !inCheck && !pvNode && depth >= 3 && beta < MATE_BOUND && b.hasNonPawn(b.side)) {
    b.makeNull();
    const sc = -negamax(depth - 3, -beta, -beta + 1, ply + 1, false);
    b.unmakeNull();
    if (stopped) return 0;
    if (sc >= beta) return sc >= MATE_BOUND ? beta : sc;
  }

  const start = ply * 256;
  const end = b.generate(MOVES, start, true);
  scoreMoves(start, end, hashMove, ply);

  const origAlpha = alpha;
  let best = -INF;
  let bestMove = 0;
  let legal = 0;
  for (let i = start; i < end; i++) {
    const m = pickNext(i, end);
    if (!b.make(m)) continue;
    legal++;
    let sc: number;
    if (legal === 1) {
      sc = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
    } else {
      sc = -negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true);
      if (sc > alpha && sc < beta) sc = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
    }
    b.unmake();
    if (stopped) return 0;

    if (sc > best) {
      best = sc;
      bestMove = m;
      if (sc > alpha) {
        alpha = sc;
        if (sc >= beta) {
          if (!(moveFlags(m) & F_CAPTURE) && !movePromo(m)) {
            if (killers[ply * 2] !== m) {
              killers[ply * 2 + 1] = killers[ply * 2];
              killers[ply * 2] = m;
            }
            const h = b.side * 16384 + moveFrom(m) * 128 + moveTo(m);
            historyTable[h] += depth * depth;
            if (historyTable[h] > 500_000) for (let j = 0; j < historyTable.length; j++) historyTable[j] >>= 1;
          }
          break;
        }
      }
    }
  }

  if (legal === 0) return inCheck ? -MATE + ply : 0;

  // Store (mate scores relative to this node).
  let stored = best;
  if (stored > MATE_BOUND) stored += ply;
  else if (stored < -MATE_BOUND) stored -= ply;
  ttLo[idx] = b.hashLo;
  ttHi[idx] = b.hashHi;
  ttMove[idx] = bestMove;
  ttScore[idx] = stored;
  ttDepth[idx] = depth > 127 ? 127 : depth;
  ttFlag[idx] = best >= beta ? TT_LOWER : best > origAlpha ? TT_EXACT : TT_UPPER;
  return best;
}

/** Orders root moves once using the static heuristics (TT move first). */
function orderRoot(moves: number[]): number[] {
  const start = 0;
  for (let i = 0; i < moves.length; i++) MOVES[start + i] = moves[i];
  const idx = board.hashLo & TT_MASK;
  const hashMove = ttFlag[idx] && ttLo[idx] === board.hashLo && ttHi[idx] === board.hashHi ? ttMove[idx] : 0;
  scoreMoves(start, moves.length, hashMove, 0);
  const out: number[] = [];
  for (let i = 0; i < moves.length; i++) out.push(pickNext(i, moves.length));
  return out;
}

/** Iterative deepening with PVS at the root. */
function iterativeDeepening(rootMoves: number[], timeMs: number, maxDepth: number): ThinkResult {
  const startTime = Date.now();
  deadline = startTime + timeMs;
  let bestMove = rootMoves[0];
  let bestScore = 0;
  let completed = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    canStop = depth > 1; // depth 1 always completes, so we always have a searched move
    let alpha = -INF;
    let iterBest = 0;
    let iterScore = -INF;
    for (let i = 0; i < rootMoves.length; i++) {
      const m = rootMoves[i];
      board.make(m);
      let sc: number;
      if (i === 0) {
        sc = -negamax(depth - 1, -INF, -alpha, 1, true);
      } else {
        sc = -negamax(depth - 1, -alpha - 1, -alpha, 1, true);
        if (!stopped && sc > alpha) sc = -negamax(depth - 1, -INF, -alpha, 1, true);
      }
      board.unmake();
      if (stopped) break;
      // Only fully searched moves reach here, so a partial iteration's best is still sound.
      if (sc > iterScore) {
        iterScore = sc;
        iterBest = m;
        if (sc > alpha) alpha = sc;
      }
    }
    if (iterBest) {
      bestMove = iterBest;
      bestScore = iterScore;
    }
    if (stopped) break;
    completed = depth;

    // Best move first for the next iteration.
    const at = rootMoves.indexOf(bestMove);
    if (at > 0) { rootMoves.splice(at, 1); rootMoves.unshift(bestMove); }

    if (Math.abs(bestScore) > MATE_BOUND && MATE - Math.abs(bestScore) <= depth) break; // mate found
    if (Date.now() - startTime > timeMs * 0.5) break; // next iteration unlikely to finish
  }
  return { move: formatUci(bestMove), score: bestScore, depth: completed, nodes };
}

/** Fixed-depth full-window score for every root move, plus random noise (weaker levels). */
function noisySearch(rootMoves: number[], depth: number, noise: number, rng: () => number): ThinkResult {
  canStop = false;
  deadline = Infinity;
  let bestMove = rootMoves[0];
  let bestScore = -INF;
  let bestNoisy = -Infinity;
  for (const m of rootMoves) {
    board.make(m);
    const sc = -negamax(depth - 1, -INF, INF, 1, true);
    board.unmake();
    const noisy = sc + (rng() * 2 - 1) * noise;
    if (noisy > bestNoisy) {
      bestNoisy = noisy;
      bestMove = m;
      bestScore = sc;
    }
  }
  return { move: formatUci(bestMove), score: bestScore, depth, nodes };
}

export interface FindMoveOptions {
  /** Time budget for hard/max (ms). */
  timeMs?: number;
  /** Depth cap (also replaces the fixed depth of easy/medium). */
  maxDepth?: number;
  /** Random source for the easy/medium noise (defaults to Math.random). */
  rng?: () => number;
}

const LEVELS: Record<Level, { depth: number; noise: number; timeMs: number }> = {
  easy: { depth: 2, noise: 150, timeMs: 0 },
  medium: { depth: 3, noise: 40, timeMs: 0 },
  hard: { depth: 8, noise: 0, timeMs: 1000 },
  max: { depth: 64, noise: 0, timeMs: 2500 },
};

/** Builds the board for `fen` and replays `history` (UCI). Throws on an illegal move. */
export function loadPosition(fen: string, history: readonly string[] = []): Board {
  const b = new Board(fen, history.length + MAX_PLY + 64);
  for (const uci of history) {
    const m = b.parseUci(uci);
    if (!m) throw new Error(`Illegal move in history: ${uci}`);
    b.make(m);
  }
  return b;
}

/** Legal moves (UCI) for a position; handy for tests and sanity checks. */
export function legalMovesUci(fen: string, history: readonly string[] = []): string[] {
  return loadPosition(fen, history).legalMoves().map(formatUci);
}

/** Picks a move for the position described by `req`. Throws if the game is already over. */
export function findMove(req: ThinkRequest, opts: FindMoveOptions = {}): ThinkResult {
  board = loadPosition(req.fen, req.history);
  const legal = board.legalMoves();
  if (legal.length === 0) throw new Error('No legal moves: the game is over');

  nodes = 0;
  stopped = false;
  killers.fill(0);
  historyTable.fill(0);

  if (legal.length === 1) {
    return { move: formatUci(legal[0]), score: evaluate(board), depth: 0, nodes: 0 };
  }

  const cfg = LEVELS[req.level] ?? LEVELS.medium;
  const rootMoves = orderRoot(legal);
  if (cfg.noise > 0) {
    return noisySearch(rootMoves, Math.max(1, opts.maxDepth ?? cfg.depth), cfg.noise, opts.rng ?? Math.random);
  }
  return iterativeDeepening(rootMoves, opts.timeMs ?? cfg.timeMs, Math.max(1, Math.min(opts.maxDepth ?? cfg.depth, MAX_PLY - 8)));
}
