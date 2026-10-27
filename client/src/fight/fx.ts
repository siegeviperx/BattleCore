// Effects shared by the board (capture poof) and the fight scenes: puffs, projectiles, blasts, stars.
import * as THREE from 'three';
import { ease, type Tweener } from '../render/tween';

export type ProjectileKind = 'dart' | 'ball' | 'boulder' | 'missile' | 'bottle' | 'bullet';

const puffGeo = new THREE.IcosahedronGeometry(0.17, 1);

/** A handful of puffs + paper confetti flying out. Resolves when the effect is gone. */
export async function burst(parent: THREE.Object3D, tw: Tweener, at: THREE.Vector3, size = 1): Promise<void> {
  const parts: { m: THREE.Mesh; v: THREE.Vector3; s: number; spin: number }[] = [];
  const puffMat = new THREE.MeshStandardMaterial({ color: '#f3ead9', roughness: 1, transparent: true, emissive: '#806850', emissiveIntensity: 0.4 });
  const bitMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, transparent: true, side: THREE.DoubleSide });
  const bitGeo = new THREE.PlaneGeometry(0.09 * size, 0.07 * size);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 * 3 + Math.random() * 0.4;
    const puff = i < 8;
    const m = new THREE.Mesh(puff ? puffGeo : bitGeo, puff ? puffMat : bitMat);
    m.position.set(at.x, at.y + (0.25 + Math.random() * 0.5) * size, at.z);
    const sp = (puff ? 1.4 + Math.random() * 0.8 : 1.8 + Math.random()) * size;
    parts.push({
      m,
      v: new THREE.Vector3(Math.cos(a) * sp, ((puff ? 0.8 : 2.2) + Math.random()) * size, Math.sin(a) * sp),
      s: (puff ? 0.7 + Math.random() * 0.6 : 1) * size,
      spin: (Math.random() - 0.5) * 20,
    });
    parent.add(m);
  }
  const dur = 0.65;
  let last = 0;
  await tw.add(dur, (t) => {
    const dt = (t - last) * dur;
    last = t;
    for (const p of parts) {
      p.m.position.addScaledVector(p.v, dt);
      if (p.m.geometry === bitGeo) {
        p.v.y -= 6 * dt;
        p.m.rotation.x += p.spin * dt;
        p.m.rotation.z += p.spin * 0.7 * dt;
      } else {
        p.v.multiplyScalar(1 - 3 * dt);
        p.m.scale.setScalar(p.s * (0.8 + t * 1.8));
      }
    }
    puffMat.opacity = 1 - t * t;
    bitMat.opacity = 1 - t;
  });
  for (const p of parts) parent.remove(p.m);
  puffMat.dispose();
  bitMat.dispose();
  bitGeo.dispose();
}

/** Cartoon blast: a bright core that pops and fades, plus a few smoke puffs. */
export async function blast(parent: THREE.Object3D, tw: Tweener, at: THREE.Vector3, size = 1, color = '#ffb43a'): Promise<void> {
  const coreMat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16 * size, 1), coreMat);
  core.position.copy(at);
  parent.add(core);
  const smokeMat = new THREE.MeshStandardMaterial({ color: '#5a5048', roughness: 1, transparent: true, depthWrite: false });
  const smoke: { m: THREE.Mesh; v: THREE.Vector3 }[] = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(puffGeo, smokeMat);
    m.position.copy(at);
    m.scale.setScalar(0.4 * size);
    const a = (i / 5) * Math.PI * 2;
    smoke.push({ m, v: new THREE.Vector3(Math.cos(a) * 0.5, 0.6 + Math.random() * 0.4, Math.sin(a) * 0.5).multiplyScalar(size) });
    parent.add(m);
  }
  const dur = 0.45;
  let last = 0;
  await tw.add(dur, (t) => {
    const dt = (t - last) * dur;
    last = t;
    core.scale.setScalar(0.6 + ease.outCubic(Math.min(1, t * 2.5)) * 1.6);
    coreMat.opacity = 1 - t;
    for (const s of smoke) {
      s.m.position.addScaledVector(s.v, dt);
      s.m.scale.setScalar(size * (0.4 + t * 0.9));
    }
    smokeMat.opacity = 0.85 * (1 - t);
  });
  parent.remove(core, ...smoke.map((s) => s.m));
  core.geometry.dispose();
  coreMat.dispose();
  smokeMat.dispose();
}

/** Brief bright sphere at a weapon tip. */
export function muzzleFlash(parent: THREE.Object3D, tw: Tweener, at: THREE.Vector3, color = '#fff2a8'): Promise<void> {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), mat);
  m.position.copy(at);
  parent.add(m);
  return tw
    .add(0.1, (t) => {
      m.scale.setScalar(1 + t * 1.5);
      mat.opacity = 1 - t;
    })
    .then(() => {
      parent.remove(m);
      m.geometry.dispose();
      mat.dispose();
    });
}

function projectileMesh(kind: ProjectileKind, color: string): THREE.Object3D {
  const g = new THREE.Group();
  const m = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 });
  switch (kind) {
    case 'dart': {
      const shaft = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.12, 4, 8).rotateX(Math.PI / 2), m(color));
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), m('#2a6fdb'));
      tip.position.z = 0.09;
      g.add(shaft, tip);
      break;
    }
    case 'bullet': {
      g.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.1, 4, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffe08a' })));
      break;
    }
    case 'ball':
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), m(color)));
      break;
    case 'boulder':
      g.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.14, 0), m(color)));
      break;
    case 'missile': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10).rotateX(Math.PI / 2), m('#5a5a60'));
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 10).rotateX(Math.PI / 2), m(color));
      nose.position.z = 0.14;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffb43a' }));
      flame.position.z = -0.15;
      g.add(body, nose, flame);
      break;
    }
    case 'bottle': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 12), m('#f4f1ea'));
      const milk = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.06, 12), m(color));
      milk.position.y = -0.03;
      const teat = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 10), m('#e8b04a'));
      teat.position.y = 0.1;
      g.add(body, milk, teat);
      break;
    }
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return g;
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
}

export interface ShotOptions {
  kind: ProjectileKind;
  color: string;
  /** Flight time (already time-scaled). */
  duration: number;
  /** Peak height of the arc above the straight line (0 = straight). */
  arc?: number;
  /** Tumble while flying (boulders, bottles). */
  spin?: boolean;
}

/** Fly a projectile from `from` to `to`; resolves on arrival (the projectile is removed). */
export async function shoot(parent: THREE.Object3D, tw: Tweener, from: THREE.Vector3, to: THREE.Vector3, o: ShotOptions): Promise<void> {
  const p = projectileMesh(o.kind, o.color);
  parent.add(p);
  const arc = o.arc ?? 0;
  const pos = new THREE.Vector3();
  const prev = from.clone();
  await tw.add(o.duration, (t) => {
    pos.lerpVectors(from, to, t);
    pos.y += Math.sin(Math.PI * t) * arc;
    p.position.copy(pos);
    if (o.spin) {
      p.rotation.x = t * 9;
      p.rotation.z = t * 5;
    } else if (pos.distanceToSquared(prev) > 1e-8) {
      p.lookAt(pos.clone().add(pos.clone().sub(prev)));
    }
    prev.copy(pos);
  });
  parent.remove(p);
  disposeTree(p);
}

const starShape = (() => {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.035 : 0.08;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
})();

/** Dizzy stars circling above `anchor` for `duration` seconds. */
export async function dizzyStars(anchor: THREE.Object3D, tw: Tweener, height: number, duration: number): Promise<void> {
  const ring = new THREE.Group();
  ring.position.y = height;
  const geo = new THREE.ShapeGeometry(starShape);
  const mat = new THREE.MeshBasicMaterial({ color: '#ffd84a', side: THREE.DoubleSide, transparent: true });
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(geo, mat);
    const a = (i / 3) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22);
    ring.add(s);
  }
  anchor.add(ring);
  await tw.add(duration, (t) => {
    ring.rotation.y = t * duration * 7;
    for (const s of ring.children) s.rotation.y = -ring.rotation.y;
    mat.opacity = t > 0.8 ? (1 - t) / 0.2 : 1;
  });
  anchor.remove(ring);
  geo.dispose();
  mat.dispose();
}

/** A stream of fiery puffs from `from` toward `to` (fire breath, jet wash). */
export async function flameStream(parent: THREE.Object3D, tw: Tweener, from: THREE.Vector3, to: THREE.Vector3, duration: number): Promise<void> {
  const mat = new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, depthWrite: false });
  const hot = new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, depthWrite: false });
  const puffs: { m: THREE.Mesh; born: number }[] = [];
  const life = 0.35;
  let spawned = 0;
  const count = 22;
  await tw.add(duration + life, (t) => {
    const now = t * (duration + life);
    while (spawned < count && (spawned / count) * duration <= now) {
      const m = new THREE.Mesh(puffGeo, spawned % 3 ? mat : hot);
      parent.add(m);
      puffs.push({ m, born: now });
      spawned++;
    }
    for (const p of puffs) {
      const k = Math.min(1, (now - p.born) / life);
      p.m.position.lerpVectors(from, to, k);
      p.m.position.y += Math.sin(k * Math.PI) * 0.05;
      p.m.scale.setScalar(0.25 + k * 0.9);
      p.m.visible = k < 1;
    }
    mat.opacity = hot.opacity = 0.9;
  });
  for (const p of puffs) parent.remove(p.m);
  mat.dispose();
  hot.dispose();
}
