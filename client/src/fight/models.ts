// Fighter models from the active packs (src/packs/<id>/models). Loaded in the background; until a model
// arrives (or if it is missing) createFighter falls back to the procedural toy, so a fight never waits on a download.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Color, PieceType } from '../core/types';
import { PACKS, PIECE_TYPES, SHADOW_SHADE, army, lookCount, pieceLook, type LookTuning } from '../packs';
import { gltfLoader } from '../render/gltf';

/** Pack tuning with the defaults filled in. */
export interface ModelTuning extends LookTuning {
  yaw: number;
  scale: number;
}

export type ClipName = 'idle' | 'attack' | 'hit';
/** Rigged models carry their Meshy clips in this order (combat idle, attack, hit reaction). */
const CLIP_ORDER: ClipName[] = ['idle', 'attack', 'hit'];

export interface FighterModel {
  object: THREE.Object3D;
  clips: Partial<Record<ClipName, THREE.AnimationClip>>;
}

/** Models are cached per pack, so a mirror match's two armies share them. */
const lookId = (pack: string, type: PieceType, look: number): string => `${pack}-${type}-${look}`;
const cache = new Map<string, { scene: THREE.Object3D; animations: THREE.AnimationClip[] }>();
const packLoads = new Map<string, Promise<void>>();

/** Download one pack's fighter models (once); resolves when each has loaded or failed. */
function preloadPack(id: string): Promise<void> {
  let p = packLoads.get(id);
  if (p) return p;
  const loader = gltfLoader();
  const jobs: Promise<void>[] = [];
  for (const t of PIECE_TYPES) {
    PACKS[id].pieces[t].looks.forEach((look, i) => {
      if (!look.model) return; // no model in the pack: the toy stands in
      jobs.push(
        loader
          .loadAsync(look.model)
          .then((gltf) => void cache.set(lookId(id, t, i), gltf))
          .catch(() => {}), // failed to load: the toy stands in
      );
    });
  }
  p = Promise.all(jobs).then(() => {});
  packLoads.set(id, p);
  return p;
}

/** Start downloading the fighter models of both armies in play; resolves once each has loaded or failed. */
export function preloadFighterModels(): Promise<void> {
  return Promise.all([preloadPack(army('w').id), preloadPack(army('b').id)]).then(() => {});
}

/** Every fighter model that has loaded so far (for warming up the GPU before the first fight). */
export function loadedFighterScenes(): THREE.Object3D[] {
  return [...cache.values()].map((g) => g.scene);
}

export function modelTuning(color: Color, type: PieceType, look = 0): ModelTuning {
  return { yaw: 0, scale: 1, ...pieceLook(color, type, look).tuning };
}

/** A fresh copy with its own materials (so hit flashes don't leak) and its clips, or null if not loaded. */
export function cloneFighterModel(color: Color, type: PieceType, look = 0): FighterModel | null {
  const src = cache.get(lookId(army(color).id, type, look % lookCount(color, type)));
  if (!src) return null;
  const copy = cloneSkinned(src.scene);
  const shadow = army(color).shadow; // mirror match: the second army fights darker too
  copy.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      if (shadow) for (const m of [o.material].flat()) (m as THREE.MeshStandardMaterial).color?.multiplyScalar(SHADOW_SHADE);
      o.castShadow = true;
    }
  });
  const clips: FighterModel['clips'] = {};
  src.animations.forEach((clip, i) => {
    if (CLIP_ORDER[i]) clips[CLIP_ORDER[i]] = clip;
  });
  return { object: copy, clips };
}
