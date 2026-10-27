// Authoritative game state. Wraps chess.js so the rest of the app never touches it directly.
import { Chess, DEFAULT_POSITION, type Move, type Square as ChessSquare } from 'chess.js';
import { lookCount } from './looks';
import type { BoardPiece, Color, MoveAnim, MoveTarget, PieceType, Square } from './types';

export type GameOutcome =
  | { over: false }
  | { over: true; reason: 'checkmate'; winner: Color }
  | { over: true; reason: 'stalemate' | 'repetition' | 'insufficient' | 'fifty-move' };

export interface PlayedMove {
  san: string;
  uci: string;
  anim: MoveAnim;
}

export class Game {
  readonly startFen: string;
  private chess: Chess;

  constructor(fen: string = DEFAULT_POSITION) {
    this.startFen = fen;
    this.chess = new Chess(fen);
  }

  get turn(): Color {
    return this.chess.turn();
  }

  fen(): string {
    return this.chess.fen();
  }

  pieces(): BoardPiece[] {
    const origin = this.pawnOrigins();
    const out: BoardPiece[] = [];
    for (const row of this.chess.board()) {
      for (const cell of row) {
        if (!cell) continue;
        const p: BoardPiece = { square: cell.square, color: cell.color, type: cell.type };
        const n = lookCount(cell.color, cell.type);
        if (n > 1) p.look = (origin.get(cell.square) ?? fileIndex(cell.square)) % n;
        out.push(p);
      }
    }
    return out;
  }

  /** Starting file (0-7) of each pawn still on the board, keyed by its current square, so a pawn keeps its
   *  look after capturing sideways. */
  private pawnOrigins(): Map<Square, number> {
    const at = new Map<Square, number>();
    const start = new Chess(this.startFen);
    for (const row of start.board()) {
      for (const cell of row) if (cell?.type === 'p') at.set(cell.square, fileIndex(cell.square));
    }
    for (const m of this.chess.history({ verbose: true })) {
      if (m.captured) at.delete(m.isEnPassant() ? m.to[0] + m.from[1] : m.to);
      const f = at.get(m.from);
      at.delete(m.from);
      if (f !== undefined && !m.promotion) at.set(m.to, f);
    }
    return at;
  }

  pieceAt(square: Square): BoardPiece | null {
    const p = this.chess.get(square as ChessSquare);
    return p ? { square, color: p.color, type: p.type } : null;
  }

  /** Legal destinations for the piece on `square` (promotion variants collapsed to one target). */
  legalTargets(square: Square): MoveTarget[] {
    const seen = new Map<Square, MoveTarget>();
    for (const m of this.chess.moves({ square: square as ChessSquare, verbose: true })) {
      if (!seen.has(m.to)) seen.set(m.to, { square: m.to, capture: m.isCapture() });
    }
    return [...seen.values()];
  }

  isPromotion(from: Square, to: Square): boolean {
    return this.chess
      .moves({ square: from as ChessSquare, verbose: true })
      .some((m) => m.to === to && m.isPromotion());
  }

  /** Play a move; returns null if illegal. */
  move(from: Square, to: Square, promotion?: PieceType): PlayedMove | null {
    let m: Move;
    try {
      m = this.chess.move({ from, to, promotion });
    } catch {
      return null;
    }
    return { san: m.san, uci: m.lan, anim: toAnim(m) };
  }

  moveUci(uci: string): PlayedMove | null {
    return this.move(uci.slice(0, 2), uci.slice(2, 4), (uci[4] as PieceType | undefined) || undefined);
  }

  undo(): boolean {
    return this.chess.undo() !== null;
  }

  get ply(): number {
    return this.chess.history().length;
  }

  sanHistory(): string[] {
    return this.chess.history();
  }

  uciHistory(): string[] {
    return this.chess.history({ verbose: true }).map((m) => m.lan);
  }

  lastMove(): { from: Square; to: Square } | null {
    const h = this.chess.history({ verbose: true });
    const m = h[h.length - 1];
    return m ? { from: m.from, to: m.to } : null;
  }

  /** Pieces captured by each side, in capture order. */
  captured(): { byWhite: PieceType[]; byBlack: PieceType[] } {
    const byWhite: PieceType[] = [];
    const byBlack: PieceType[] = [];
    for (const m of this.chess.history({ verbose: true })) {
      if (m.captured) (m.color === 'w' ? byWhite : byBlack).push(m.captured);
    }
    return { byWhite, byBlack };
  }

  /** Square of the side-to-move's king if it is in check. */
  checkSquare(): Square | null {
    if (!this.chess.inCheck()) return null;
    return this.chess.findPiece({ type: 'k', color: this.turn })[0] ?? null;
  }

  outcome(): GameOutcome {
    const c = this.chess;
    if (c.isCheckmate()) return { over: true, reason: 'checkmate', winner: c.turn() === 'w' ? 'b' : 'w' };
    if (c.isStalemate()) return { over: true, reason: 'stalemate' };
    if (c.isInsufficientMaterial()) return { over: true, reason: 'insufficient' };
    if (c.isThreefoldRepetition()) return { over: true, reason: 'repetition' };
    if (c.isDrawByFiftyMoves()) return { over: true, reason: 'fifty-move' };
    return { over: false };
  }
}

function fileIndex(sq: Square): number {
  return sq.charCodeAt(0) - 97;
}

function toAnim(m: Move): MoveAnim {
  const anim: MoveAnim = { from: m.from, to: m.to, color: m.color, piece: m.piece };
  if (m.captured) {
    // En passant: the captured pawn sits beside the destination, on the mover's starting rank.
    const square = m.isEnPassant() ? m.to[0] + m.from[1] : m.to;
    anim.captured = { square, type: m.captured, color: m.color === 'w' ? 'b' : 'w' };
  }
  if (m.promotion) anim.promotion = m.promotion;
  const rank = m.from[1];
  if (m.isKingsideCastle()) anim.rookMove = { from: 'h' + rank, to: 'f' + rank };
  if (m.isQueensideCastle()) anim.rookMove = { from: 'a' + rank, to: 'd' + rank };
  return anim;
}
