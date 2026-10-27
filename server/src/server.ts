// Transport: HTTP (+ /health) and WebSocket handling. Game logic lives in rooms.ts.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { PROTOCOL_VERSION } from '../../shared/protocol.ts';
import type { ErrorCode, ServerMessage } from '../../shared/protocol.ts';
import { RoomManager } from './rooms.ts';
import type { Peer } from './rooms.ts';
import { parseClientMessage } from './validate.ts';

export const MAX_MESSAGE_BYTES = 4096;

export interface ServerOptions {
  port?: number;
  host?: string;
  /** Seat hold time after a disconnect (default RECONNECT_GRACE_MS). */
  graceMs?: number;
  /** ws-level ping interval; a socket missing one full interval is terminated (default 15s → ~30s). */
  heartbeatMs?: number;
  /** Max messages per socket per `rateWindowMs` before the socket is closed (default 20 / 1000ms). */
  rateLimit?: number;
  rateWindowMs?: number;
}

export interface RunningServer {
  port: number;
  manager: RoomManager;
  close(): Promise<void>;
}

export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const manager = new RoomManager({ graceMs: opts.graceMs });
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const rateLimit = opts.rateLimit ?? 20;
  const rateWindowMs = opts.rateWindowMs ?? 1000;

  const http = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, rooms: manager.roomCount }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  // Hard cap well above the 4KB soft limit so oversized messages get a polite `bad-request`.
  const wss = new WebSocketServer({ server: http, maxPayload: 64 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('error', () => {}); // 'close' follows; never crash on socket errors

    let helloed = false;
    let closed = false;
    let windowStart = Date.now();
    let windowCount = 0;

    const send = (msg: ServerMessage): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    const error = (code: ErrorCode, message: string): void => send({ t: 'error', code, message });
    const peer: Peer = {
      send,
      close: () => ws.close(4000, 'Seat resumed elsewhere'),
    };

    ws.on('message', (data, isBinary) => {
      if (closed) return;
      alive.set(ws, true);

      const now = Date.now();
      if (now - windowStart >= rateWindowMs) {
        windowStart = now;
        windowCount = 0;
      }
      if (++windowCount > rateLimit) {
        closed = true;
        ws.close(1008, 'Rate limit exceeded');
        return;
      }

      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      if (isBinary) return error('bad-request', 'Binary frames are not supported');
      if (buf.length > MAX_MESSAGE_BYTES) return error('bad-request', 'Message too large');
      const msg = parseClientMessage(buf.toString('utf8'));
      if (!msg) return error('bad-request', 'Malformed or unknown message');

      if (msg.t === 'ping') return send({ t: 'pong' });
      if (msg.t === 'hello') {
        if (msg.version !== PROTOCOL_VERSION) {
          return error('bad-version', `Server speaks protocol ${PROTOCOL_VERSION}, client sent ${msg.version}`);
        }
        helloed = true;
        return;
      }
      if (!helloed) return error('bad-request', 'Send hello first');
      try {
        manager.handle(peer, msg);
      } catch (e) {
        console.error('handler error', e);
        error('bad-request', 'Internal error handling message');
      }
    });

    ws.on('close', () => {
      closed = true;
      manager.disconnect(peer);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, heartbeatMs);
  heartbeat.unref();

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port ?? 8787, opts.host ?? '0.0.0.0', () => {
      http.off('error', reject);
      const port = (http.address() as AddressInfo).port;
      resolve({
        port,
        manager,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(heartbeat);
            for (const ws of wss.clients) ws.terminate();
            manager.dispose();
            wss.close(() => http.close(() => done()));
            http.closeAllConnections();
          }),
      });
    });
  });
}
