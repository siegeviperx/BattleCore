// Transport-agnostic room / game logic. The server owns the only authoritative game per room (the shared rules
// engine, the same one the client runs); clients only send intents.
import { randomBytes, randomInt } from 'node:crypto';
import {
  RECONNECT_GRACE_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  cleanName,
} from '../../shared/protocol.ts';
import type {
  ClientMessage,
  ErrorCode,
  GameResult,
  ServerMessage,
  Side,
  Snapshot,
} from '../../shared/protocol.ts';
import { ChessGame, START_FEN } from '../../shared/rules/game.ts';

/** One connected client, as seen by the room logic. */
export interface Peer {
  send(msg: ServerMessage): void;
  /** Called when another connection takes over this peer's seat via `resume`. */
  close?(): void;
}

interface Player {
  side: Side;
  name: string | null;
  /** Chosen army (pack id), or null for the client's default. Follows the player when sides swap. */
  army: string | null;
  token: string;
  peer: Peer | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
  wantsRematch: boolean;
}

const UCI_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const other = (s: Side): Side => (s === 'w' ? 'b' : 'w');

export class Room {
  readonly code: string;
  chess = new ChessGame();
  moves: string[] = [];
  players: Player[] = [];
  started = false;
  result: GameResult | null = null;
  drawOfferFrom: Side | null = null;

  constructor(code: string) {
    this.code = code;
  }

  get active(): boolean {
    return this.started && this.result === null;
  }

  opponentOf(p: Player): Player | null {
    return this.players.find((x) => x !== p) ?? null;
  }

  broadcast(msg: ServerMessage): void {
    for (const p of this.players) p.peer?.send(msg);
  }

  snapshot(p: Player): Snapshot {
    const opp = this.opponentOf(p);
    return {
      code: this.code,
      you: p.side,
      startFen: START_FEN,
      moves: [...this.moves],
      opponentConnected: !!opp?.peer,
      started: this.started,
      result: this.result,
      drawOffered: opp !== null && this.drawOfferFrom === opp.side,
      youName: p.name,
      opponentName: opp?.name ?? null,
      armies: {
        w: this.players.find((x) => x.side === 'w')?.army ?? null,
        b: this.players.find((x) => x.side === 'b')?.army ?? null,
      },
    };
  }

  sendSnapshot(p: Player): void {
    p.peer?.send({ t: 'snapshot', snapshot: this.snapshot(p) });
  }
}

export interface RoomManagerOptions {
  graceMs?: number;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly seats = new Map<Peer, { room: Room; player: Player }>();
  private readonly graceMs: number;

  constructor(opts: RoomManagerOptions = {}) {
    this.graceMs = opts.graceMs ?? RECONNECT_GRACE_MS;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** Handle a validated message from a peer that has already completed `hello`. */
  handle(peer: Peer, msg: ClientMessage): void {
    switch (msg.t) {
      case 'hello':
      case 'ping':
        return; // handled by the transport
      case 'create':
        return this.create(peer, msg.side === 'random' ? (randomInt(2) ? 'w' : 'b') : msg.side, msg.name, msg.army);
      case 'join':
        return this.join(peer, msg.code, msg.name, msg.army);
      case 'resume':
        return this.resume(peer, msg.code, msg.token);
    }
    const seat = this.seats.get(peer);
    if (!seat) return err(peer, 'not-in-room', 'You are not in a room');
    const { room, player } = seat;
    switch (msg.t) {
      case 'move':
        return this.move(room, player, msg.uci, msg.ply);
      case 'resign':
        if (!this.requireActive(room, player)) return;
        return this.finish(room, { winner: other(player.side), reason: 'resign' });
      case 'offerDraw':
        return this.offerDraw(room, player);
      case 'answerDraw':
        return this.answerDraw(room, player, msg.accept);
      case 'rematch':
        return this.rematch(room, player);
      case 'leave':
        return this.removePlayer(room, player);
    }
  }

  /** The transport lost this peer's connection. */
  disconnect(peer: Peer): void {
    const seat = this.seats.get(peer);
    if (!seat) return;
    const { room, player } = seat;
    this.seats.delete(peer);
    player.peer = null;
    player.graceTimer = setTimeout(() => {
      player.graceTimer = null;
      this.removePlayer(room, player);
    }, this.graceMs);
    player.graceTimer.unref?.();
    room.opponentOf(player)?.peer?.send({ t: 'opponent', status: 'disconnected' });
  }

  /** Clear all timers and rooms (server shutdown). */
  dispose(): void {
    for (const room of [...this.rooms.values()]) this.deleteRoom(room);
  }

  // --- lobby ---------------------------------------------------------------

  private create(peer: Peer, side: Side, name?: string, army?: string): void {
    if (this.seats.has(peer)) return err(peer, 'bad-request', 'Already in a room');
    const room = new Room(this.newCode());
    this.rooms.set(room.code, room);
    const player = this.addPlayer(room, peer, side, name, army);
    peer.send({ t: 'seated', code: room.code, token: player.token, you: side });
    room.sendSnapshot(player);
  }

  private join(peer: Peer, rawCode: string, name?: string, army?: string): void {
    if (this.seats.has(peer)) return err(peer, 'bad-request', 'Already in a room');
    const room = this.rooms.get(normCode(rawCode));
    if (!room) return err(peer, 'room-not-found', 'No room with that code');
    const host = room.players[0];
    if (room.started || room.players.length !== 1 || !host) return err(peer, 'room-full', 'Room is full');
    const player = this.addPlayer(room, peer, other(host.side), name, army);
    room.started = true;
    peer.send({ t: 'seated', code: room.code, token: player.token, you: player.side });
    room.sendSnapshot(player);
    host.peer?.send({ t: 'opponent', status: 'joined' });
    room.sendSnapshot(host);
  }

  private resume(peer: Peer, rawCode: string, token: string): void {
    if (this.seats.has(peer)) return err(peer, 'bad-request', 'Already in a room');
    const room = this.rooms.get(normCode(rawCode));
    const player = room?.players.find((p) => p.token === token);
    if (!room || !player) return err(peer, 'resume-failed', 'Seat expired or invalid token');
    const wasDisconnected = player.peer === null;
    if (player.peer) {
      // A newer connection takes over a seat whose old socket hasn't noticed it died yet.
      const old = player.peer;
      this.seats.delete(old);
      old.close?.();
    }
    if (player.graceTimer) clearTimeout(player.graceTimer);
    player.graceTimer = null;
    player.peer = peer;
    this.seats.set(peer, { room, player });
    peer.send({ t: 'seated', code: room.code, token: player.token, you: player.side });
    room.sendSnapshot(player);
    const opp = room.opponentOf(player);
    if (opp?.wantsRematch && room.result) peer.send({ t: 'rematchOffered' });
    if (wasDisconnected) opp?.peer?.send({ t: 'opponent', status: 'reconnected' });
  }

  // --- game ----------------------------------------------------------------

  private move(room: Room, player: Player, uci: string, ply: number): void {
    const fail = (code: ErrorCode, message: string): void => {
      err(player.peer, code, message);
      room.sendSnapshot(player);
    };
    if (!room.started) return fail('bad-request', 'Game has not started');
    if (room.result) return fail('game-over', 'Game is over');
    if (room.chess.turn !== player.side) return fail('not-your-turn', 'Not your turn');
    if (ply !== room.moves.length) return fail('bad-request', `Stale ply ${ply}, expected ${room.moves.length}`);
    if (!UCI_RE.test(uci)) return fail('illegal-move', `Malformed move ${uci}`);
    const done = room.chess.move(uci);
    if (!done) return fail('illegal-move', `Illegal move ${uci}`);
    room.moves.push(uci);
    room.drawOfferFrom = null;
    room.broadcast({ t: 'moved', uci, san: done.san, ply: room.moves.length - 1 });

    const outcome = room.chess.outcome();
    if (outcome.over) {
      const result: GameResult =
        outcome.reason === 'checkmate' ? { winner: outcome.winner, reason: 'checkmate' } : { winner: 'draw', reason: outcome.reason };
      this.finish(room, result);
    }
  }

  private requireActive(room: Room, player: Player): boolean {
    if (room.active) return true;
    if (room.result) err(player.peer, 'game-over', 'Game is over');
    else err(player.peer, 'bad-request', 'Game has not started');
    return false;
  }

  private offerDraw(room: Room, player: Player): void {
    if (!this.requireActive(room, player)) return;
    if (room.drawOfferFrom === player.side) return; // duplicate
    if (room.drawOfferFrom === other(player.side)) {
      // Both sides offered: treat as acceptance.
      return this.finish(room, { winner: 'draw', reason: 'agreement' });
    }
    room.drawOfferFrom = player.side;
    room.opponentOf(player)?.peer?.send({ t: 'drawOffered' });
  }

  private answerDraw(room: Room, player: Player, accept: boolean): void {
    if (!this.requireActive(room, player)) return;
    if (room.drawOfferFrom !== other(player.side)) return err(player.peer, 'bad-request', 'No draw offer pending');
    if (accept) return this.finish(room, { winner: 'draw', reason: 'agreement' });
    room.drawOfferFrom = null;
    room.opponentOf(player)?.peer?.send({ t: 'drawDeclined' });
  }

  private rematch(room: Room, player: Player): void {
    if (!room.result) return err(player.peer, 'bad-request', 'Game is not over');
    const opp = room.opponentOf(player);
    if (!opp) return err(player.peer, 'bad-request', 'Opponent has left');
    if (player.wantsRematch) return;
    player.wantsRematch = true;
    if (!opp.wantsRematch) {
      opp.peer?.send({ t: 'rematchOffered' });
      return;
    }
    room.chess = new ChessGame();
    room.moves = [];
    room.result = null;
    room.drawOfferFrom = null;
    for (const p of room.players) {
      p.wantsRematch = false;
      p.side = other(p.side);
    }
    for (const p of room.players) room.sendSnapshot(p);
  }

  private finish(room: Room, result: GameResult): void {
    room.result = result;
    room.drawOfferFrom = null;
    for (const p of room.players) p.wantsRematch = false;
    room.broadcast({ t: 'gameOver', result });
  }

  // --- seats / lifecycle ---------------------------------------------------

  private addPlayer(room: Room, peer: Peer, side: Side, name?: string, army?: string): Player {
    const player: Player = {
      side,
      name: cleanName(name ?? '') || null,
      army: army ?? null,
      token: randomBytes(24).toString('base64url'),
      peer,
      graceTimer: null,
      wantsRematch: false,
    };
    room.players.push(player);
    this.seats.set(peer, { room, player });
    return player;
  }

  /** `leave` or grace expiry: free the seat; forfeits an active game. */
  private removePlayer(room: Room, player: Player): void {
    if (player.graceTimer) clearTimeout(player.graceTimer);
    player.graceTimer = null;
    if (player.peer) this.seats.delete(player.peer);
    player.peer = null;
    const wasActive = room.active;
    room.players = room.players.filter((p) => p !== player);
    if (!room.started || room.players.length === 0) return this.deleteRoom(room);
    const opp = room.players[0];
    opp?.peer?.send({ t: 'opponent', status: 'left' });
    if (wasActive && opp) this.finish(room, { winner: opp.side, reason: 'abandon' });
    this.cleanup(room);
  }

  private cleanup(room: Room): void {
    if (room.players.every((p) => p.peer === null && p.graceTimer === null)) this.deleteRoom(room);
  }

  private deleteRoom(room: Room): void {
    for (const p of room.players) {
      if (p.graceTimer) clearTimeout(p.graceTimer);
      p.graceTimer = null;
      if (p.peer) this.seats.delete(p.peer);
    }
    this.rooms.delete(room.code);
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }
}

function normCode(code: string): string {
  return code.trim().toUpperCase();
}

function err(peer: Peer | null, code: ErrorCode, message: string): void {
  peer?.send({ t: 'error', code, message });
}
