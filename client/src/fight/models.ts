// Meshy fighter models (public/assets/fighters/<color>-<type>.glb). Loaded in the background; until a model
// arrives (or if it is missing) createFighter falls back to the procedural toy, so a fight never waits on a download.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Color, PieceType } from '../core/types';
import tuning from '../data/fighter-models.json';

export interface ModelTuning {
  /** Extra turn (radians) so the model faces local +Z. */
  yaw: number;
  /** Multiplier on the placeholder's standing height. */
  scale: number;
  /** Weapon tip in body space, as fractions of standing height; defaults to the placeholder's muzzle. */
  muzzle?: [number, number, number];
}

const TYPES: PieceType[] = ['p', 'n', 'b', 'r', 'q', 'k'];
const cache = new Map<string, THREE.Object3D>();
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
        .then((gltf) => cache.set(key, gltf.scene))
        .catch(() => {}); // no model yet: the toy stands in
    }
  }
}

export function modelTuning(color: Color, type: PieceType): ModelTuning {
  return { yaw: 0, scale: 1, ...(tuning as Record<string, Partial<ModelTuning>>)[color + type] };
}

/** A fresh copy with its own materials (so hit flashes don't leak), or null if not loaded. */
export function cloneFighterModel(color: Color, type: PieceType): THREE.Object3D | null {
  const src = cache.get(color + type);
  if (!src) return null;
  const copy = src.clone(true);
  copy.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      o.castShadow = true;
    }
  });
  return copy;
}
