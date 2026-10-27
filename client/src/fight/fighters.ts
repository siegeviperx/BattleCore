// 3D fighters for capture scenes: Meshy GLB models when loaded, procedural toy placeholders otherwise. Both sit
// behind the same Fighter shape (root/body/muzzle/flash), so the moves and director don't change.
import * as THREE from 'three';
import type { Color, PieceType } from '../core/types';
import data from '../data/pieces.json';
import { cloneFighterModel, modelTuning, type ModelTuning } from './models';

export interface Fighter {
  /** Placed and turned by the director; local +Z faces the opponent. */
  readonly root: THREE.Group;
  /** Squashed, tilted and spun by moves. Origin at the feet. */
  readonly body: THREE.Group;
  /** Weapon tip / mouth, where projectiles and flames start. */
  readonly muzzle: THREE.Object3D;
  /** Standing height (world units, before root scale). */
  readonly height: number;
  /** Fliers hover above their base. */
  readonly flier: boolean;
  /** 0..1 white hit flash. */
  setFlash(amount: number): void;
  dispose(): void;
}

const SKIN = '#f2c9a5';
const DINO_SKIN = '#7b4a2c';
const DINO_BELLY = '#b98a5c';
const STEEL = '#55565c';
const GOLD = '#e0b03c';

class Kit {
  readonly mats: THREE.MeshStandardMaterial[] = [];
  readonly geos: THREE.BufferGeometry[] = [];

  mat(color: string, roughness = 0.42, metalness = 0): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.mats.push(m);
    return m;
  }

  /** Add a mesh to `parent` at `pos`, with optional Euler rotation and scale. */
  part(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    rot: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1],
  ): THREE.Mesh {
    this.geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.scale.set(...scale);
    m.castShadow = true;
    parent.add(m);
    return m;
  }
}

class ToyFighter implements Fighter {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  height = 1;
  flier = false;

  constructor(readonly kit: Kit) {
    this.root.add(this.body);
  }

  setFlash(amount: number): void {
    for (const m of this.kit.mats) {
      m.emissive.setRGB(amount, amount, amount);
    }
  }

  dispose(): void {
    for (const g of this.kit.geos) g.dispose();
    for (const m of this.kit.mats) m.dispose();
  }
}

export function createFighter(color: Color, type: PieceType): Fighter {
  const f = new ToyFighter(new Kit());
  if (color === 'w') buildBaby(f, type);
  else buildDino(f, type);
  const model = cloneFighterModel(color, type);
  if (model) swapInModel(f, model, modelTuning(color, type));
  return f;
}

/** Replace the toy's meshes with a Meshy model, keeping its height, muzzle spot and flier setting. */
function swapInModel(f: ToyFighter, model: THREE.Object3D, tune: ModelTuning): void {
  f.root.updateWorldMatrix(true, true);
  const muzzle = f.body.worldToLocal(f.muzzle.getWorldPosition(new THREE.Vector3()));
  f.body.clear();
  f.dispose();
  f.kit.geos.length = 0;
  f.kit.mats.length = 0;

  const height = f.height * tune.scale;
  // Turn, then put the feet at the origin and the middle over it, then scale to the toy's height.
  const pivot = new THREE.Group();
  pivot.add(model);
  model.rotation.y = tune.yaw;
  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);
  pivot.scale.setScalar(height / Math.max(box.max.y - box.min.y, 1e-6));
  f.body.add(pivot);

  if (tune.muzzle) f.muzzle.position.set(...tune.muzzle).multiplyScalar(height);
  else f.muzzle.position.copy(muzzle).multiplyScalar(tune.scale);
  f.body.add(f.muzzle);
  f.height = height;

  // Flash and dispose work on the kit; the model's geometry stays shared with the cache.
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m instanceof THREE.MeshStandardMaterial) f.kit.mats.push(m);
    }
  });
}

// ---------------------------------------------------------------------------
// Baby Army
// ---------------------------------------------------------------------------

function buildBaby(f: ToyFighter, type: PieceType): void {
  const k = f.kit;
  const fac = data.factions.w;
  const skin = k.mat(SKIN, 0.55);
  const olive = k.mat(fac.primary, 0.5);
  const tan = k.mat(fac.secondary, 0.6);
  const white = k.mat('#f6f4ee', 0.7);
  const black = k.mat('#1b1410', 0.3);
  const b = f.body;

  if (type === 'r') {
    buildBlockTower(f, olive, tan);
    return;
  }

  // Legs + boots
  for (const s of [-1, 1]) {
    k.part(b, new THREE.CapsuleGeometry(0.065, 0.1, 4, 10), skin, [s * 0.08, 0.15, 0]);
    k.part(b, new THREE.BoxGeometry(0.12, 0.08, 0.16), tan, [s * 0.08, 0.04, 0.02]);
  }
  // Diaper + vest
  k.part(b, new THREE.SphereGeometry(0.17, 18, 12), white, [0, 0.25, 0], [0, 0, 0], [1.05, 0.72, 0.92]);
  const vest = type === 'k' ? olive : tan;
  k.part(b, new THREE.CylinderGeometry(0.15, 0.17, 0.2, 18), vest, [0, 0.42, 0]);
  // Arms reaching forward to hold the weapon
  for (const s of [-1, 1]) {
    k.part(b, new THREE.CapsuleGeometry(0.05, 0.13, 4, 8), skin, [s * 0.15, 0.43, 0.08], [1.25, 0, s * 0.25]);
  }
  // Head + angry face
  const head = new THREE.Group();
  head.position.y = 0.74;
  b.add(head);
  k.part(head, new THREE.SphereGeometry(0.22, 22, 16), skin, [0, 0, 0]);
  for (const s of [-1, 1]) {
    k.part(head, new THREE.SphereGeometry(0.03, 10, 8), black, [s * 0.075, -0.01, 0.195]);
    k.part(head, new THREE.BoxGeometry(0.075, 0.018, 0.02), black, [s * 0.075, 0.045, 0.2], [0, 0, s * -0.35]);
  }
  k.part(head, new THREE.BoxGeometry(0.06, 0.012, 0.02), black, [0, -0.1, 0.19]);

  // Headgear
  if (type === 'b') {
    // Leafy ghillie hood
    const leaf = k.mat('#4f7a2c', 0.8);
    k.part(head, new THREE.IcosahedronGeometry(0.255, 1), leaf, [0, 0.05, -0.03], [0, 0, 0], [1, 0.95, 1]);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      k.part(head, new THREE.IcosahedronGeometry(0.07, 0), leaf, [Math.cos(a) * 0.2, 0.12 + (i % 2) * 0.06, Math.sin(a) * 0.2 - 0.03]);
    }
  } else if (type === 'k') {
    // Officer cap with a crown badge
    k.part(head, new THREE.CylinderGeometry(0.24, 0.2, 0.12, 22), olive, [0, 0.17, 0]);
    k.part(head, new THREE.CylinderGeometry(0.2, 0.2, 0.02, 22, 1, false, -Math.PI / 2, Math.PI), black, [0, 0.11, 0.06]);
    k.part(head, new THREE.ConeGeometry(0.04, 0.06, 5), k.mat(GOLD, 0.3, 0.6), [0, 0.18, 0.22]);
  } else {
    k.part(head, new THREE.SphereGeometry(0.24, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), olive, [0, 0.02, 0]);
    k.part(head, new THREE.TorusGeometry(0.235, 0.022, 6, 24), olive, [0, 0.02, 0], [Math.PI / 2, 0, 0]);
    if (type === 'q') k.part(head, new THREE.TorusGeometry(0.1, 0.02, 6, 5), k.mat(GOLD, 0.3, 0.6), [0, 0.24, 0.02], [Math.PI / 2, 0, 0]);
    if (type === 'n') {
      for (const s of [-1, 1]) k.part(head, new THREE.TorusGeometry(0.05, 0.02, 6, 14), k.mat('#8a6a3a'), [s * 0.08, 0.12, 0.17], [-0.3, 0, 0]);
    }
  }

  // Extras
  if (type === 'n') {
    // Toy rocket jetpack
    for (const s of [-1, 1]) {
      const col = s < 0 ? '#ff7a1a' : '#2a6fdb';
      k.part(b, new THREE.CylinderGeometry(0.06, 0.06, 0.28, 12), k.mat(col), [s * 0.08, 0.45, -0.2]);
      k.part(b, new THREE.ConeGeometry(0.06, 0.1, 12), k.mat('#e8e2d0'), [s * 0.08, 0.64, -0.2]);
    }
    f.flier = true;
  }
  if (type === 'q') {
    const cape = k.mat('#5b2a8c', 0.5);
    cape.side = THREE.DoubleSide;
    k.part(b, new THREE.CylinderGeometry(0.2, 0.34, 0.55, 18, 1, true, Math.PI * 0.6, Math.PI * 0.8), cape, [0, 0.38, -0.02]);
  }
  if (type === 'k') {
    k.part(b, new THREE.TorusGeometry(0.16, 0.025, 6, 20), k.mat('#b5262a'), [0, 0.43, 0], [Math.PI / 2, 0.5, 0]);
  }

  // Weapon in hands
  const w = new THREE.Group();
  w.position.set(0, 0.4, 0.24);
  b.add(w);
  if (type === 'k') {
    // Golden rattle scepter
    const gold = k.mat(GOLD, 0.3, 0.6);
    k.part(w, new THREE.CylinderGeometry(0.02, 0.02, 0.32, 8), gold, [0.08, 0.1, 0], [0.3, 0, 0]);
    k.part(w, new THREE.SphereGeometry(0.07, 14, 10), gold, [0.08, 0.27, 0.05]);
    f.muzzle.position.set(0.08, 0.27, 0.1);
  } else {
    const len = type === 'b' ? 0.42 : 0.26;
    const body = type === 'q' ? '#e0479e' : type === 'b' ? '#ff7a1a' : '#2a6fdb';
    const trim = type === 'b' ? '#3d8a3d' : '#ffd23a';
    k.part(w, new THREE.BoxGeometry(0.1, 0.1, len), k.mat(body), [0, 0, len / 2 - 0.06]);
    k.part(w, new THREE.BoxGeometry(0.11, 0.05, 0.08), k.mat(trim), [0, 0.0, 0.0]);
    k.part(w, new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10), k.mat('#ff7a1a'), [0, 0.01, len - 0.03], [Math.PI / 2, 0, 0]);
    if (type === 'b') k.part(w, new THREE.CylinderGeometry(0.03, 0.03, 0.16, 10), k.mat('#ffd23a'), [0, 0.08, 0.1], [Math.PI / 2, 0, 0]);
    f.muzzle.position.set(0, 0.01, len + 0.02);
  }
  w.add(f.muzzle);
  f.height = 1;
}

function buildBlockTower(f: ToyFighter, olive: THREE.Material, tan: THREE.Material): void {
  const k = f.kit;
  const b = f.body;
  const colors = ['#d94a3a', '#2a6fdb', '#3d8a3d', '#ffd23a'];
  let y = 0;
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 4; i++) {
      const x = i % 2 ? 0.13 : -0.13;
      const z = i < 2 ? 0.13 : -0.13;
      const mat = (row + i) % 3 === 0 ? k.mat(colors[(row + i) % 4], 0.55) : (row + i) % 2 ? olive : tan;
      k.part(b, new THREE.BoxGeometry(0.25, 0.2, 0.25), mat, [x, y + 0.1, z]);
    }
    y += 0.2;
  }
  // Battlements
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
    k.part(b, new THREE.BoxGeometry(0.12, 0.12, 0.12), olive, [x, y + 0.06, z]);
  }
  // Baby peeking over the top with a toy cannon
  k.part(b, new THREE.SphereGeometry(0.13, 18, 12), k.mat(SKIN, 0.55), [0, y + 0.08, -0.02]);
  k.part(b, new THREE.SphereGeometry(0.14, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), olive, [0, y + 0.1, -0.02]);
  k.part(b, new THREE.CylinderGeometry(0.06, 0.07, 0.3, 12), k.mat('#ff7a1a'), [0, y + 0.02, 0.28], [Math.PI / 2 - 0.25, 0, 0]);
  f.muzzle.position.set(0, y + 0.06, 0.44);
  b.add(f.muzzle);
  f.height = y + 0.2;
}

// ---------------------------------------------------------------------------
// Armored Dinos
// ---------------------------------------------------------------------------

function buildDino(f: ToyFighter, type: PieceType): void {
  const k = f.kit;
  const fac = data.factions.b;
  const skin = k.mat(DINO_SKIN, 0.6);
  const belly = k.mat(DINO_BELLY, 0.65);
  const steel = k.mat(STEEL, 0.35, 0.7);
  const red = k.mat(fac.primary, 0.45);
  const eye = k.mat('#ffbf2a', 0.3);
  const black = k.mat('#140c08', 0.3);
  const b = f.body;

  if (type === 'r') {
    buildFortress(f, steel, red);
    return;
  }
  if (type === 'n') {
    buildPtero(f, skin, steel, red, eye, black);
    return;
  }
  if (type === 'b') {
    buildTrike(f, skin, belly, steel, red, eye, black);
    return;
  }

  // Bipeds: raptor (p), spinosaurus (q), T-Rex (k)
  const size = type === 'k' ? 1.3 : type === 'q' ? 1.18 : 1;
  const g = new THREE.Group();
  g.scale.setScalar(size);
  b.add(g);

  for (const s of [-1, 1]) {
    k.part(g, new THREE.CapsuleGeometry(0.075, 0.16, 4, 10), skin, [s * 0.12, 0.2, -0.03], [0.25, 0, 0]);
    k.part(g, new THREE.BoxGeometry(0.12, 0.06, 0.2), skin, [s * 0.12, 0.03, 0.04]);
  }
  k.part(g, new THREE.SphereGeometry(0.24, 20, 14), skin, [0, 0.46, -0.04], [0, 0, 0], [0.95, 1.05, 1.25]);
  k.part(g, new THREE.SphereGeometry(0.2, 16, 12), belly, [0, 0.44, 0.08], [0, 0, 0], [0.8, 0.95, 0.8]);
  k.part(g, new THREE.ConeGeometry(0.15, 0.6, 14), skin, [0, 0.38, -0.5], [-Math.PI / 2 - 0.25, 0, 0]);
  // Armor: chest plate with a red skull panel, shoulder plates, belt
  k.part(g, new THREE.BoxGeometry(0.34, 0.24, 0.08), steel, [0, 0.5, 0.2], [-0.2, 0, 0]);
  k.part(g, new THREE.BoxGeometry(0.14, 0.12, 0.02), red, [0, 0.5, 0.25], [-0.2, 0, 0]);
  for (const s of [-1, 1]) k.part(g, new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel, [s * 0.2, 0.6, 0.05], [0, 0, s * -0.5]);
  k.part(g, new THREE.TorusGeometry(0.21, 0.03, 6, 20), k.mat('#5c5a36', 0.7), [0, 0.32, -0.02], [Math.PI / 2, 0, 0]);
  // Little arms
  for (const s of [-1, 1]) k.part(g, new THREE.CapsuleGeometry(0.035, 0.1, 4, 8), skin, [s * 0.15, 0.48, 0.22], [1.1, 0, 0]);
  // Head
  const head = new THREE.Group();
  head.position.set(0, 0.78, 0.18);
  g.add(head);
  k.part(head, new THREE.SphereGeometry(0.16, 16, 12), skin, [0, 0, 0], [0, 0, 0], [0.9, 0.85, 1.1]);
  const snoutLen = type === 'q' ? 0.3 : 0.2;
  k.part(head, new THREE.BoxGeometry(0.18, 0.1, snoutLen), skin, [0, -0.02, 0.1 + snoutLen / 2]);
  k.part(head, new THREE.BoxGeometry(0.16, 0.05, snoutLen * 0.9), belly, [0, -0.09, 0.08 + snoutLen / 2], [0.25, 0, 0]);
  for (const s of [-1, 1]) {
    k.part(head, new THREE.SphereGeometry(0.035, 10, 8), eye, [s * 0.11, 0.05, 0.07]);
    k.part(head, new THREE.SphereGeometry(0.016, 8, 6), black, [s * 0.135, 0.05, 0.085]);
  }
  for (let i = 0; i < 5; i++) {
    k.part(head, new THREE.ConeGeometry(0.014, 0.04, 5), k.mat('#f3ead9', 0.4), [-0.07 + i * 0.035, -0.06, 0.12 + snoutLen * 0.75], [Math.PI, 0, 0]);
  }
  if (type === 'k') {
    // Helmet + jagged iron crown
    k.part(head, new THREE.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), steel, [0, 0.03, -0.01]);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      k.part(head, new THREE.ConeGeometry(0.03, 0.12, 5), steel, [Math.cos(a) * 0.12, 0.17, Math.sin(a) * 0.12 - 0.01]);
    }
  } else {
    // Crest
    for (let i = 0; i < 4; i++) k.part(head, new THREE.ConeGeometry(0.03, 0.1, 5), red, [0, 0.14 - i * 0.02, -0.02 - i * 0.07], [-0.5, 0, 0]);
  }
  head.add(f.muzzle);
  f.muzzle.position.set(0, -0.03, 0.15 + snoutLen);

  if (type === 'q') {
    // Crimson sail
    const sail = k.mat('#c2312a', 0.5);
    sail.side = THREE.DoubleSide;
    k.part(g, new THREE.CircleGeometry(0.34, 20, 0, Math.PI), sail, [0, 0.62, -0.12], [0, Math.PI / 2, 0], [1.2, 1, 1]);
    // Shoulder missile pod
    k.part(g, new THREE.BoxGeometry(0.14, 0.12, 0.2), steel, [0.24, 0.72, -0.05]);
  }
  if (type === 'k') {
    for (const s of [-1, 1]) k.part(g, new THREE.CylinderGeometry(0.04, 0.05, 0.36, 10), steel, [s * 0.14, 0.72, -0.18], [-0.7, 0, 0]);
  }
  if (type === 'p') k.part(g, new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8), steel, [0.16, 0.66, -0.12], [-0.6, 0, 0]);
  f.height = 0.95 * size;
}

function buildPtero(
  f: ToyFighter,
  skin: THREE.Material,
  steel: THREE.Material,
  red: THREE.Material,
  eye: THREE.Material,
  black: THREE.Material,
): void {
  const k = f.kit;
  const g = new THREE.Group();
  g.position.y = 0.45;
  f.body.add(g);
  k.part(g, new THREE.CapsuleGeometry(0.1, 0.24, 4, 10), skin, [0, 0, 0], [Math.PI / 2, 0, 0]);
  k.part(g, new THREE.BoxGeometry(0.2, 0.12, 0.2), steel, [0, 0.04, 0.02]);
  const wing = k.mat('#8c3a2a', 0.6);
  wing.side = THREE.DoubleSide;
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(s * 0.62, 0.12);
    shape.lineTo(s * 0.5, -0.05);
    shape.lineTo(s * 0.2, -0.2);
    shape.closePath();
    k.part(g, new THREE.ShapeGeometry(shape), wing, [s * 0.06, 0.02, 0], [Math.PI / 2, 0, 0]);
    k.part(g, new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8), steel, [s * 0.22, -0.05, 0.05], [Math.PI / 2, 0, 0]);
  }
  const head = new THREE.Group();
  head.position.set(0, 0.08, 0.22);
  g.add(head);
  k.part(head, new THREE.SphereGeometry(0.09, 12, 10), skin, [0, 0, 0]);
  k.part(head, new THREE.ConeGeometry(0.05, 0.3, 8), skin, [0, -0.02, 0.18], [Math.PI / 2, 0, 0]);
  k.part(head, new THREE.ConeGeometry(0.04, 0.22, 6), red, [0, 0.05, -0.12], [-Math.PI / 2 - 0.4, 0, 0]);
  for (const s of [-1, 1]) {
    k.part(head, new THREE.SphereGeometry(0.025, 8, 6), eye, [s * 0.07, 0.03, 0.04]);
    k.part(head, new THREE.SphereGeometry(0.012, 6, 4), black, [s * 0.085, 0.03, 0.05]);
  }
  g.add(f.muzzle);
  f.muzzle.position.set(0, -0.05, 0.2);
  f.flier = true;
  f.height = 0.7;
}

function buildTrike(
  f: ToyFighter,
  skin: THREE.Material,
  belly: THREE.Material,
  steel: THREE.Material,
  red: THREE.Material,
  eye: THREE.Material,
  black: THREE.Material,
): void {
  const k = f.kit;
  const b = f.body;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.part(b, new THREE.CylinderGeometry(0.06, 0.07, 0.2, 10), skin, [sx * 0.16, 0.1, sz * 0.2]);
  k.part(b, new THREE.SphereGeometry(0.26, 18, 12), skin, [0, 0.32, -0.02], [0, 0, 0], [0.95, 0.75, 1.35]);
  k.part(b, new THREE.BoxGeometry(0.4, 0.14, 0.5), steel, [0, 0.42, -0.04]);
  for (const s of [-1, 1]) k.part(b, new THREE.BoxGeometry(0.06, 0.12, 0.5), k.mat('#2c2c30', 0.8), [s * 0.25, 0.28, -0.04]);
  // Turret
  k.part(b, new THREE.CylinderGeometry(0.12, 0.14, 0.1, 14), steel, [0, 0.54, -0.06]);
  k.part(b, new THREE.CylinderGeometry(0.03, 0.03, 0.3, 10), steel, [0, 0.56, 0.12], [Math.PI / 2, 0, 0]);
  k.part(b, new THREE.ConeGeometry(0.12, 0.3, 12), skin, [0, 0.28, -0.42], [-Math.PI / 2, 0, 0]);
  // Head + frill + horns
  const head = new THREE.Group();
  head.position.set(0, 0.3, 0.34);
  b.add(head);
  k.part(head, new THREE.SphereGeometry(0.13, 14, 10), skin, [0, 0, 0.04], [0, 0, 0], [1, 0.9, 1.2]);
  k.part(head, new THREE.ConeGeometry(0.08, 0.12, 4), belly, [0, -0.04, 0.18], [Math.PI / 2, Math.PI / 4, 0]);
  k.part(head, new THREE.CircleGeometry(0.24, 18), red, [0, 0.1, -0.06], [-0.35, 0, 0]);
  const horn = k.mat('#e8dcc0', 0.4);
  for (const s of [-1, 1]) {
    k.part(head, new THREE.ConeGeometry(0.03, 0.26, 8), horn, [s * 0.07, 0.1, 0.16], [1.1, 0, 0]);
    k.part(head, new THREE.SphereGeometry(0.025, 8, 6), eye, [s * 0.1, 0.04, 0.1]);
    k.part(head, new THREE.SphereGeometry(0.012, 6, 4), black, [s * 0.118, 0.04, 0.11]);
  }
  k.part(head, new THREE.ConeGeometry(0.025, 0.1, 8), horn, [0, 0.0, 0.24], [1.3, 0, 0]);
  b.add(f.muzzle);
  f.muzzle.position.set(0, 0.56, 0.3);
  f.height = 0.62;
}

function buildFortress(f: ToyFighter, steel: THREE.Material, red: THREE.MeshStandardMaterial): void {
  const k = f.kit;
  const b = f.body;
  const stone = k.mat('#3a3436', 0.85);
  k.part(b, new THREE.BoxGeometry(0.5, 0.75, 0.5), stone, [0, 0.375, 0]);
  for (let i = 0; i < 4; i++) k.part(b, new THREE.BoxGeometry(0.52, 0.04, 0.52), steel, [0, 0.12 + i * 0.18, 0]);
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
    k.part(b, new THREE.BoxGeometry(0.12, 0.12, 0.12), stone, [x, 0.81, z]);
    k.part(b, new THREE.ConeGeometry(0.03, 0.1, 5), steel, [x, 0.92, z]);
  }
  const banner = k.mat(red.color.getStyle(), 0.6);
  banner.side = THREE.DoubleSide;
  k.part(b, new THREE.PlaneGeometry(0.2, 0.36), banner, [0, 0.5, 0.256]);
  k.part(b, new THREE.CylinderGeometry(0.06, 0.07, 0.34, 12), steel, [0, 0.82, 0.22], [Math.PI / 2 - 0.3, 0, 0]);
  k.part(b, new THREE.SphereGeometry(0.1, 12, 10), k.mat(DINO_SKIN, 0.6), [-0.1, 0.84, -0.08]);
  b.add(f.muzzle);
  f.muzzle.position.set(0, 0.88, 0.4);
  f.height = 0.95;
}
