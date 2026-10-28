// Fighter models from the active packs (src/packs/<id>/models). Loaded in the background; until a model
// arrives (or if it is missing) createFighter falls back to the procedural toy, so a fight never waits on a download.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Color, PieceType } from '../core/types';
import { PIECE_TYPES, lookCount, pieceLook, type LookTuning } from '../packs';
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

const lookId = (color: Color, type: PieceType, look: number): string => `${color}-${type}-${look}`;
const cache = new Map<string, { scene: THREE.Object3D; animations: THREE.AnimationClip[] }>();
let loading: Promise<void> | null = null;

/** Start downloading every fighter model; resolves once each one has loaded or failed. */
export function preloadFighterModels(): Promise<void> {
  if (loading) return loading;
  const loader = gltfLoader();
  const jobs: Promise<void>[] = [];
  for (const c of ['w', 'b'] as Color[]) {
    for (const t of PIECE_TYPES) {
      for (let look = 0; look < lookCount(c, t); look++) {
        const url = pieceLook(c, t, look).model;
        if (!url) continue; // no model in the pack: the toy stands in
        const key = lookId(c, t, look);
        jobs.push(
          loader
            .loadAsync(url)
            .then((gltf) => void cache.set(key, gltf))
            .catch(() => {}), // failed to load: the toy stands in
        );
      }
    }
  }
  loading = Promise.all(jobs).then(() => {});
  return loading;
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
  const src = cache.get(lookId(color, type, look % lookCount(color, type)));
  if (!src) return null;
  const copy = cloneSkinned(src.scene);
  copy.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      o.castShadow = true;
    }
  });
  const clips: FighterModel['clips'] = {};
  src.animations.forEach((clip, i) => {
    if (CLIP_ORDER[i]) clips[CLIP_ORDER[i]] = clip;
  });
  return { object: copy, clips };
}
