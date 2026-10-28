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

/** Which pack plays each side when nobody has chosen. */
export const DEFAULT_MATCHUP: Matchup = { w: 'babies', b: 'dinos' };

/** Packs in picker order: the original two first, then by name. */
export const PACK_LIST: Pack[] = Object.values(PACKS).sort((a, b) => {
  const rank = (p: Pack) => ['babies', 'dinos'].indexOf(p.id) + 1 || 3;
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
});

/** A matchup with unknown or missing pack ids replaced by the defaults (e.g. from an old save or a newer friend). */
export function validMatchup(m: Partial<Record<Color, string | null>> | null | undefined): Matchup {
  return {
    w: m?.w && PACKS[m.w] ? m.w : DEFAULT_MATCHUP.w,
    b: m?.b && PACKS[m.b] ? m.b : DEFAULT_MATCHUP.b,
  };
}

/** Dev builds only: `?white=<pack>&black=<pack>` picks the armies (used by `npm run pack:preview`). */
export function urlMatchup(): Matchup | null {
  if (!import.meta.env.DEV || typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  if (!q.has('white') && !q.has('black')) return null;
  for (const id of [q.get('white'), q.get('black')]) {
    if (id && !PACKS[id]) console.warn(`No pack "${id}"; packs: ${Object.keys(PACKS).join(', ')}`);
  }
  return validMatchup({ w: q.get('white'), b: q.get('black') });
}

/** The army one side fields: its pack, or for the second army of a mirror match, a darker "Shadow" copy. */
export interface Army extends Pack {
  /** Mirror match, black side: stickers, models and bases are drawn darker so the sides stay apart. */
  shadow: boolean;
  /** Cache key: differs between a pack and its shadow. */
  key: string;
}

/** How much darker a shadow army is drawn (multiplier on its colors and models). */
export const SHADOW_SHADE = 0.55;
/** Shadow armies stand on deep purple bases, so the sides read apart even from across the board. */
export const SHADOW_BASE = '#3a1d5c';

let matchup: Matchup = urlMatchup() ?? { ...DEFAULT_MATCHUP };
let armies = buildArmies(matchup);
const listeners: (() => void)[] = [];

function buildArmies(m: Matchup): Record<Color, Army> {
  const w = PACKS[m.w];
  const b = PACKS[m.b];
  const shadow = m.w === m.b;
  return {
    w: { ...w, shadow: false, key: w.id },
    b: shadow
      ? {
          ...b,
          name: `Shadow ${b.name}`,
          short: `Shadow ${b.short}`,
          colors: { ...b.colors, primary: shade(b.colors.primary), secondary: shade(b.colors.secondary), base: SHADOW_BASE },
          shadow: true,
          key: `${b.id}~shadow`,
        }
      : { ...b, shadow: false, key: b.id },
  };
}

function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v * SHADOW_SHADE).toString(16).padStart(2, '0');
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** The armies a matchup would field (shadow naming included), without switching to it. For the menu. */
export function armiesFor(m: Partial<Record<Color, string | null>>): Record<Color, Army> {
  return buildArmies(validMatchup(m));
}

export function getMatchup(): Matchup {
  return { ...matchup };
}

/** Switch armies (before a new game). Unknown ids fall back to the defaults. */
export function setMatchup(m: Partial<Record<Color, string | null>>): void {
  const next = validMatchup(m);
  if (next.w === matchup.w && next.b === matchup.b) return;
  matchup = next;
  armies = buildArmies(next);
  for (const cb of listeners) cb();
}

export function onMatchupChange(cb: () => void): void {
  listeners.push(cb);
}

export function army(color: Color): Army {
  return armies[color];
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
