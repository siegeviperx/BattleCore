// Chess rules core: 0x88 board, pseudo-legal move generation, make/unmake with Zobrist hashing, perft.
// Shared by the browser client (game state and AI search) and the Node game server, so keep it
// dependency-free and erasable-syntax only (no enums, namespaces or parameter properties).

// ---------------------------------------------------------------------------
// Pieces, squares and moves
// ---------------------------------------------------------------------------

// Piece code = type | (color << 3). White = 0, black = 1. Empty square = 0.
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
export const WHITE = 0;
export const BLACK = 1;

// Move = from | to << 7 | promo << 14 | flags << 17. Zero is never a valid move.
export const F_CAPTURE = 1;
export const F_EP = 2;
export const F_CASTLE = 4;
export const F_DOUBLE = 8;

export const moveFrom = (m: number) => m & 127;
export const moveTo = (m: number) => (m >> 7) & 127;
export const movePromo = (m: number) => (m >> 14) & 7;
export const moveFlags = (m: number) => m >> 17;

// Castling rights bits.
export const WK = 1;
export const WQ = 2;
export const BK = 4;
export const BQ = 8;

export const KNIGHT_DIRS = [33, 31, 18, 14, -33, -31, -18, -14];
export const KING_DIRS = [1, -1, 16, -16, 15, 17, -15, -17];
export const BISHOP_DIRS = [15, 17, -15, -17];
export const ROOK_DIRS = [1, -1, 16, -16];

/** Rights kept when a move touches a square (king or rook home squares clear rights). */
const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[0x00] = 15 & ~WQ;
CASTLE_MASK[0x04] = 15 & ~(WK | WQ);
CASTLE_MASK[0x07] = 15 & ~WK;
CASTLE_MASK[0x70] = 15 & ~BQ;
CASTLE_MASK[0x74] = 15 & ~(BK | BQ);
CASTLE_MASK[0x77] = 15 & ~BK;

export const FILES = 'abcdefgh';
export const PROMO_CHARS = '  nbrq';

export const squareName = (sq: number) => FILES[sq & 7] + String((sq >> 4) + 1);

export function parseSquare(s: string): number {
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

  // Undo stack (one entry per make / makeNull). Grows on demand, so a long game never runs out.
  private sp = 0;
  private uMove: Int32Array;
  private uCaptured: Int8Array;
  private uCastle: Int8Array;
  private uEp: Int16Array;
  private uHalf: Int32Array;
  private uHashLo: Int32Array;
  private uHashHi: Int32Array;

  // Hashes of every position reached (game history + search path), for repetition detection.
  private histLen = 0;
  private histLo: Int32Array;
  private histHi: Int32Array;

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

  private grow(): void {
    const n = this.uMove.length * 2;
    const more = <T extends Int8Array | Int16Array | Int32Array>(a: T, size: number): T => {
      const b = new (a.constructor as new (n: number) => T)(size);
      b.set(a);
      return b;
    };
    this.uMove = more(this.uMove, n);
    this.uCaptured = more(this.uCaptured, n);
    this.uCastle = more(this.uCastle, n);
    this.uEp = more(this.uEp, n);
    this.uHalf = more(this.uHalf, n);
    this.uHashLo = more(this.uHashLo, n);
    this.uHashHi = more(this.uHashHi, n);
    this.histLo = more(this.histLo, n + 1);
    this.histHi = more(this.histHi, n + 1);
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

    if (this.sp === this.uMove.length) this.grow();
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
    if (this.sp === this.uMove.length) this.grow();
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
