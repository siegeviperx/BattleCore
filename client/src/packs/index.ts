// Piece packs: one army per folder (src/packs/<id>/pack.json plus its sticker art and 3D models).
// Every folder here is picked up automatically, and its files get content-hashed URLs at build time, so a
// changed model or sticker never hides behind a stale browser cache. See docs/PLATFORM.md §3.
import type { Color, PieceType } from '../core/types';

/** Fight-model tuning (see fight/models.ts). Anything left out uses the defaults. */
export interface LookTuning {
  /** Extra turn (radians) so the model faces local +Z. */
  yaw?: number;
  /** Multiplier on the placeholder's standing height. */
  scale?: number;
  /** Weapon tip in body space, as fractions of standing height. */
  muzzle?: [number, number, number];
  /** Override the placeholder's hover (e.g. a model that brings its own flight stand). */
  flier?: boolean;
  /** Rigged models: bone that holds the weapon (and muzzle), e.g. "RightHand". */
  hand?: string;
}

/** One art/model variant of a piece (e.g. the four different baby riflemen). */
export interface PackLook {
  /** Resolved URL of the sticker art, or null for the drawn placeholder. */
  art: string | null;
  /** Resolved URL of the 3D fight model, or null for the procedural toy. */
  model: string | null;
  tuning: LookTuning;
}

/** Attack and knockout recipes, read by fight/director.ts (kinds come from fight/moves.ts). */
export interface MoveRecipe {
  kind: string;
  [key: string]: unknown;
}

export interface PackPiece {
  name: string;
  icon: string;
  attack: MoveRecipe;
  knockout: MoveRecipe;
  /** At least one. Pawns cycle through looks by starting file. */
  looks: PackLook[];
}

export interface Pack {
  id: string;
  version: number;
  name: string;
  short: string;
  colors: { primary: string; secondary: string; base: string; emblem: string };
  credits: { role: string; name: string; url?: string; note?: string }[];
  pieces: Record<PieceType, PackPiece>;
}

/** pack.json as written: paths are relative to the pack folder. */
interface PackFile extends Omit<Pack, 'pieces'> {
  pieces: Record<PieceType, Omit<PackPiece, 'looks'> & { looks: { art?: string; model?: string; tuning?: LookTuning }[] }>;
}

export const PIECE_TYPES: PieceType[] = ['k', 'q', 'r', 'b', 'n', 'p'];

/** Chess symbols for the corner badges, so chess players always recognise a piece's role. */
export const GLYPHS: Record<PieceType, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };

const manifests = import.meta.glob<PackFile>('./*/pack.json', { eager: true, import: 'default' });
const assets = import.meta.glob<string>('./*/{pieces,models}/*', { eager: true, query: '?url', import: 'default' });

/** Checks a pack file and resolves its asset paths. Throws with the pack folder and the problem. */
export function loadPack(folder: string, file: PackFile, urls: Record<string, string>): Pack {
  const fail = (msg: string): never => {
    throw new Error(`Pack "${folder}": ${msg}`);
  };
  if (file.id !== folder) fail(`id "${file.id}" must match its folder name`);
  if (!file.name || !file.short) fail('needs a name and a short name');
  for (const k of ['primary', 'secondary', 'base'] as const) {
    if (!/^#[0-9a-f]{6}$/i.test(file.colors?.[k] ?? '')) fail(`colors.${k} must be a #rrggbb color`);
  }
  const url = (path: string | undefined, what: string): string | null => {
    if (!path) return null;
    return urls[`./${folder}/${path}`] ?? fail(`${what} "${path}" not found in the pack folder`);
  };
  const pieces = {} as Record<PieceType, PackPiece>;
  for (const t of PIECE_TYPES) {
    const p = file.pieces?.[t] ?? fail(`missing piece "${t}"`);
    if (!p.name) fail(`piece "${t}" needs a name`);
    if (!p.attack?.kind || !p.knockout?.kind) fail(`piece "${t}" needs an attack and a knockout`);
    if (!p.looks?.length) fail(`piece "${t}" needs at least one look`);
    pieces[t] = {
      ...p,
      looks: p.looks.map((l, i) => ({
        art: url(l.art, `piece "${t}" look ${i + 1} art`),
        model: url(l.model, `piece "${t}" look ${i + 1} model`),
        tuning: l.tuning ?? {},
      })),
    };
  }
  return { ...file, pieces };
}

export const PACKS: Record<string, Pack> = Object.fromEntries(
  Object.entries(manifests).map(([path, file]) => {
    const folder = path.split('/')[1];
    return [folder, loadPack(folder, file, assets)];
  }),
);

/** Which pack plays each side. Fixed to the original matchup until the menu gets an army picker (P2). */
const MATCHUP: Record<Color, string> = { w: 'babies', b: 'dinos' };

export function army(color: Color): Pack {
  return PACKS[MATCHUP[color]];
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
