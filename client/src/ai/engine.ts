// BattleCore chess engine: 0x88 board, alpha-beta search, simple tapered evaluation.
// Pure and DOM-free so it can run in a Web Worker or directly under tests.

import type { Level } from '../core/types';
import type { ThinkRequest, ThinkResult } from './types';

// ---------------------------------------------------------------------------
// Pieces, squares and moves
// ---------------------------------------------------------------------------

// Piece code = type | (color << 3). White = 0, black = 1. Empty square = 0.
const PAWN = 1;
const KNIGHT = 2;
const BISHOP = 3;
const ROOK = 4;
const QUEEN = 5;
const KING = 6;
const WHITE = 0;
const BLACK = 1;

// Move = from | to << 7 | promo << 14 | flags << 17. Zero is never a valid move.
const F_CAPTURE = 1;
const F_EP = 2;
const F_CASTLE = 4;
const F_DOUBLE = 8;

const moveFrom = (m: number) => m & 127;
const moveTo = (m: number) => (m >> 7) & 127;
const movePromo = (m: number) => (m >> 14) & 7;
const moveFlags = (m: number) => m >> 17;

// Castling rights bits.
const WK = 1;
const WQ = 2;
const BK = 4;
const BQ = 8;

const KNIGHT_DIRS = [33, 31, 18, 14, -33, -31, -18, -14];
const KING_DIRS = [1, -1, 16, -16, 15, 17, -15, -17];
const BISHOP_DIRS = [15, 17, -15, -17];
const ROOK_DIRS = [1, -1, 16, -16];

/** Rights kept when a move touches a square (king or rook home squares clear rights). */
const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[0x00] = 15 & ~WQ;
CASTLE_MASK[0x04] = 15 & ~(WK | WQ);
CASTLE_MASK[0x07] = 15 & ~WK;
CASTLE_MASK[0x70] = 15 & ~BQ;
CASTLE_MASK[0x74] = 15 & ~(BK | BQ);
CASTLE_MASK[0x77] = 15 & ~BK;

const FILES = 'abcdefgh';
const PROMO_CHARS = '  nbrq';

const squareName = (sq: number) => FILES[sq & 7] + String((sq >> 4) + 1);

function parseSquare(s: string): number {
  const f = s.charCodeAt(0) - 97;
  const r = s.charCodeAt(1) - 49;
  if (f < 0 || f > 7 || r < 0 || r > 7 || s.length !== 2) return -1;
  return r * 16 + f;
}

/** Formats a packed move as UCI, e.g. "e2e4" or "a7a8q". */
export function formatUci(m: number): string {
  const promo = movePromo(m);
  return squareName(moveFrom(m)) + squareName(moveTo(m)) + (promo ? PROMO_CHARS[promo] : '');
}

// ---------------------------------------------------------------------------
// Zobrist keys: two independent 32-bit halves, from a fixed-seed PRNG
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) | 0;
  };
}

const rand32 = mulberry32(0x5eed1234);
const fillKeys = (arr: Int32Array) => {
  for (let i = 0; i < arr.length; i++) arr[i] = rand32();
  return arr;
};
const PIECE_LO = fillKeys(new Int32Array(16 * 128));
const PIECE_HI = fillKeys(new Int32Array(16 * 128));
const CASTLE_LO = fillKeys(new Int32Array(16));
const CASTLE_HI = fillKeys(new Int32Array(16));
const EP_LO = fillKeys(new Int32Array(8));
const EP_HI = fillKeys(new Int32Array(8));
const SIDE_LO = rand32();
const SIDE_HI = rand32();

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

const FEN_PIECES: Record<string, number> = {
  P: PAWN, N: KNIGHT, B: BISHOP, R: ROOK, Q: QUEEN, K: KING,
  p: PAWN | 8, n: KNIGHT | 8, b: BISHOP | 8, r: ROOK | 8, q: QUEEN | 8, k: KING | 8,
};

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class Board {
  readonly sq = new Int8Array(128);
  side = WHITE;
  castling = 0;
  ep = -1;
  halfmove = 0;
  fullmove = 1;
  readonly kingSq = new Int32Array(2);
  hashLo = 0;
  hashHi = 0;

  // Undo stack (one entry per make / makeNull).
  private sp = 0;
  private readonly uMove: Int32Array;
  private readonly uCaptured: Int8Array;
  private readonly uCastle: Int8Array;
  private readonly uEp: Int16Array;
  private readonly uHalf: Int32Array;
  private readonly uHashLo: Int32Array;
  private readonly uHashHi: Int32Array;

  // Hashes of every position reached (game history + search path), for repetition detection.
  private histLen = 0;
  private readonly histLo: Int32Array;
  private readonly histHi: Int32Array;

  constructor(fen: string = START_FEN, capacity = 1024) {
    this.uMove = new Int32Array(capacity);
    this.uCaptured = new Int8Array(capacity);
    this.uCastle = new Int8Array(capacity);
    this.uEp = new Int16Array(capacity);
    this.uHalf = new Int32Array(capacity);
    this.uHashLo = new Int32Array(capacity);
    this.uHashHi = new Int32Array(capacity);
    this.histLo = new Int32Array(capacity + 1);
    this.histHi = new Int32Array(capacity + 1);
    this.loadFen(fen);
  }

  private loadFen(fen: string): void {
    const parts = fen.trim().split(/\s+/);
    const rows = (parts[0] ?? '').split('/');
    if (rows.length !== 8) throw new Error(`Invalid FEN: ${fen}`);
    this.sq.fill(0);
    const kings = [0, 0];
    for (let i = 0; i < 8; i++) {
      const rank = 7 - i;
      let file = 0;
      for (const ch of rows[i]) {
        if (ch >= '1' && ch <= '8') {
          file += ch.charCodeAt(0) - 48;
        } else {
          const p = FEN_PIECES[ch];
          if (!p || file > 7) throw new Error(`Invalid FEN: ${fen}`);
          const sq = rank * 16 + file;
          this.sq[sq] = p;
          if ((p & 7) === KING) {
            this.kingSq[p >> 3] = sq;
            kings[p >> 3]++;
          }
          file++;
        }
      }
      if (file !== 8) throw new Error(`Invalid FEN: ${fen}`);
    }
    if (kings[0] !== 1 || kings[1] !== 1) throw new Error(`Invalid FEN (kings): ${fen}`);

    this.side = parts[1] === 'b' ? BLACK : WHITE;
    const c = parts[2] ?? '-';
    this.castling =
      (c.includes('K') ? WK : 0) | (c.includes('Q') ? WQ : 0) |
      (c.includes('k') ? BK : 0) | (c.includes('q') ? BQ : 0);
    this.ep = parts[3] && parts[3] !== '-' ? parseSquare(parts[3]) : -1;
    this.halfmove = parseInt(parts[4] ?? '0', 10) || 0;
    this.fullmove = parseInt(parts[5] ?? '1', 10) || 1;
    this.computeHash();
    this.sp = 0;
    this.histLen = 1;
    this.histLo[0] = this.hashLo;
    this.histHi[0] = this.hashHi;
  }

  private computeHash(): void {
    let lo = 0;
    let hi = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 8) { sq += 7; continue; }
      const p = this.sq[sq];
      if (p) { lo ^= PIECE_LO[p * 128 + sq]; hi ^= PIECE_HI[p * 128 + sq]; }
    }
    lo ^= CASTLE_LO[this.castling];
    hi ^= CASTLE_HI[this.castling];
    if (this.ep !== -1) { lo ^= EP_LO[this.ep & 7]; hi ^= EP_HI[this.ep & 7]; }
    if (this.side === BLACK) { lo ^= SIDE_LO; hi ^= SIDE_HI; }
    this.hashLo = lo;
    this.hashHi = hi;
  }

  /** Is `sq` attacked by any piece of color `by`? */
  attacked(sq: number, by: number): boolean {
    const s = this.sq;
    const c = by << 3;
    // Pawns: a white pawn attacks +15/+17, so look "behind" the target square.
    if (by === WHITE) {
      if (!((sq - 15) & 0x88) && s[sq - 15] === PAWN) return true;
      if (!((sq - 17) & 0x88) && s[sq - 17] === PAWN) return true;
    } else {
      if (!((sq + 15) & 0x88) && s[sq + 15] === (PAWN | 8)) return true;
      if (!((sq + 17) & 0x88) && s[sq + 17] === (PAWN | 8)) return true;
    }
    const knight = KNIGHT | c;
    for (let i = 0; i < 8; i++) {
      const t = sq + KNIGHT_DIRS[i];
      if (!(t & 0x88) && s[t] === knight) return true;
    }
    const king = KING | c;
    for (let i = 0; i < 8; i++) {
      const t = sq + KING_DIRS[i];
      if (!(t & 0x88) && s[t] === king) return true;
    }
    const bishop = BISHOP | c;
    const rook = ROOK | c;
    const queen = QUEEN | c;
    for (let i = 0; i < 4; i++) {
      const d = BISHOP_DIRS[i];
      for (let t = sq + d; !(t & 0x88); t += d) {
        const p = s[t];
        if (p) { if (p === bishop || p === queen) return true; break; }
      }
    }
    for (let i = 0; i < 4; i++) {
      const d = ROOK_DIRS[i];
      for (let t = sq + d; !(t & 0x88); t += d) {
        const p = s[t];
        if (p) { if (p === rook || p === queen) return true; break; }
      }
    }
    return false;
  }

  inCheck(): boolean {
    return this.attacked(this.kingSq[this.side], this.side ^ 1);
  }

  /** Does `color` have any knight, bishop, rook or queen? (null-move safety) */
  hasNonPawn(color: number): boolean {
    const s = this.sq;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 8) { sq += 7; continue; }
      const p = s[sq];
      if (p && (p >> 3) === color) {
        const t = p & 7;
        if (t !== PAWN && t !== KING) return true;
      }
    }
    return false;
  }

  /**
   * Appends pseudo-legal moves to `out` starting at index `n`; returns the new end index.
   * With `quiet` false only captures and queen promotions are generated (quiescence).
   */
  generate(out: Int32Array, n: number, quiet: boolean): number {
    const s = this.sq;
    const us = this.side;
    const them = us ^ 1;
    for (let from = 0; from < 128; from++) {
      if (from & 8) { from += 7; continue; }
      const p = s[from];
      if (p === 0 || (p >> 3) !== us) continue;
      const type = p & 7;

      if (type === PAWN) {
        const fwd = us === WHITE ? 16 : -16;
        const lastRank = us === WHITE ? 7 : 0;
        let to = from + fwd;
        if (s[to] === 0) {
          if (to >> 4 === lastRank) {
            n = addPromos(out, n, from | (to << 7), quiet);
          } else if (quiet) {
            out[n++] = from | (to << 7);
            const startRank = us === WHITE ? 1 : 6;
            if (from >> 4 === startRank && s[to + fwd] === 0) {
              out[n++] = from | ((to + fwd) << 7) | (F_DOUBLE << 17);
            }
          }
        }
        for (let k = -1; k <= 1; k += 2) {
          to = from + fwd + k;
          if (to & 0x88) continue;
          const q = s[to];
          if (q !== 0 && q >> 3 === them) {
            const base = from | (to << 7) | (F_CAPTURE << 17);
            if (to >> 4 === lastRank) n = addPromos(out, n, base, quiet);
            else out[n++] = base;
          } else if (to === this.ep) {
            out[n++] = from | (to << 7) | ((F_CAPTURE | F_EP) << 17);
          }
        }
      } else if (type === KNIGHT || type === KING) {
        const dirs = type === KNIGHT ? KNIGHT_DIRS : KING_DIRS;
        for (let i = 0; i < 8; i++) {
          const to = from + dirs[i];
          if (to & 0x88) continue;
          const q = s[to];
          if (q === 0) { if (quiet) out[n++] = from | (to << 7); }
          else if (q >> 3 === them) out[n++] = from | (to << 7) | (F_CAPTURE << 17);
        }
      } else {
        const dirs = type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : KING_DIRS;
        for (let i = 0; i < dirs.length; i++) {
          const d = dirs[i];
          for (let to = from + d; !(to & 0x88); to += d) {
            const q = s[to];
            if (q === 0) {
              if (quiet) out[n++] = from | (to << 7);
            } else {
              if (q >> 3 === them) out[n++] = from | (to << 7) | (F_CAPTURE << 17);
              break;
            }
          }
        }
      }
    }

    // Castling: rights, empty squares between, king not passing through attacked squares.
    // (The destination square is covered by the regular legality check after make.)
    if (quiet && this.castling) {
      const base = us === WHITE ? 0 : 0x70;
      const ks = us === WHITE ? WK : BK;
      const qs = us === WHITE ? WQ : BQ;
      if (this.castling & ks && s[base + 5] === 0 && s[base + 6] === 0 &&
          !this.attacked(base + 4, them) && !this.attacked(base + 5, them)) {
        out[n++] = (base + 4) | ((base + 6) << 7) | (F_CASTLE << 17);
      }
      if (this.castling & qs && s[base + 1] === 0 && s[base + 2] === 0 && s[base + 3] === 0 &&
          !this.attacked(base + 4, them) && !this.attacked(base + 3, them)) {
        out[n++] = (base + 4) | ((base + 2) << 7) | (F_CASTLE << 17);
      }
    }
    return n;
  }

  /**
   * Plays a pseudo-legal move. Returns false (and leaves the board unchanged) if it would
   * leave the mover's king in check.
   */
  make(m: number): boolean {
    const s = this.sq;
    const from = moveFrom(m);
    const to = moveTo(m);
    const promo = movePromo(m);
    const flags = moveFlags(m);
    const us = this.side;
    const p = s[from];
    let captured = s[to];

    const k = this.sp++;
    this.uMove[k] = m;
    this.uCastle[k] = this.castling;
    this.uEp[k] = this.ep;
    this.uHalf[k] = this.halfmove;
    this.uHashLo[k] = this.hashLo;
    this.uHashHi[k] = this.hashHi;

    let lo = this.hashLo ^ CASTLE_LO[this.castling] ^ SIDE_LO;
    let hi = this.hashHi ^ CASTLE_HI[this.castling] ^ SIDE_HI;
    if (this.ep !== -1) { lo ^= EP_LO[this.ep & 7]; hi ^= EP_HI[this.ep & 7]; }

    if (flags & F_EP) {
      const capSq = us === WHITE ? to - 16 : to + 16;
      captured = s[capSq];
      s[capSq] = 0;
      lo ^= PIECE_LO[captured * 128 + capSq];
      hi ^= PIECE_HI[captured * 128 + capSq];
    } else if (captured) {
      lo ^= PIECE_LO[captured * 128 + to];
      hi ^= PIECE_HI[captured * 128 + to];
    }
    this.uCaptured[k] = captured;

    const placed = promo ? promo | (us << 3) : p;
    s[from] = 0;
    s[to] = placed;
    lo ^= PIECE_LO[p * 128 + from] ^ PIECE_LO[placed * 128 + to];
    hi ^= PIECE_HI[p * 128 + from] ^ PIECE_HI[placed * 128 + to];

    if (flags & F_CASTLE) {
      const rFrom = to > from ? from + 3 : from - 4;
      const rTo = to > from ? from + 1 : from - 1;
      const rook = s[rFrom];
      s[rFrom] = 0;
      s[rTo] = rook;
      lo ^= PIECE_LO[rook * 128 + rFrom] ^ PIECE_LO[rook * 128 + rTo];
      hi ^= PIECE_HI[rook * 128 + rFrom] ^ PIECE_HI[rook * 128 + rTo];
    }
    if ((p & 7) === KING) this.kingSq[us] = to;

    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.ep = flags & F_DOUBLE ? (from + to) >> 1 : -1;
    this.halfmove = captured || (p & 7) === PAWN ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.side = us ^ 1;

    lo ^= CASTLE_LO[this.castling];
    hi ^= CASTLE_HI[this.castling];
    if (this.ep !== -1) { lo ^= EP_LO[this.ep & 7]; hi ^= EP_HI[this.ep & 7]; }
    this.hashLo = lo;
    this.hashHi = hi;
    this.histLo[this.histLen] = lo;
    this.histHi[this.histLen] = hi;
    this.histLen++;

    if (this.attacked(this.kingSq[us], us ^ 1)) {
      this.unmake();
      return false;
    }
    return true;
  }

  unmake(): void {
    const s = this.sq;
    const k = --this.sp;
    const m = this.uMove[k];
    const from = moveFrom(m);
    const to = moveTo(m);
    const flags = moveFlags(m);
    const us = this.side ^ 1;
    const captured = this.uCaptured[k];

    const moved = movePromo(m) ? PAWN | (us << 3) : s[to];
    s[from] = moved;
    if (flags & F_EP) {
      s[to] = 0;
      s[us === WHITE ? to - 16 : to + 16] = captured;
    } else {
      s[to] = captured;
    }
    if (flags & F_CASTLE) {
      const rFrom = to > from ? from + 3 : from - 4;
      const rTo = to > from ? from + 1 : from - 1;
      s[rFrom] = s[rTo];
      s[rTo] = 0;
    }
    if ((moved & 7) === KING) this.kingSq[us] = from;

    this.side = us;
    if (us === BLACK) this.fullmove--;
    this.castling = this.uCastle[k];
    this.ep = this.uEp[k];
    this.halfmove = this.uHalf[k];
    this.hashLo = this.uHashLo[k];
    this.hashHi = this.uHashHi[k];
    this.histLen--;
  }

  /** Passes the turn (null-move pruning). Resets the halfmove clock so repetition scans stop here. */
  makeNull(): void {
    const k = this.sp++;
    this.uMove[k] = 0;
    this.uEp[k] = this.ep;
    this.uHalf[k] = this.halfmove;
    this.uHashLo[k] = this.hashLo;
    this.uHashHi[k] = this.hashHi;
    let lo = this.hashLo ^ SIDE_LO;
    let hi = this.hashHi ^ SIDE_HI;
    if (this.ep !== -1) { lo ^= EP_LO[this.ep & 7]; hi ^= EP_HI[this.ep & 7]; }
    this.ep = -1;
    this.halfmove = 0;
    this.side ^= 1;
    this.hashLo = lo;
    this.hashHi = hi;
    this.histLo[this.histLen] = lo;
    this.histHi[this.histLen] = hi;
    this.histLen++;
  }

  unmakeNull(): void {
    const k = --this.sp;
    this.side ^= 1;
    this.ep = this.uEp[k];
    this.halfmove = this.uHalf[k];
    this.hashLo = this.uHashLo[k];
    this.hashHi = this.uHashHi[k];
    this.histLen--;
  }

  /** Has the current position occurred before since the last irreversible move? */
  isRepetition(): boolean {
    const n = this.histLen - 1;
    const limit = n - this.halfmove;
    const lo = this.hashLo;
    const hi = this.hashHi;
    for (let i = n - 2; i >= limit && i >= 0; i -= 2) {
      if (this.histLo[i] === lo && this.histHi[i] === hi) return true;
    }
    return false;
  }

  /** All legal moves in the current position. */
  legalMoves(): number[] {
    const buf = new Int32Array(256);
    const n = this.generate(buf, 0, true);
    const result: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.make(buf[i])) {
        this.unmake();
        result.push(buf[i]);
      }
    }
    return result;
  }

  /** Finds the legal move matching a UCI string, or 0. Missing promotion piece defaults to queen. */
  parseUci(uci: string): number {
    const from = parseSquare(uci.slice(0, 2));
    const to = parseSquare(uci.slice(2, 4));
    if (from < 0 || to < 0) return 0;
    const promoCh = uci.length > 4 ? uci[4].toLowerCase() : '';
    for (const m of this.legalMoves()) {
      if (moveFrom(m) !== from || moveTo(m) !== to) continue;
      const promo = movePromo(m);
      if (!promo) return promoCh ? 0 : m;
      if (PROMO_CHARS[promo] === (promoCh || 'q')) return m;
    }
    return 0;
  }
}

function addPromos(out: Int32Array, n: number, base: number, quiet: boolean): number {
  out[n++] = base | (QUEEN << 14);
  if (quiet) {
    out[n++] = base | (KNIGHT << 14);
    out[n++] = base | (BISHOP << 14);
    out[n++] = base | (ROOK << 14);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Perft (move generator verification)
// ---------------------------------------------------------------------------

const PERFT_BUF = new Int32Array(64 * 256);

function perftRec(b: Board, depth: number, ply: number): number {
  const start = ply * 256;
  const end = b.generate(PERFT_BUF, start, true);
  let count = 0;
  for (let i = start; i < end; i++) {
    if (!b.make(PERFT_BUF[i])) continue;
    count += depth === 1 ? 1 : perftRec(b, depth - 1, ply + 1);
    b.unmake();
  }
  return count;
}

/** Counts leaf nodes of the legal move tree to `depth`. */
export function perft(fen: string, depth: number): number {
  if (depth <= 0) return 1;
  return perftRec(new Board(fen), depth, 0);
}

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
