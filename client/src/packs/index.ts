// Piece packs: one army per folder (src/packs/<id>/pack.json plus its sticker art and 3D models).
// Every folder here is picked up automatically, and its files get content-hashed URLs at build time, so a
// changed model or sticker never hides behind a stale browser cache. See docs/PLATFORM.md §3 and docs/PACKS.md.
import type { Color, PieceType } from '../core/types';
import { loadPack, type Matchup, type Pack, type PackFile, type PackLook, type PackPiece } from './validate';

export * from './validate';

const manifests = import.meta.glob<PackFile>('./*/pack.json', { eager: true, import: 'default' });
const assets = import.meta.glob<string>('./*/{pieces,models}/*', { eager: true, query: '?url', import: 'default' });

export const PACKS: Record<string, Pack> = Object.fromEntries(
  Object.entries(manifests).map(([path, file]) => {
    const folder = path.split('/')[1];
    return [folder, loadPack(folder, file, assets)];
  }),
);

/** Which pack plays each side. The original matchup until the menu gets an army picker. */
export const DEFAULT_MATCHUP: Matchup = { w: 'babies', b: 'dinos' };

/** Dev builds only: `?white=<pack>&black=<pack>` swaps the armies (used by `npm run pack:preview`). */
function startingMatchup(): Matchup {
  const m = { ...DEFAULT_MATCHUP };
  if (import.meta.env.DEV && typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search);
    for (const [c, key] of [['w', 'white'], ['b', 'black']] as const) {
      const id = q.get(key);
      if (id && PACKS[id]) m[c] = id;
      else if (id) console.warn(`No pack "${id}"; packs: ${Object.keys(PACKS).join(', ')}`);
    }
  }
  return m;
}

const matchup = startingMatchup();

export function army(color: Color): Pack {
  return PACKS[matchup[color]];
}

export function pieceInfo(color: Color, type: PieceType): PackPiece {
  return army(color).pieces[type];
}

export function lookCount(color: Color, type: PieceType): number {
  return pieceInfo(color, type).looks.length;
}

export function pieceLook(color: Color, type: PieceType, look = 0): PackLook {
  const looks = pieceInfo(color, type).looks;
  return looks[look % looks.length];
}
