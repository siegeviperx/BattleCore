// Intro cinematic (docs/DESIGN.md §4): the Giant Baby shakes toy dinos onto the board, they armor up, the Baby
// Dino sheds its shirt and the babies spill out, both armies square off, then everything flattens into the paper
// cutouts. Characters are static models moved by code; transformations are swaps hidden behind puffs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BoardPiece, PieceType } from '../core/types';
import { createFighter, type Fighter } from '../fight/fighters';
import { blast, burst } from '../fight/fx';
import type { CameraRig, Shot } from '../render/camera';
import { BOARD_Y, squareToXZ } from '../render/coords';
import type { PieceLayer } from '../render/pieces';
import { ease, type Tweener } from '../render/tween';

type V3 = THREE.Vector3;
const v = (x: number, y: number, z: number): V3 => new THREE.Vector3(x, y, z);

/** Board figures are fight models shrunk to stand on one square. */
const FIG_SCALE = 0.6;
const GIANT_H = 9;
const DINO_H = 6;
/** Toy-box plastic colors for the dinos before they armor up, by piece type. */
const TOY_COLORS: Record<PieceType, string> = { p: '#36b24f', n: '#e8453c', b: '#f2a81d', r: '#3b7ddd', q: '#9b59d0', k: '#1fb5a8' };

// --- Intro characters ---------------------------------------------------------------------------------------

const CHARACTERS = ['giant-baby', 'baby-dino', 'baby-dino-noshirt'] as const;
type CharKey = (typeof CHARACTERS)[number];
const charCache = new Map<CharKey, THREE.Object3D>();
let preloaded = false;

export function preloadIntro(): void {
  if (preloaded) return;
  preloaded = true;
  const loader = new GLTFLoader();
  for (const key of CHARACTERS) {
    loader
      .loadAsync(`${import.meta.env.BASE_URL}assets/intro/${key}.glb`)
      .then((gltf) => charCache.set(key, gltf.scene))
      .catch(() => {}); // missing model: a plain stand-in keeps the timeline running
  }
}

/** A character `height` tall, feet at the origin, facing local +Z. */
function character(key: CharKey, height: number, fallback: string): THREE.Group {
  const holder = new THREE.Group();
  const src = charCache.get(key);
  const model = src ? src.clone(true) : new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 6, 12), new THREE.MeshStandardMaterial({ color: fallback }));
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  const pivot = new THREE.Group();
  pivot.add(model);
  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  model.position.set(-c.x, -box.min.y, -c.z);
  pivot.scale.setScalar(height / Math.max(box.max.y - box.min.y, 1e-6));
  holder.add(pivot);
  return holder;
}

/** Swap every standard material to flat toy plastic; returns a function that restores the armored look. */
function plasticize(root: THREE.Object3D, color: string): () => void {
  const saved: { m: THREE.MeshStandardMaterial; map: THREE.Texture | null; color: THREE.Color; rough: number; metal: number }[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      saved.push({ m, map: m.map, color: m.color.clone(), rough: m.roughness, metal: m.metalness });
      m.map = null;
      m.color.set(color);
      m.roughness = 0.28;
      m.metalness = 0;
      m.needsUpdate = true;
    }
  });
  return () => {
    for (const s of saved) {
      s.m.map = s.map;
      s.m.color.copy(s.color);
      s.m.roughness = s.rough;
      s.m.metalness = s.metal;
      s.m.needsUpdate = true;
    }
  };
}

// --- Director -----------------------------------------------------------------------------------------------

interface Figure {
  f: Fighter;
  piece: BoardPiece;
  /** Where it stands on the board. */
  home: V3;
  /** Resting yaw (faces the enemy). */
  yaw: number;
}

export class IntroDirector {
  private token = 0;

  constructor(
    private scene: THREE.Scene,
    private layer: PieceLayer,
    private rig: CameraRig,
    private tw: Tweener,
  ) {
    preloadIntro();
  }

  /** Play the intro, ending with `pieces` as paper cutouts. Resolves when it finishes or `skip` resolves. */
  async play(pieces: BoardPiece[], skip: Promise<void>): Promise<void> {
    const token = ++this.token;
    const alive = (): boolean => token === this.token;
    const stage = new THREE.Group();
    this.scene.add(stage);
    const shot = this.rig.beginShot();
    const figures: Figure[] = [];
    this.layer.setPosition([]);

    const run = this.timeline(pieces, stage, shot, figures, alive).catch((e) => console.error('Intro failed:', e));
    await Promise.race([run, skip]);

    this.token++; // stops a skipped timeline from touching the scene
    this.scene.remove(stage);
    for (const fig of figures) fig.f.dispose();
    this.rig.shakeAmp = 0;
    this.rig.endShot();
    this.layer.setPosition(pieces);
  }

  private async timeline(pieces: BoardPiece[], stage: THREE.Group, shot: Shot, figures: Figure[], alive: () => boolean): Promise<void> {
    const tw = this.tw;
    const wait = (s: number): Promise<void> => tw.wait(s);
    const tween = (s: number, fn: (t: number) => void, e = ease.inOutSine, delay = 0): Promise<void> =>
      tw.add(s, (t) => alive() && fn(t), { ease: e, delay });
    const cut = (pos: V3, target: V3): void => {
      shot.pos.copy(pos);
      shot.target.copy(target);
    };
    const camTo = (pos: V3, target: V3, s: number, e = ease.inOutSine): Promise<void> => {
      const p0 = shot.pos.clone();
      const t0 = shot.target.clone();
      return tween(s, (t) => {
        shot.pos.lerpVectors(p0, pos, t);
        shot.target.lerpVectors(t0, target, t);
      }, e);
    };
    const shake = (amp: number, s: number): Promise<void> => tween(s, (t) => (this.rig.shakeAmp = amp * (1 - t)), ease.linear);

    // Rigged fighters need their clips advanced; one long tween drives every mixer until the intro ends.
    let last = performance.now();
    void tw.add(90, () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (alive()) for (const fig of figures) fig.f.tick(dt);
    });

    const spawn = (p: BoardPiece): Figure => {
      const f = createFighter(p.color, p.type, p.look ?? 0);
      const { x, z } = squareToXZ(p.square);
      const home = v(x, BOARD_Y + (f.flier ? 0.15 : 0), z);
      const yaw = p.color === 'w' ? Math.PI : 0;
      f.root.rotation.y = yaw;
      f.root.scale.setScalar(0.001);
      f.play('idle');
      stage.add(f.root);
      const fig = { f, piece: p, home, yaw };
      figures.push(fig);
      return fig;
    };

    /** Toss a figure from `from` to its square: a tumbling arc, a little bounce, growing to full size. */
    const toss = async (fig: Figure, from: V3, delay: number, s = 0.85): Promise<void> => {
      const { f, home } = fig;
      const spin = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2));
      const peak = 1.6 + Math.random() * 1.2;
      await tween(s, (t) => {
        f.root.position.lerpVectors(from, home, t);
        f.root.position.y += Math.sin(Math.PI * t) * peak;
        f.root.scale.setScalar(FIG_SCALE * Math.max(0.15, t));
        f.body.rotation.x = (1 - t) * Math.PI * 2 * spin;
      }, ease.linear, delay);
      await tween(0.28, (t) => {
        f.root.position.y = home.y + Math.sin(Math.PI * t) * 0.22;
        f.body.scale.set(1 + 0.15 * Math.sin(Math.PI * t), 1 - 0.15 * Math.sin(Math.PI * t), 1);
      }, ease.outCubic);
    };

    /** A toddling walk: `bob`-high steps with a side-to-side sway; `stomp` shakes the camera on each footfall. */
    const toddle = (obj: THREE.Object3D, from: V3, to: V3, s: number, steps: number, bob: number, stomp: number): Promise<void> =>
      tween(s, (t) => {
        obj.position.lerpVectors(from, to, t);
        const phase = t * steps * Math.PI;
        obj.position.y = from.y + Math.abs(Math.sin(phase)) * bob;
        obj.rotation.z = Math.sin(phase) * 0.07;
        if (stomp && Math.abs(Math.sin(phase)) < 0.08) this.rig.shakeAmp = stomp;
        else if (stomp) this.rig.shakeAmp *= 0.85;
      }, ease.linear);

    const dinos = pieces.filter((p) => p.color === 'b');
    const babies = pieces.filter((p) => p.color === 'w');

    // 1. Establish: the empty war table at sunset.
    cut(v(0, 7.5, 15), v(0, 0, 0));
    await camTo(v(0, 5, 10.5), v(0, 0.3, 0), 4);
    if (!alive()) return;

    // 2. Giant Baby toddles in behind the dino side; the table shakes with each step.
    const giant = character('giant-baby', GIANT_H, '#6b4a33');
    stage.add(giant);
    const gStart = v(-15, BOARD_Y, -9);
    const gSpot = v(0, BOARD_Y, -8.5);
    giant.position.copy(gStart);
    giant.rotation.y = Math.PI / 2;
    cut(v(-1.5, 1, 6.5), v(-4, 5.5, -8.5));
    void camTo(v(0, 1.2, 6), v(0, 5.5, -8.5), 4.6);
    await toddle(giant, gStart, gSpot, 4, 6, 0.35, 0.18);
    await tween(0.6, (t) => (giant.rotation.y = (Math.PI / 2) * (1 - t)));
    this.rig.shakeAmp = 0;
    if (!alive()) return;

    // 3. The Shake: the baby leans in and shakes the shirt; plastic toy dinos tumble onto their squares.
    void camTo(v(5, 6.5, 6.5), v(0, 1, -3), 1.2);
    await tween(0.6, (t) => (giant.rotation.x = 0.28 * t));
    const sack = (): V3 => v(gSpot.x, BOARD_Y + GIANT_H * 0.5, gSpot.z + GIANT_H * 0.22);
    void tween(2.6, (t) => (giant.rotation.z = Math.sin(t * Math.PI * 12) * 0.06 * (1 - t)), ease.linear);
    void shake(0.12, 2.6);
    const restores: (() => void)[] = [];
    const landed = dinos.map((p, i) => {
      const fig = spawn(p);
      restores.push(plasticize(fig.f.root, TOY_COLORS[p.type]));
      fig.f.root.position.copy(sack());
      return toss(fig, sack(), 0.15 + i * 0.14);
    });
    await Promise.all(landed);
    await tween(0.5, (t) => (giant.rotation.x = 0.28 * (1 - t)));
    if (!alive()) return;

    // 4. Dino transformation: the toys tremble, burst into smoke and sparks, and come out armored. Then a roar.
    const dinoFigs = figures.filter((fig) => fig.piece.color === 'b');
    cut(v(0, 2.4, 1.2), v(0, 0.6, -3));
    void camTo(v(0, 2.8, 2.2), v(0, 0.6, -3), 6);
    await tween(1.2, (t) => {
      for (const { f } of dinoFigs) f.body.rotation.z = (Math.random() - 0.5) * 0.25 * t;
    }, ease.linear);
    for (const { f } of dinoFigs) f.body.rotation.z = 0;
    for (const [i, { f, home }] of dinoFigs.entries()) {
      const at = home.clone().setY(home.y + 0.4);
      void burst(stage, tw, at, 0.7);
      void blast(stage, tw, at, 0.5, i % 2 ? '#ffd35a' : '#ff8a3a');
      void wait(0.18).then(() => alive() && restores[i]?.());
      f.body.scale.setScalar(1);
      await wait(0.06);
    }
    await wait(0.6);
    void shake(0.16, 1.1);
    await tween(1.1, (t) => {
      const s = 1 + Math.sin(Math.PI * t) * 0.18;
      for (const { f } of dinoFigs) f.body.scale.set(s, s, s);
    }, ease.outCubic);
    if (!alive()) return;

    // 5. Baby Dino waddles up on the baby side, wearing its baby-print shirt; the Giant Baby wanders off.
    void toddle(giant, gSpot, v(15, BOARD_Y, -9), 4, 6, 0.35, 0).then(() => stage.remove(giant));
    giant.rotation.y = -Math.PI / 2;
    const dino = character('baby-dino', DINO_H, '#3e9b45');
    stage.add(dino);
    const dStart = v(-13, BOARD_Y, 8.5);
    const dSpot = v(0, BOARD_Y, 8.2);
    dino.position.copy(dStart);
    dino.rotation.y = Math.PI / 2;
    cut(v(0, 2.2, 2.8), v(-3, 2.6, 8.4));
    void camTo(v(0, 2.4, 2.6), v(0, 2.8, 8.2), 3.6);
    await toddle(dino, dStart, dSpot, 3.2, 8, 0.25, 0.05);
    await tween(0.5, (t) => (dino.rotation.y = Math.PI / 2 + (Math.PI / 2) * t));
    if (!alive()) return;

    // 6. Shirt off: a squash, a big puff hides the swap, and the babies spill out onto their squares.
    await tween(0.35, (t) => dino.scale.set(1 + 0.08 * t, 1 - 0.1 * t, 1 + 0.08 * t), ease.inCubic);
    const chest = v(dSpot.x, BOARD_Y + DINO_H * 0.45, dSpot.z - DINO_H * 0.15);
    void burst(stage, tw, chest, 2.4);
    void blast(stage, tw, chest, 1.4, '#ffffff');
    await wait(0.15);
    stage.remove(dino);
    const bare = character('baby-dino-noshirt', DINO_H, '#3e9b45');
    bare.position.copy(dSpot);
    bare.rotation.y = Math.PI;
    stage.add(bare);
    void tween(0.4, (t) => bare.scale.set(1.08 - 0.08 * t, 0.9 + 0.1 * t, 1.08 - 0.08 * t), ease.outBack);
    void camTo(v(6.5, 4.5, 10.5), v(0, 1, 3), 1.6);
    await Promise.all(babies.map((p, i) => {
      const fig = spawn(p);
      fig.f.root.position.copy(chest);
      return toss(fig, chest, 0.1 + i * 0.12, 0.8);
    }));
    if (!alive()) return;

    // 7. Cute moment: the babies bounce and look around.
    const babyFigs = figures.filter((fig) => fig.piece.color === 'w');
    cut(v(-4.5, 1.1, 0.6), v(-3.5, 0.5, 2.5));
    void camTo(v(4.5, 1.1, 0.6), v(3.5, 0.5, 2.5), 4.2, ease.linear);
    void tween(1.2, (t) => bare.position.set(dSpot.x - 8 * t, BOARD_Y, dSpot.z + 2 * t), ease.inCubic).then(() => stage.remove(bare));
    const offsets = babyFigs.map(() => Math.random() * Math.PI * 2);
    await tween(4, (t) => {
      for (const [i, { f, home, yaw }] of babyFigs.entries()) {
        const ph = t * Math.PI * 6 + offsets[i];
        f.root.position.y = home.y + Math.max(0, Math.sin(ph)) * 0.12;
        f.root.rotation.y = yaw + Math.sin(ph * 0.5) * 0.6;
      }
    }, ease.linear);
    if (!alive()) return;

    // 8. Gets serious: everyone snaps round to face the dinos and squares up.
    cut(v(0.5, 0.75, 1.1), v(0.5, 0.45, 2.5));
    await tween(0.35, (t) => {
      for (const { f, home, yaw } of babyFigs) {
        f.root.rotation.y += (yaw - f.root.rotation.y) * t;
        f.root.position.y = home.y;
        f.body.scale.set(1 + 0.06 * t, 1 - 0.06 * t, 1);
      }
    }, ease.outCubic);
    await camTo(v(0.5, 0.65, 1.6), v(0.5, 0.45, 2.5), 2.4);
    if (!alive()) return;

    // 9. Suit-up montage: quick cuts down the line, each baby kitted out with a flash and a pop.
    const montage: string[] = ['d1', 'e1', 'b1', 'c1', 'h2'];
    for (const sq of montage) {
      const fig = babyFigs.find((b) => b.piece.square === sq);
      if (!fig) continue;
      const { f, home } = fig;
      const head = home.clone().setY(home.y + FIG_SCALE * f.height * 0.8);
      cut(v(home.x + 0.35, head.y + 0.05, home.z - 1.25), v(home.x, head.y - 0.12, home.z));
      void camTo(v(home.x + 0.15, head.y, home.z - 1.0), v(home.x, head.y - 0.12, home.z), 1.3, ease.outCubic);
      await wait(0.35);
      void blast(stage, tw, head, 0.35, '#fff3b0');
      await tween(0.4, (t) => f.body.scale.setScalar(1 + Math.sin(Math.PI * t) * 0.16), ease.outCubic);
      await wait(0.55);
      if (!alive()) return;
    }
    for (const { f } of babyFigs) f.body.scale.setScalar(1);

    // 10. Standoff: a wide side shot of both armies.
    cut(v(11, 3, 0.6), v(0, 0.4, 0));
    await camTo(v(9.5, 2.6, 0.3), v(0, 0.4, 0), 3);
    if (!alive()) return;

    // 11. Paper-ify: a sweep of light crosses the board; each figure flattens into its cutout.
    this.layer.setPosition(pieces);
    const cutouts = [...this.layer.pieces()];
    for (const p of cutouts) p.pivot.scale.x = 0.001;
    const sweepMat = new THREE.MeshBasicMaterial({ color: '#fff4d6', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    const sweep = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 3.2), sweepMat);
    sweep.rotation.y = Math.PI / 2;
    sweep.scale.z = 1;
    const sweepRow = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const s = sweep.clone();
      s.position.set(0, 1.4, -4 + i);
      sweepRow.add(s);
    }
    stage.add(sweepRow);
    void camTo(shot.home.pos, shot.home.target, 3, ease.inOutCubic);
    const flat = new Set<Figure>();
    const popped = new Set<object>();
    await tween(2, (t) => {
      const x = -5.5 + 11 * t;
      sweepRow.position.x = x;
      sweepMat.opacity = 0.55 * Math.sin(Math.PI * t);
      for (const fig of figures) {
        if (flat.has(fig) || fig.home.x > x) continue;
        flat.add(fig);
        void tween(0.18, (k) => fig.f.root.scale.set(FIG_SCALE * (1 - k) + 0.001, FIG_SCALE, FIG_SCALE), ease.inCubic);
      }
      for (const p of cutouts) {
        if (popped.has(p) || p.root.position.x > x) continue;
        popped.add(p);
        void tween(0.3, (k) => (p.pivot.scale.x = Math.max(0.001, k)), ease.outBack, 0.1);
      }
    }, ease.inOutSine);
    stage.remove(sweepRow);
    sweep.geometry.dispose();
    sweepMat.dispose();
    await wait(1.1);
  }
}
