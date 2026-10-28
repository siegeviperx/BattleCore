// Authoritative game state. Wraps the shared rules engine (the same one the server runs) so the rest of the
// app never touches it directly.
import { ChessGame, START_FEN, type RulesMove } from '../../../shared/rules/game.ts';
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
  private chess: ChessGame;

  constructor(fen: string = START_FEN) {
    this.startFen = fen;
    this.chess = new ChessGame(fen);
  }

  get turn(): Color {
    return this.chess.turn;
  }

  fen(): string {
    return this.chess.fen();
  }

  pieces(): BoardPiece[] {
    const origin = this.pawnOrigins();
    const out: BoardPiece[] = [];
    for (const cell of this.chess.pieces()) {
      const p: BoardPiece = { square: cell.square, color: cell.color, type: cell.type };
      const n = lookCount(cell.color, cell.type);
      if (n > 1) p.look = (origin.get(cell.square) ?? fileIndex(cell.square)) % n;
      out.push(p);
    }
    return out;
  }

  /** Starting file (0-7) of each pawn still on the board, keyed by its current square, so a pawn keeps its
   *  look after capturing sideways. */
  private pawnOrigins(): Map<Square, number> {
    const at = new Map<Square, number>();
    for (const cell of new ChessGame(this.startFen).pieces()) if (cell.type === 'p') at.set(cell.square, fileIndex(cell.square));
    for (const m of this.chess.history()) {
      if (m.captured) at.delete(m.enPassant ? m.to[0] + m.from[1] : m.to);
      const f = at.get(m.from);
      at.delete(m.from);
      if (f !== undefined && !m.promotion) at.set(m.to, f);
    }
    return at;
  }

  pieceAt(square: Square): BoardPiece | null {
    const p = this.chess.get(square);
    return p ? { square, color: p.color, type: p.type } : null;
  }

  /** Legal destinations for the piece on `square` (promotion variants collapsed to one target). */
  legalTargets(square: Square): MoveTarget[] {
    const seen = new Map<Square, MoveTarget>();
    for (const m of this.chess.moves(square)) {
      if (!seen.has(m.to)) seen.set(m.to, { square: m.to, capture: m.captured !== undefined });
    }
    return [...seen.values()];
  }

  isPromotion(from: Square, to: Square): boolean {
    return this.chess.moves(from).some((m) => m.to === to && m.promotion !== undefined);
  }

  /** Play a move; returns null if illegal (a promotion needs its piece). */
  move(from: Square, to: Square, promotion?: PieceType): PlayedMove | null {
    return this.moveUci(from + to + (promotion ?? ''));
  }

  moveUci(uci: string): PlayedMove | null {
    const m = this.chess.move(uci);
    return m ? { san: m.san, uci: m.uci, anim: toAnim(m) } : null;
  }

  undo(): boolean {
    return this.chess.undo() !== null;
  }

  get ply(): number {
    return this.chess.history().length;
  }

  sanHistory(): string[] {
    return this.chess.history().map((m) => m.san);
  }

  uciHistory(): string[] {
    return this.chess.history().map((m) => m.uci);
  }

  lastMove(): { from: Square; to: Square } | null {
    const h = this.chess.history();
    const m = h[h.length - 1];
    return m ? { from: m.from, to: m.to } : null;
  }

  /** Pieces captured by each side, in capture order. */
  captured(): { byWhite: PieceType[]; byBlack: PieceType[] } {
    const byWhite: PieceType[] = [];
    const byBlack: PieceType[] = [];
    for (const m of this.chess.history()) {
      if (m.captured) (m.color === 'w' ? byWhite : byBlack).push(m.captured);
    }
    return { byWhite, byBlack };
  }

  /** Square of the side-to-move's king if it is in check. */
  checkSquare(): Square | null {
    return this.chess.inCheck() ? this.chess.kingSquare(this.turn) : null;
  }

  outcome(): GameOutcome {
    return this.chess.outcome();
  }
}

function fileIndex(sq: Square): number {
  return sq.charCodeAt(0) - 97;
}

function toAnim(m: RulesMove): MoveAnim {
  const anim: MoveAnim = { from: m.from, to: m.to, color: m.color, piece: m.piece };
  if (m.captured) {
    // En passant: the captured pawn sits beside the destination, on the mover's starting rank.
    const square = m.enPassant ? m.to[0] + m.from[1] : m.to;
    anim.captured = { square, type: m.captured, color: m.color === 'w' ? 'b' : 'w' };
  }
  if (m.promotion) anim.promotion = m.promotion;
  const rank = m.from[1];
  if (m.castle === 'k') anim.rookMove = { from: 'h' + rank, to: 'f' + rank };
  if (m.castle === 'q') anim.rookMove = { from: 'a' + rank, to: 'd' + rank };
  return anim;
}
