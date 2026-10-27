import type { Level } from '../core/types';

export interface ThinkRequest {
  /** Position the game started from. */
  fen: string;
  /** UCI moves played from `fen` to the current position (lets the engine see repetitions). */
  history: string[];
  level: Level;
}

export interface ThinkResult {
  /** UCI move, e.g. "e2e4" or "e7e8q". */
  move: string;
  /** Centipawns from the side to move's perspective. */
  score: number;
  depth: number;
  nodes: number;
}

export interface Engine {
  think(req: ThinkRequest): Promise<ThinkResult>;
  /** Abort any in-flight search; its pending promise rejects. */
  cancel(): void;
}
