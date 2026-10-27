// Main-thread handle to the chess engine. The search runs in a Web Worker so the UI never blocks.

import type { Engine, ThinkRequest, ThinkResult } from './types';

export type { Engine, ThinkRequest, ThinkResult } from './types';

interface Pending {
  resolve: (r: ThinkResult) => void;
  reject: (e: Error) => void;
}

type WorkerReply = { id: number; result?: ThinkResult; error?: string };

export function createEngine(): Engine {
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const rejectAll = (message: string) => {
    for (const p of pending.values()) p.reject(new Error(message));
    pending.clear();
  };

  // Created lazily: on first use and again after cancel() or a worker crash.
  const getWorker = (): Worker => {
    if (worker) return worker;
    const w = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const { id, result, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error !== undefined || !result) p.reject(new Error(error ?? 'engine returned no result'));
      else p.resolve(result);
    };
    w.onerror = (e: ErrorEvent) => {
      e.preventDefault();
      if (worker === w) {
        w.terminate();
        worker = null;
        rejectAll(e.message || 'engine worker error');
      }
    };
    worker = w;
    return w;
  };

  return {
    think(req: ThinkRequest): Promise<ThinkResult> {
      return new Promise<ThinkResult>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        // Send a plain copy so callers can pass frozen/proxied objects safely.
        getWorker().postMessage({ id, req: { fen: req.fen, history: [...req.history], level: req.level } });
      });
    },
    cancel(): void {
      if (worker) {
        worker.terminate();
        worker = null;
      }
      rejectAll('cancelled');
    },
  };
}
