// Game-level chess rules on top of the 0x88 board: legal moves with SAN, FEN, history with undo, and every
// way a game can end. The client's game state and the server's rooms both use this, so the two always agree.
// Dependency-free and erasable-syntax only, like the rest of shared/.
import {
  BISHOP,
  BLACK,
  Board,
  F_CAPTURE,
  F_CASTLE,
  F_EP,
  KNIGHT,
  PAWN,
  PROMO_CHARS,
  START_FEN,
  WHITE,
  WK,
  WQ,
  BK,
  BQ,
  formatUci,
  moveFlags,
  moveFrom,
  movePromo,
  moveTo,
  parseSquare,
  squareName,
} from './board.ts';

export { START_FEN } from './board.ts';

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface RulesPiece {
  square: string;
  color: Color;
  type: PieceType;
}

/** A legal move, fully described (what chess.js calls a verbose move). */
export interface RulesMove {
  from: string;
  to: string;
  /** e.g. "e2e4", "e7e8q", castling as the king's move "e1g1". */
  uci: string;
  san: string;
  color: Color;
  piece: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
  /** En passant: the captured pawn stands beside `to`, not on it. */
  enPassant: boolean;
  /** Castling side, or null. */
  castle: 'k' | 'q' | null;
}

export type Outcome =
  | { over: false }
  | { over: true; reason: 'checkmate'; winner: Color }
  | { over: true; reason: 'stalemate' | 'insufficient' | 'repetition' | 'fifty-move' };

const TYPE_CHARS = ' pnbrqk';
const SAN_LETTERS = '  NBRQK';
const colorOf = (side: number): Color => (side === WHITE ? 'w' : 'b');

export class ChessGame {
  readonly startFen: string;
  private board: Board;
  private codes: number[] = [];
  private played: RulesMove[] = [];
  /** Repetition key of every position so far, the start position first. */
  private keys: string[] = [];
  /** Legal moves of the current position, computed once per position. */
  private legalCache: number[] | null = null;

  constructor(fen: string = START_FEN) {
    this.board = new Board(fen);
    this.startFen = fen;
    this.keys.push(this.positionKey());
  }

  get turn(): Color {
    return colorOf(this.board.side);
  }

  /** FEN, with an en passant square only when an en passant capture is actually legal (as chess.js does). */
  fen(): string {
    const b = this.board;
    return `${this.positionKey()} ${b.halfmove} ${b.fullmove}`;
  }

  pieces(): RulesPiece[] {
    const out: RulesPiece[] = [];
    for (let rank = 7; rank >= 0; rank--) {
      for (let file = 0; file < 8; file++) {
        const p = this.board.sq[rank * 16 + file];
        if (p) out.push({ square: squareName(rank * 16 + file), color: colorOf(p >> 3), type: TYPE_CHARS[p & 7] as PieceType });
      }
    }
    return out;
  }

  get(square: string): { color: Color; type: PieceType } | null {
    const sq = parseSquare(square);
    const p = sq < 0 ? 0 : this.board.sq[sq];
    return p ? { color: colorOf(p >> 3), type: TYPE_CHARS[p & 7] as PieceType } : null;
  }

  /** Legal moves, optionally only those of the piece on `square`. */
  moves(square?: string): RulesMove[] {
    const legal = this.legal();
    const from = square === undefined ? -1 : parseSquare(square);
    return legal.filter((m) => from < 0 || moveFrom(m) === from).map((m) => this.describe(m, legal));
  }

  /** Plays a move given as UCI ("e2e4", "e7e8q"). A promotion without a piece letter is refused. Returns null if illegal. */
  move(uci: string): RulesMove | null {
    const m = this.find(uci);
    if (!m) return null;
    const info = this.describe(m, this.legal());
    this.board.make(m);
    this.legalCache = null;
    this.codes.push(m);
    this.played.push(info);
    this.keys.push(this.positionKey());
    return info;
  }

  undo(): RulesMove | null {
    if (this.codes.length === 0) return null;
    this.board.unmake();
    this.legalCache = null;
    this.codes.pop();
    this.keys.pop();
    return this.played.pop() ?? null;
  }

  history(): readonly RulesMove[] {
    return this.played;
  }

  inCheck(): boolean {
    return this.board.inCheck();
  }

  /** Square of `color`'s king. */
  kingSquare(color: Color): string {
    return squareName(this.board.kingSq[color === 'w' ? WHITE : BLACK]);
  }

  isCheckmate(): boolean {
    return this.board.inCheck() && this.legal().length === 0;
  }

  isStalemate(): boolean {
    return !this.board.inCheck() && this.legal().length === 0;
  }

  /** Same cases as chess.js: K v K, K + one minor v K, and any number of bishops all on one square color. */
  isInsufficientMaterial(): boolean {
    let pieces = 0;
    let minors = 0;
    let bishops = 0;
    let lightBishops = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 8) {
        sq += 7;
        continue;
      }
      const p = this.board.sq[sq];
      if (!p) continue;
      pieces++;
      const t = p & 7;
      if (t === KNIGHT || t === BISHOP) minors++;
      if (t === BISHOP) {
        bishops++;
        if (((sq & 7) + (sq >> 4)) & 1) lightBishops++;
      }
    }
    if (pieces === 2) return true;
    if (pieces === 3 && minors === 1) return true;
    return pieces === bishops + 2 && (lightBishops === 0 || lightBishops === bishops);
  }

  isThreefoldRepetition(): boolean {
    const key = this.keys[this.keys.length - 1];
    let n = 0;
    for (const k of this.keys) if (k === key) n++;
    return n >= 3;
  }

  isDrawByFiftyMoves(): boolean {
    return this.board.halfmove >= 100;
  }

  outcome(): Outcome {
    if (this.legal().length === 0) {
      return this.board.inCheck() ? { over: true, reason: 'checkmate', winner: colorOf(this.board.side ^ 1) } : { over: true, reason: 'stalemate' };
    }
    if (this.isInsufficientMaterial()) return { over: true, reason: 'insufficient' };
    if (this.isThreefoldRepetition()) return { over: true, reason: 'repetition' };
    if (this.isDrawByFiftyMoves()) return { over: true, reason: 'fifty-move' };
    return { over: false };
  }

  // --- internals --------------------------------------------------------------------------------

  private legal(): number[] {
    return (this.legalCache ??= this.board.legalMoves());
  }

  private find(uci: string): number {
    if (uci.length < 4 || uci.length > 5) return 0;
    const from = parseSquare(uci.slice(0, 2));
    const to = parseSquare(uci.slice(2, 4));
    const promo = uci.length === 5 ? uci[4] : '';
    for (const m of this.legal()) {
      if (moveFrom(m) !== from || moveTo(m) !== to) continue;
      const p = movePromo(m);
      if ((p ? PROMO_CHARS[p] : '') === promo) return m;
    }
    return 0;
  }

  /** Placement, side, castling and en passant: the FEN fields that decide whether two positions repeat. */
  private positionKey(): string {
    const b = this.board;
    const rows: string[] = [];
    for (let rank = 7; rank >= 0; rank--) {
      let row = '';
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = b.sq[rank * 16 + file];
        if (!p) {
          empty++;
          continue;
        }
        if (empty) row += empty;
        empty = 0;
        const ch = TYPE_CHARS[p & 7];
        row += p >> 3 ? ch : ch.toUpperCase();
      }
      rows.push(empty ? row + empty : row);
    }
    const c = b.castling;
    const castling = (c & WK ? 'K' : '') + (c & WQ ? 'Q' : '') + (c & BK ? 'k' : '') + (c & BQ ? 'q' : '') || '-';
    const ep = b.ep >= 0 && this.legal().some((m) => moveFlags(m) & F_EP) ? squareName(b.ep) : '-';
    return `${rows.join('/')} ${b.side === WHITE ? 'w' : 'b'} ${castling} ${ep}`;
  }

  /** Full description of legal move `m`; `legal` is every legal move in the position (for SAN disambiguation). */
  private describe(m: number, legal: number[]): RulesMove {
    const b = this.board;
    const from = moveFrom(m);
    const to = moveTo(m);
    const flags = moveFlags(m);
    const p = b.sq[from];
    const type = p & 7;
    const promo = movePromo(m);
    const capturedCode = flags & F_EP ? PAWN : flags & F_CAPTURE ? b.sq[to] & 7 : 0;
    const castle = flags & F_CASTLE ? (to > from ? 'k' : 'q') : null;

    let san: string;
    if (castle) {
      san = castle === 'k' ? 'O-O' : 'O-O-O';
    } else if (type === PAWN) {
      san = (capturedCode ? `${squareName(from)[0]}x` : '') + squareName(to) + (promo ? `=${SAN_LETTERS[promo]}` : '');
    } else {
      // Disambiguate against other pieces of the same type that can reach the same square.
      const rivals = legal.filter((o) => o !== m && moveTo(o) === to && b.sq[moveFrom(o)] === p && moveFrom(o) !== from);
      let dis = '';
      if (rivals.length) {
        const sameFile = rivals.some((o) => (moveFrom(o) & 7) === (from & 7));
        const sameRank = rivals.some((o) => moveFrom(o) >> 4 === from >> 4);
        const name = squareName(from);
        dis = !sameFile ? name[0] : !sameRank ? name[1] : name;
      }
      san = SAN_LETTERS[type] + dis + (capturedCode ? 'x' : '') + squareName(to);
    }
    b.make(m);
    if (b.inCheck()) san += b.legalMoves().length === 0 ? '#' : '+';
    b.unmake();

    const info: RulesMove = {
      from: squareName(from),
      to: squareName(to),
      uci: formatUci(m),
      san,
      color: colorOf(p >> 3),
      piece: TYPE_CHARS[type] as PieceType,
      enPassant: (flags & F_EP) !== 0,
      castle,
    };
    if (capturedCode) info.captured = TYPE_CHARS[capturedCode] as PieceType;
    if (promo) info.promotion = TYPE_CHARS[promo] as PieceType;
    return info;
  }
}
