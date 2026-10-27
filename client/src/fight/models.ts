// Meshy fighter models (public/assets/fighters/<color>-<type>.glb). Loaded in the background; until a model
// arrives (or if it is missing) createFighter falls back to the procedural toy, so a fight never waits on a download.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { lookCount, lookKey } from '../core/looks';
import type { Color, PieceType } from '../core/types';
import tuning from '../data/fighter-models.json';

export interface ModelTuning {
  /** Extra turn (radians) so the model faces local +Z. */
  yaw: number;
  /** Multiplier on the placeholder's standing height. */
  scale: number;
  /** Weapon tip in body space, as fractions of standing height; defaults to the placeholder's muzzle. */
  muzzle?: [number, number, number];
  /** Override the placeholder's hover (e.g. a model that brings its own flight stand). */
  flier?: boolean;
  /** Rigged models: bone that holds the placeholder's weapon (and muzzle), e.g. "RightHand". */
  hand?: string;
}

export type ClipName = 'idle' | 'attack' | 'hit';
/** Rigged models carry their Meshy clips in this order (combat idle, attack, hit reaction). */
const CLIP_ORDER: ClipName[] = ['idle', 'attack', 'hit'];

export interface FighterModel {
  object: THREE.Object3D;
  clips: Partial<Record<ClipName, THREE.AnimationClip>>;
}

const TYPES: PieceType[] = ['p', 'n', 'b', 'r', 'q', 'k'];
const cache = new Map<string, { scene: THREE.Object3D; animations: THREE.AnimationClip[] }>();
let loading: Promise<void> | null = null;

/** Start downloading every fighter model; resolves once each one has loaded or failed. */
export function preloadFighterModels(): Promise<void> {
  if (loading) return loading;
  const loader = new GLTFLoader();
  const jobs: Promise<void>[] = [];
  for (const c of ['w', 'b'] as Color[]) {
    for (const t of TYPES) {
      for (let look = 0; look < lookCount(c, t); look++) {
        const key = lookKey(c, t, look);
        jobs.push(
          loader
            .loadAsync(`${import.meta.env.BASE_URL}assets/fighters/${key}.glb`)
            .then((gltf) => void cache.set(key, gltf))
            .catch(() => {}), // no model yet: the toy stands in
        );
      }
    }
  }
  loading = Promise.all(jobs).then(() => {});
  return loading;
}

/** Tuning is keyed like "wp" / "wp2" (the look key without its dash). */
export function modelTuning(color: Color, type: PieceType, look = 0): ModelTuning {
  const key = lookKey(color, type, look).replace('-', '');
  return { yaw: 0, scale: 1, ...(tuning as Record<string, Partial<ModelTuning>>)[key] };
}

/** A fresh copy with its own materials (so hit flashes don't leak) and its clips, or null if not loaded. */
export function cloneFighterModel(color: Color, type: PieceType, look = 0): FighterModel | null {
  const src = cache.get(lookKey(color, type, look));
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
