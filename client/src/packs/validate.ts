// Pack file types and checks, with no build-tool or browser dependencies, so both the game (packs/index.ts)
// and the pack tool (tools/pack, plain Node) use exactly the same rules. Imports carry .ts extensions for Node.
import type { Color, PieceType } from '../core/types.ts';
import { ATTACK_KINDS, KNOCKOUT_KINDS } from '../fight/move-kinds.ts';

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
export interface PackFile extends Omit<Pack, 'pieces'> {
  pieces: Record<PieceType, Omit<PackPiece, 'looks'> & { looks: { art?: string; model?: string; tuning?: LookTuning }[] }>;
}

export const PIECE_TYPES: PieceType[] = ['k', 'q', 'r', 'b', 'n', 'p'];

/** Chess symbols for the corner badges, so chess players always recognise a piece's role. */
export const GLYPHS: Record<PieceType, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };

/** Look slots as file names: "k", "q", ... for the first look, "p2", "p3", ... for extra looks. */
export const SLOT_RE = /^([kqrbnp])([2-9])?$/;

/** The piece type and look index a slot names ("p3" -> pawn, look 2), or null. */
export function parseSlot(slot: string): { type: PieceType; look: number } | null {
  const m = SLOT_RE.exec(slot);
  return m ? { type: m[1] as PieceType, look: m[2] ? Number(m[2]) - 1 : 0 } : null;
}

/** Which army plays which side. */
export type Matchup = Record<Color, string>;

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
    if (!(ATTACK_KINDS as readonly string[]).includes(p.attack?.kind)) fail(`piece "${t}" attack "${p.attack?.kind}" is not one of: ${ATTACK_KINDS.join(', ')}`);
    if (!(KNOCKOUT_KINDS as readonly string[]).includes(p.knockout?.kind)) fail(`piece "${t}" knockout "${p.knockout?.kind}" is not one of: ${KNOCKOUT_KINDS.join(', ')}`);
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
