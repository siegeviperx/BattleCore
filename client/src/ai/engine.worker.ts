// Web Worker wrapper around the engine: receives {id, req}, replies {id, result} or {id, error}.

import { findMove } from './engine';
import type { ThinkRequest } from './types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<{ id: number; req: ThinkRequest }>) => {
  const { id, req } = e.data;
  try {
    ctx.postMessage({ id, result: findMove(req) });
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
