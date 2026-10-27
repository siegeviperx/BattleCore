// WebSocket connection to the BattleCore game server, with automatic resume after drops.
import {
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
  type ClientMessage,
  type ServerMessage,
} from '../../../shared/protocol';

export type ConnectionState = 'connected' | 'reconnecting' | 'lost';

const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
/** Server closes an old socket with this code when the same seat is resumed elsewhere. */
const SEAT_TAKEN_CLOSE_CODE = 4000;

export function defaultServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.hostname || 'localhost'}:8787`;
}

export class OnlineClient {
  private ws: WebSocket | null = null;
  private messageListeners = new Set<(msg: ServerMessage) => void>();
  private stateListeners = new Set<(state: ConnectionState) => void>();
  private seat: { code: string; token: string } | null = null;
  private closed = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private droppedAt = 0;
  private attempt = 0;

  constructor(private readonly url: string = defaultServerUrl()) {}

  /** Open the connection. Rejects if the server can't be reached. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.open();
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error(`Cannot reach ${this.url}`)), { once: true });
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.messageListeners.add(cb);
  }

  onStateChange(cb: (state: ConnectionState) => void): void {
    this.stateListeners.add(cb);
  }

  /** Leave the room (forfeits an active game) and close for good. */
  leave(): void {
    this.send({ t: 'leave' });
    this.close();
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.messageListeners.clear();
    this.stateListeners.clear();
    this.ws?.close();
    this.ws = null;
  }

  private open(): WebSocket {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    let opened = false;
    ws.addEventListener('open', () => {
      opened = true;
      ws.send(JSON.stringify({ t: 'hello', version: PROTOCOL_VERSION } satisfies ClientMessage));
      if (this.seat && this.droppedAt) {
        ws.send(JSON.stringify({ t: 'resume', ...this.seat } satisfies ClientMessage));
        this.droppedAt = 0;
        this.attempt = 0;
        this.emitState('connected');
      }
    });
    ws.addEventListener('message', (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === 'seated') this.seat = { code: msg.code, token: msg.token };
      if (msg.t === 'error' && msg.code === 'resume-failed') this.seat = null;
      for (const cb of this.messageListeners) cb(msg);
    });
    ws.addEventListener('close', (ev) => {
      if (this.ws !== ws || this.closed) return;
      if (ev.code === SEAT_TAKEN_CLOSE_CODE) {
        this.seat = null;
        this.emitState('lost');
        return;
      }
      // A failed first connection is reported by connect(); only retry once we've been in.
      if (!opened && !this.droppedAt) return;
      this.scheduleReconnect();
    });
    return ws;
  }

  private scheduleReconnect(): void {
    if (!this.seat) {
      this.emitState('lost');
      return;
    }
    if (!this.droppedAt) {
      this.droppedAt = Date.now();
      this.emitState('reconnecting');
    }
    if (Date.now() - this.droppedAt > RECONNECT_GRACE_MS) {
      this.emitState('lost');
      return;
    }
    const delay = RETRY_DELAYS_MS[Math.min(this.attempt++, RETRY_DELAYS_MS.length - 1)];
    this.retryTimer = setTimeout(() => {
      if (!this.closed) this.open();
    }, delay);
  }

  private emitState(state: ConnectionState): void {
    for (const cb of this.stateListeners) cb(state);
  }
}
