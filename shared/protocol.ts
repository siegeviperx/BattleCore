// Wire protocol between the browser client and the online game server (JSON over WebSocket).
// Shared verbatim by client/ and server/. Keep it dependency-free and erasable-syntax only
// (no enums/namespaces) so Node can run it with plain type stripping.

/** 2: players choose armies (piece packs); create/join carry `army`, snapshots carry `armies`. */
export const PROTOCOL_VERSION = 2;

/** How long a disconnected player's seat is held before they forfeit. */
export const RECONNECT_GRACE_MS = 60_000;

export const ROOM_CODE_LENGTH = 6;
/** Room code alphabet: no 0/O/1/I/L to avoid misreads. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const NAME_MAX_LENGTH = 16;

/** Army (piece pack) ids look like folder names: "dragons", "baby-army". The client checks they exist. */
export const ARMY_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** A player name as the other player sees it: printable, single-spaced, at most NAME_MAX_LENGTH. '' = no name. */
export function cleanName(raw: string): string {
  const flat = raw.replace(/\p{C}/gu, '').replace(/\s+/g, ' ').trim();
  return [...flat].slice(0, NAME_MAX_LENGTH).join('').trim();
}

export type Side = 'w' | 'b';
export type SidePreference = Side | 'random';

export type GameOverReason =
  | 'checkmate'
  | 'stalemate'
  | 'repetition'
  | 'insufficient'
  | 'fifty-move'
  | 'resign'
  | 'agreement'
  | 'abandon';

export interface GameResult {
  /** Winner, or 'draw'. */
  winner: Side | 'draw';
  reason: GameOverReason;
}

/** Full state of a room from one player's point of view. Sent on start, resume, rematch and resync. */
export interface Snapshot {
  code: string;
  /** The receiving player's side. */
  you: Side;
  startFen: string;
  /** UCI moves played so far. */
  moves: string[];
  opponentConnected: boolean;
  /** False while waiting for the second player to join. */
  started: boolean;
  result: GameResult | null;
  /** A draw offer from the opponent is pending. */
  drawOffered: boolean;
  /** Player names (null = none given). */
  youName: string | null;
  opponentName: string | null;
  /** The army each side plays (piece pack ids); null = that player didn't choose (the client's default). */
  armies: Record<Side, string | null>;
}

export type ClientMessage =
  | { t: 'hello'; version: number }
  | { t: 'create'; side: SidePreference; name?: string; army?: string }
  | { t: 'join'; code: string; name?: string; army?: string }
  | { t: 'resume'; code: string; token: string }
  /** `ply` = number of moves already played when this move was made (rejects stale/duplicate sends). */
  | { t: 'move'; uci: string; ply: number }
  | { t: 'resign' }
  | { t: 'offerDraw' }
  | { t: 'answerDraw'; accept: boolean }
  | { t: 'rematch' }
  | { t: 'leave' }
  | { t: 'ping' };

export type ErrorCode =
  | 'bad-version'
  | 'bad-request'
  | 'room-not-found'
  | 'room-full'
  | 'not-in-room'
  | 'not-your-turn'
  | 'illegal-move'
  | 'game-over'
  | 'resume-failed';

export type ServerMessage =
  /** Seat assigned. Store `token` to resume after a disconnect. Followed by a `snapshot`. */
  | { t: 'seated'; code: string; token: string; you: Side }
  | { t: 'snapshot'; snapshot: Snapshot }
  /** A move was accepted. Sent to BOTH players (the mover treats it as an ack). `ply` = index of this move. */
  | { t: 'moved'; uci: string; san: string; ply: number }
  | { t: 'opponent'; status: 'joined' | 'disconnected' | 'reconnected' | 'left' }
  | { t: 'drawOffered' }
  | { t: 'drawDeclined' }
  | { t: 'gameOver'; result: GameResult }
  /** Opponent wants a rematch; send `rematch` to accept. When both agree, a new `snapshot` follows with sides swapped. */
  | { t: 'rematchOffered' }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'pong' };
