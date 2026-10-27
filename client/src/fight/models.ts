// Meshy fighter models (public/assets/fighters/<color>-<type>.glb). Loaded in the background; until a model
// arrives (or if it is missing) createFighter falls back to the procedural toy, so a fight never waits on a download.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
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
let started = false;

export function preloadFighterModels(): void {
  if (started) return;
  started = true;
  const loader = new GLTFLoader();
  for (const c of ['w', 'b'] as Color[]) {
    for (const t of TYPES) {
      const key = c + t;
      loader
        .loadAsync(`${import.meta.env.BASE_URL}assets/fighters/${c}-${t}.glb`)
        .then((gltf) => cache.set(key, gltf))
        .catch(() => {}); // no model yet: the toy stands in
    }
  }
}

export function modelTuning(color: Color, type: PieceType): ModelTuning {
  return { yaw: 0, scale: 1, ...(tuning as Record<string, Partial<ModelTuning>>)[color + type] };
}

/** A fresh copy with its own materials (so hit flashes don't leak) and its clips, or null if not loaded. */
export function cloneFighterModel(color: Color, type: PieceType): FighterModel | null {
  const src = cache.get(color + type);
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
