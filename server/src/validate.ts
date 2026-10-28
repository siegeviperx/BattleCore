// Strict runtime validation of incoming client messages. Anything that doesn't match the
// contract in shared/protocol.ts exactly is rejected (returns null → `bad-request`).
import { ARMY_ID_RE } from '../../shared/protocol.ts';
import type { ClientMessage } from '../../shared/protocol.ts';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length <= max;

export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(data) || typeof data.t !== 'string') return null;
  const m = data;
  // Optional player name on create/join: absent is fine, anything but a short string is not.
  const name = m.name === undefined ? undefined : isStr(m.name) ? m.name : null;
  // Optional army (pack id) on create/join: absent is fine, anything not shaped like a pack id is not.
  const army = m.army === undefined ? undefined : typeof m.army === 'string' && ARMY_ID_RE.test(m.army) ? m.army : null;
  switch (m.t) {
    case 'hello':
      return Number.isInteger(m.version) ? { t: 'hello', version: m.version as number } : null;
    case 'create':
      if (name === null || army === null) return null;
      return m.side === 'w' || m.side === 'b' || m.side === 'random' ? { t: 'create', side: m.side, name, army } : null;
    case 'join':
      if (name === null || army === null) return null;
      return isStr(m.code) ? { t: 'join', code: m.code, name, army } : null;
    case 'resume':
      return isStr(m.code) && isStr(m.token, 128) ? { t: 'resume', code: m.code, token: m.token } : null;
    case 'move':
      return isStr(m.uci, 8) && Number.isInteger(m.ply) && (m.ply as number) >= 0
        ? { t: 'move', uci: m.uci, ply: m.ply as number }
        : null;
    case 'answerDraw':
      return typeof m.accept === 'boolean' ? { t: 'answerDraw', accept: m.accept } : null;
    case 'resign':
    case 'offerDraw':
    case 'rematch':
    case 'leave':
    case 'ping':
      return { t: m.t };
    default:
      return null;
  }
}
