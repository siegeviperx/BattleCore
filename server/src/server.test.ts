import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../shared/protocol.ts';
import type { ServerMessage, Snapshot } from '../../shared/protocol.ts';
import { startServer } from './server.ts';
import type { RunningServer } from './server.ts';

const GRACE = 200;
let srv: RunningServer;
let clients: Client[] = [];

type Msg<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

class Client {
  ws: WebSocket;
  queue: ServerMessage[] = [];
  waiter: (() => void) | null = null;
  closed: Promise<number>;

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on('message', (d) => {
      this.queue.push(JSON.parse(d.toString()));
      this.waiter?.();
    });
    this.closed = new Promise((r) => this.ws.on('close', (code) => r(code)));
    clients.push(this);
  }

  static async open(port: number, hello = true): Promise<Client> {
    const c = new Client(port);
    await new Promise((r, j) => {
      c.ws.once('open', r);
      c.ws.once('error', j);
    });
    if (hello) c.send({ t: 'hello', version: PROTOCOL_VERSION });
    return c;
  }

  send(obj: unknown): void {
    this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  /** Next message in order; asserts its type. */
  async next<T extends ServerMessage['t']>(t: T, timeout = 1500): Promise<Msg<T>> {
    const deadline = Date.now() + timeout;
    while (this.queue.length === 0) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timeout waiting for ${t}`);
      await new Promise<void>((r) => {
        const timer = setTimeout(r, left);
        this.waiter = () => {
          clearTimeout(timer);
          r();
        };
      });
      this.waiter = null;
    }
    const m = this.queue.shift()!;
    expect(m.t, `expected ${t}, got ${JSON.stringify(m)}`).toBe(t);
    return m as Msg<T>;
  }

  async snapshot(): Promise<Snapshot> {
    return (await this.next('snapshot')).snapshot;
  }

  async error(code: string): Promise<void> {
    const e = await this.next('error');
    expect(e.code).toBe(code);
  }

  async quiet(ms = 80): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
    expect(this.queue).toEqual([]);
  }
}

/** Create a room with `host` as white and seat a guest. Drains setup messages. */
async function pair(side: 'w' | 'b' = 'w') {
  const host = await Client.open(srv.port);
  host.send({ t: 'create', side });
  const seatedH = await host.next('seated');
  const snap0 = await host.snapshot();
  const guest = await Client.open(srv.port);
  guest.send({ t: 'join', code: seatedH.code });
  const seatedG = await guest.next('seated');
  const snapG = await guest.snapshot();
  await host.next('opponent');
  const snapH = await host.snapshot();
  return { host, guest, seatedH, seatedG, snap0, snapG, snapH, code: seatedH.code };
}

async function play(white: Client, black: Client, ucis: string[], startPly = 0) {
  let ply = startPly;
  for (const uci of ucis) {
    const mover = ply % 2 === 0 ? white : black;
    mover.send({ t: 'move', uci, ply });
    const a = await white.next('moved');
    const b = await black.next('moved');
    expect(a).toEqual(b);
    expect(a.uci).toBe(uci);
    expect(a.ply).toBe(ply);
    ply++;
  }
}

beforeEach(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', graceMs: GRACE });
});
afterEach(async () => {
  for (const c of clients) c.ws.terminate();
  clients = [];
  await srv.close();
});

describe('lobby', () => {
  it('create + join sends seated then snapshot', async () => {
    const { seatedH, seatedG, snap0, snapG, snapH, code } = await pair('b');
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    expect(seatedH.you).toBe('b');
    expect(seatedG.you).toBe('w');
    expect(seatedH.token).not.toBe(seatedG.token);
    expect(snap0).toMatchObject({ code, you: 'b', started: false, opponentConnected: false, moves: [], result: null });
    expect(snapG).toMatchObject({ you: 'w', started: true, opponentConnected: true });
    expect(snapH).toMatchObject({ you: 'b', started: true, opponentConnected: true });
  });

  it('shares cleaned player names in snapshots', async () => {
    const host = await Client.open(srv.port);
    host.send({ t: 'create', side: 'w', name: '  Ada\n  the   Great  ' });
    const { code } = await host.next('seated');
    expect(await host.snapshot()).toMatchObject({ youName: 'Ada the Great', opponentName: null });
    const guest = await Client.open(srv.port);
    guest.send({ t: 'join', code, name: 'Rex' });
    await guest.next('seated');
    expect(await guest.snapshot()).toMatchObject({ youName: 'Rex', opponentName: 'Ada the Great' });
    await host.next('opponent');
    expect(await host.snapshot()).toMatchObject({ youName: 'Ada the Great', opponentName: 'Rex' });
  });

  it("shares each player's army by side, and the armies follow the players on rematch", async () => {
    const host = await Client.open(srv.port);
    host.send({ t: 'create', side: 'w', army: 'dragons' });
    const { code } = await host.next('seated');
    expect((await host.snapshot()).armies).toEqual({ w: 'dragons', b: null });
    const guest = await Client.open(srv.port);
    guest.send({ t: 'join', code, army: 'dinos' });
    await guest.next('seated');
    expect((await guest.snapshot()).armies).toEqual({ w: 'dragons', b: 'dinos' });
    await host.next('opponent');
    expect((await host.snapshot()).armies).toEqual({ w: 'dragons', b: 'dinos' });
    host.send({ t: 'resign' });
    await host.next('gameOver');
    await guest.next('gameOver');
    host.send({ t: 'rematch' });
    await guest.next('rematchOffered');
    guest.send({ t: 'rematch' });
    expect((await host.snapshot()).armies).toEqual({ w: 'dinos', b: 'dragons' });
  });

  it('army is optional; a malformed army id is rejected', async () => {
    const { snapH } = await pair();
    expect(snapH.armies).toEqual({ w: null, b: null });
    for (const army of ['Dragons', '../x', 42, 'a'.repeat(40)]) {
      const c = await Client.open(srv.port);
      c.send({ t: 'create', side: 'w', army });
      await c.error('bad-request');
    }
  });

  it('names are optional; a non-string name is rejected', async () => {
    const { snapH } = await pair();
    expect(snapH).toMatchObject({ youName: null, opponentName: null });
    const c = await Client.open(srv.port);
    c.send({ t: 'create', side: 'w', name: 42 });
    await c.error('bad-request');
  });

  it('join is case-insensitive and trims', async () => {
    const host = await Client.open(srv.port);
    host.send({ t: 'create', side: 'random' });
    const { code, you } = await host.next('seated');
    await host.snapshot();
    const g = await Client.open(srv.port);
    g.send({ t: 'join', code: `  ${code.toLowerCase()} ` });
    expect((await g.next('seated')).you).toBe(you === 'w' ? 'b' : 'w');
  });

  it('room-full and room-not-found', async () => {
    const { code } = await pair();
    const third = await Client.open(srv.port);
    third.send({ t: 'join', code });
    await third.error('room-full');
    third.send({ t: 'join', code: 'ZZZZZZ' });
    await third.error('room-not-found');
  });

  it('requires hello and correct version', async () => {
    const c = await Client.open(srv.port, false);
    c.send({ t: 'create', side: 'w' });
    await c.error('bad-request');
    c.send({ t: 'hello', version: 999 });
    await c.error('bad-version');
    c.send({ t: 'ping' });
    await c.next('pong');
  });

  it('a socket can only be in one room', async () => {
    const { host } = await pair();
    host.send({ t: 'create', side: 'w' });
    await host.error('bad-request');
  });
});

describe('game', () => {
  it("fool's mate ends in checkmate for both", async () => {
    const { host: w, guest: b } = await pair('w');
    await play(w, b, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    for (const c of [w, b]) {
      const g = await c.next('gameOver');
      expect(g.result).toEqual({ winner: 'b', reason: 'checkmate' });
    }
    w.send({ t: 'move', uci: 'e2e4', ply: 4 });
    await w.error('game-over');
    expect((await w.snapshot()).result).toEqual({ winner: 'b', reason: 'checkmate' });
  });

  it('rejects illegal, wrong-turn and stale-ply moves with a resync snapshot', async () => {
    const { host: w, guest: b } = await pair('w');
    w.send({ t: 'move', uci: 'e2e5', ply: 0 });
    await w.error('illegal-move');
    expect((await w.snapshot()).moves).toEqual([]);

    b.send({ t: 'move', uci: 'e7e5', ply: 0 });
    await b.error('not-your-turn');
    await b.snapshot();

    await play(w, b, ['e2e4']);
    w.send({ t: 'move', uci: 'e4e5', ply: 0 });
    await w.error('not-your-turn');
    await w.snapshot();
    b.send({ t: 'move', uci: 'e7e5', ply: 0 });
    await b.error('bad-request');
    expect((await b.snapshot()).moves).toEqual(['e2e4']);

    b.send({ t: 'move', uci: 'garbage', ply: 1 });
    await b.error('illegal-move');
    await b.snapshot();
    b.send('{not json');
    await b.error('bad-request');
    b.send({ t: 'nope' });
    await b.error('bad-request');
    b.send(JSON.stringify({ t: 'ping', pad: 'x'.repeat(5000) }));
    await b.error('bad-request');
    await w.quiet();
    // server still fine
    b.send({ t: 'move', uci: 'e7e5', ply: 1 });
    expect((await w.next('moved')).san).toBe('e5');
  });

  it('promotion requires lowercase letter', async () => {
    const { host: w, guest: b } = await pair('w');
    await play(w, b, ['a2a4', 'b7b5', 'a4b5', 'a7a6', 'b5a6', 'c8b7', 'a6a7', 'b7c6']);
    w.send({ t: 'move', uci: 'a7b8', ply: 8 });
    await w.error('illegal-move');
    await w.snapshot();
    w.send({ t: 'move', uci: 'a7b8Q', ply: 8 });
    await w.error('illegal-move');
    await w.snapshot();
    w.send({ t: 'move', uci: 'a7b8n', ply: 8 });
    const m = await w.next('moved');
    expect(m.san).toBe('axb8=N');
    await b.next('moved');
  });

  it('resign', async () => {
    const { host: w, guest: b } = await pair('w');
    b.send({ t: 'resign' });
    for (const c of [w, b]) expect((await c.next('gameOver')).result).toEqual({ winner: 'w', reason: 'resign' });
  });

  it('draw offer decline then accept; move clears offer', async () => {
    const { host: w, guest: b } = await pair('w');
    w.send({ t: 'offerDraw' });
    w.send({ t: 'offerDraw' }); // duplicate ignored
    await b.next('drawOffered');
    b.send({ t: 'answerDraw', accept: false });
    await w.next('drawDeclined');
    await b.quiet();

    w.send({ t: 'offerDraw' });
    await b.next('drawOffered');
    await play(w, b, ['e2e4']); // move clears offer
    b.send({ t: 'answerDraw', accept: true });
    await b.error('bad-request');

    b.send({ t: 'offerDraw' });
    await w.next('drawOffered');
    w.send({ t: 'answerDraw', accept: true });
    for (const c of [w, b]) expect((await c.next('gameOver')).result).toEqual({ winner: 'draw', reason: 'agreement' });
  });

  it('rematch swaps sides', async () => {
    const { host, guest } = await pair('w');
    host.send({ t: 'rematch' });
    await host.error('bad-request'); // not over yet
    host.send({ t: 'resign' });
    await host.next('gameOver');
    await guest.next('gameOver');
    host.send({ t: 'rematch' });
    await guest.next('rematchOffered');
    guest.send({ t: 'rematch' });
    const sh = await host.snapshot();
    const sg = await guest.snapshot();
    expect(sh).toMatchObject({ you: 'b', moves: [], result: null, started: true });
    expect(sg).toMatchObject({ you: 'w', moves: [], result: null, started: true });
    // guest (now white) moves first
    await play(guest, host, ['d2d4']);
  });
});

describe('disconnects', () => {
  it('resume within grace restores state', async () => {
    const { host: w, guest: b, seatedG, code } = await pair('w');
    await play(w, b, ['e2e4', 'e7e5']);
    b.ws.terminate();
    await w.next('opponent').then((m) => expect(m.status).toBe('disconnected'));

    const bad = await Client.open(srv.port);
    bad.send({ t: 'resume', code, token: 'wrong' });
    await bad.error('resume-failed');

    const b2 = await Client.open(srv.port);
    b2.send({ t: 'resume', code: code.toLowerCase(), token: seatedG.token });
    expect(await b2.next('seated')).toMatchObject({ code, you: 'b', token: seatedG.token });
    expect(await b2.snapshot()).toMatchObject({ moves: ['e2e4', 'e7e5'], opponentConnected: true, started: true });
    expect((await w.next('opponent')).status).toBe('reconnected');
    await play(w, b2, ['g1f3'], 2);

    // grace no longer pending: waiting past it must not forfeit
    await new Promise((r) => setTimeout(r, GRACE + 100));
    await w.quiet(0);
  });

  it('grace expiry forfeits by abandon; resume then fails', async () => {
    const { host: w, guest: b, seatedG, code } = await pair('w');
    b.ws.terminate();
    expect((await w.next('opponent')).status).toBe('disconnected');
    expect((await w.next('opponent', GRACE + 1000)).status).toBe('left');
    expect((await w.next('gameOver')).result).toEqual({ winner: 'w', reason: 'abandon' });
    const b2 = await Client.open(srv.port);
    b2.send({ t: 'resume', code, token: seatedG.token });
    await b2.error('resume-failed');
  });

  it('lonely waiting room is deleted after grace', async () => {
    const host = await Client.open(srv.port);
    host.send({ t: 'create', side: 'w' });
    const { code } = await host.next('seated');
    expect(srv.manager.roomCount).toBe(1);
    host.ws.terminate();
    await new Promise((r) => setTimeout(r, GRACE + 100));
    expect(srv.manager.roomCount).toBe(0);
    const g = await Client.open(srv.port);
    g.send({ t: 'join', code });
    await g.error('room-not-found');
  });

  it('leave forfeits an active game', async () => {
    const { host: w, guest: b } = await pair('w');
    b.send({ t: 'leave' });
    expect((await w.next('opponent')).status).toBe('left');
    expect((await w.next('gameOver')).result).toEqual({ winner: 'w', reason: 'abandon' });
    b.send({ t: 'resign' });
    await b.error('not-in-room');
  });
});

describe('transport', () => {
  it('/health and 404', async () => {
    await pair();
    const r = await fetch(`http://127.0.0.1:${srv.port}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, rooms: 1 });
    expect((await fetch(`http://127.0.0.1:${srv.port}/nope`)).status).toBe(404);
  });

  it('closes sockets that flood messages', async () => {
    const c = await Client.open(srv.port);
    for (let i = 0; i < 50; i++) c.send({ t: 'ping' });
    expect(await c.closed).toBe(1008);
  });
});
