// Strict runtime validation of incoming client messages. Anything that doesn't match the
// contract in shared/protocol.ts exactly is rejected (returns null → `bad-request`).
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
  switch (m.t) {
    case 'hello':
      return Number.isInteger(m.version) ? { t: 'hello', version: m.version as number } : null;
    case 'create':
      return m.side === 'w' || m.side === 'b' || m.side === 'random' ? { t: 'create', side: m.side } : null;
    case 'join':
      return isStr(m.code) ? { t: 'join', code: m.code } : null;
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
