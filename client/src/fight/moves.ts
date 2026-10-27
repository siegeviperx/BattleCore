// Procedural attack and knockout clips, picked by kind from data/fights.json. Each piece has one of each,
// so 12 attacks + 12 knockouts cover every matchup. Moves only touch fighter.body (local space, +Z = opponent).
import * as THREE from 'three';
import { sfx } from '../audio';
import { ease, type Tweener } from '../render/tween';
import type { Fighter } from './fighters';
import { blast, dizzyStars, flameStream, muzzleFlash, shoot, type ProjectileKind } from './fx';

export interface MoveCtx {
  tw: Tweener;
  /** Scale a duration in seconds by the fight speed (quick mode runs faster). */
  T: (seconds: number) => number;
  /** World-space parent for effects. */
  fx: THREE.Object3D;
  attacker: Fighter;
  defender: Fighter;
  /** Horizontal distance between the two fighters' roots. */
  gap: number;
  /** Register a hit on the defender. Heavy hits include hit-stop; resolves when play may continue. */
  hit(heavy: boolean): Promise<void>;
  shake(amount: number, seconds: number): void;
}

export interface AttackSpec {
  kind: AttackKind;
  shots?: number;
  count?: number;
  projectile?: ProjectileKind;
  color?: string;
  arc?: number;
  turns?: number;
  then?: 'tackle';
  windup?: 'command' | 'roar';
  strafe?: { shots: number; projectile: ProjectileKind; color: string };
}

export interface KnockoutSpec {
  kind: KnockoutKind;
}

const wait = (c: MoveCtx, s: number) => c.tw.wait(c.T(s));
const tween = (c: MoveCtx, s: number, fn: (t: number) => void, e = ease.inOutCubic) => c.tw.add(c.T(s), fn, { ease: e });

function muzzleWorld(f: Fighter): THREE.Vector3 {
  return f.muzzle.getWorldPosition(new THREE.Vector3());
}

/** Center of mass of the defender in world space. */
function targetWorld(f: Fighter): THREE.Vector3 {
  f.root.updateWorldMatrix(true, true);
  return f.root.localToWorld(new THREE.Vector3(0, f.height * 0.5, 0));
}

/** Fire `n` projectiles in a quick string; the last one lands as a heavy hit. */
async function rapidFire(c: MoveCtx, n: number, kind: ProjectileKind, color: string, lastHeavy: boolean): Promise<void> {
  const a = c.attacker.body;
  const shots: Promise<void>[] = [];
  for (let i = 0; i < n; i++) {
    const from = muzzleWorld(c.attacker);
    const to = targetWorld(c.defender).add(new THREE.Vector3((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12, 0));
    void muzzleFlash(c.fx, c.tw, from);
    void tween(c, 0.08, (t) => (a.position.z = -Math.sin(Math.PI * t) * 0.05), ease.linear);
    const heavy = lastHeavy && i === n - 1;
    shots.push(shoot(c.fx, c.tw, from, to, { kind, color, duration: c.T(0.16) }).then(() => c.hit(heavy)));
    await wait(c, 0.11);
  }
  await Promise.all(shots);
}

// ---------------------------------------------------------------------------
// Attacks
// ---------------------------------------------------------------------------

type AttackFn = (c: MoveCtx, s: AttackSpec) => Promise<void>;

const burst: AttackFn = async (c, s) => {
  const a = c.attacker.body;
  await tween(c, 0.18, (t) => (a.rotation.x = -0.1 * t), ease.outCubic);
  await rapidFire(c, s.shots ?? 3, s.projectile ?? 'dart', s.color ?? '#ff7a1a', s.then !== 'tackle');
  if (s.then === 'tackle') {
    // Diaper-dive: belly flop onto the target, then scramble back.
    const reach = c.gap - 0.32;
    sfx('swoosh');
    await tween(c, 0.28, (t) => {
      a.position.z = reach * t;
      a.position.y = Math.sin(Math.PI * t) * 0.35;
      a.rotation.x = -0.1 + t * 1.3;
    }, ease.inCubic);
    await c.hit(true);
    await tween(c, 0.32, (t) => {
      a.position.z = reach * (1 - t);
      a.position.y = Math.sin(Math.PI * t) * 0.2;
      a.rotation.x = 1.2 * (1 - t);
    });
  }
  await tween(c, 0.15, (t) => (a.rotation.x *= 1 - t));
};

const snipe: AttackFn = async (c, s) => {
  const a = c.attacker.body;
  await tween(c, 0.2, (t) => {
    a.position.y = -0.04 * t;
    a.scale.y = 1 - 0.06 * t;
  }, ease.outCubic);
  // Aiming beam with a wobble that settles.
  const beamMat = new THREE.LineBasicMaterial({ color: '#ff3b3b', transparent: true });
  const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const beam = new THREE.Line(beamGeo, beamMat);
  c.fx.add(beam);
  sfx('aim');
  const pos = beamGeo.attributes.position as THREE.BufferAttribute;
  await c.tw.add(c.T(0.6), (t) => {
    const from = muzzleWorld(c.attacker);
    const to = targetWorld(c.defender);
    const wob = (1 - t) * 0.12;
    to.x += Math.sin(t * 30) * wob;
    to.y += Math.cos(t * 23) * wob;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    beamMat.opacity = 0.4 + 0.6 * t;
  });
  c.fx.remove(beam);
  beamGeo.dispose();
  beamMat.dispose();
  const from = muzzleWorld(c.attacker);
  void muzzleFlash(c.fx, c.tw, from);
  void tween(c, 0.25, (t) => (a.position.z = -Math.sin(Math.PI * t) * 0.14), ease.outCubic);
  await shoot(c.fx, c.tw, from, targetWorld(c.defender), { kind: s.projectile ?? 'dart', color: s.color ?? '#ff7a1a', duration: c.T(0.09) });
  await c.hit(true);
  await tween(c, 0.2, (t) => {
    a.position.y = -0.04 * (1 - t);
    a.scale.y = 1 - 0.06 * (1 - t);
  });
};

const pounce: AttackFn = async (c) => {
  const a = c.attacker.body;
  const reach = c.gap - 0.38;
  await tween(c, 0.16, (t) => a.scale.set(1 + 0.08 * t, 1 - 0.15 * t, 1 + 0.08 * t), ease.outCubic);
  sfx('swoosh');
  await tween(c, 0.3, (t) => {
    a.scale.set(1, 1, 1);
    a.position.z = reach * t;
    a.position.y = Math.sin(Math.PI * t) * 0.5;
    a.rotation.x = Math.sin(Math.PI * t) * 0.35;
  });
  // Claw swipe
  await tween(c, 0.12, (t) => (a.rotation.y = -0.7 * t), ease.outCubic);
  await tween(c, 0.08, (t) => (a.rotation.y = -0.7 + 1.3 * t), ease.inCubic);
  await c.hit(true);
  await tween(c, 0.32, (t) => {
    a.rotation.y = 0.6 * (1 - t);
    a.position.z = reach * (1 - t);
    a.position.y = Math.sin(Math.PI * t) * 0.3;
  });
};

const charge: AttackFn = async (c) => {
  const a = c.attacker.body;
  // Back up and paw the ground.
  await tween(c, 0.35, (t) => {
    a.position.z = -0.18 * t;
    a.rotation.x = Math.sin(t * Math.PI * 6) * 0.06;
  });
  c.shake(0.02, c.T(0.3));
  sfx('stomp', { vol: 0.5 });
  const reach = c.gap - 0.42;
  sfx('swoosh', { rate: 0.7 });
  await tween(c, 0.2, (t) => {
    a.position.z = -0.18 + (reach + 0.18) * t;
    a.rotation.x = 0.15 * t;
  }, ease.inCubic);
  await c.hit(true);
  await tween(c, 0.35, (t) => {
    a.position.z = reach * (1 - t);
    a.rotation.x = 0.15 * (1 - t);
  });
};

const dive: AttackFn = async (c, s) => {
  const a = c.attacker.body;
  const top = 0.95;
  sfx('swoosh', { rate: 0.8 });
  await tween(c, 0.35, (t) => {
    a.position.y = top * t;
    a.position.z = -0.25 * t;
    a.rotation.x = -0.3 * t;
  }, ease.outCubic);
  const strafe = s.strafe ?? { shots: 3, projectile: 'dart' as ProjectileKind, color: '#2a6fdb' };
  const swoop = tween(c, 0.5, (t) => {
    a.position.z = -0.25 + (c.gap + 0.65) * t;
    a.position.y = top - Math.sin(Math.PI * Math.min(1, t * 1.15)) * (top - c.defender.height - 0.1) * 0.9;
    a.rotation.x = -0.3 + 0.75 * Math.sin(Math.PI * t);
  }, ease.inOutSine);
  await rapidFire(c, strafe.shots, strafe.projectile, strafe.color, false);
  await swoop;
  await c.hit(true);
  // Loop around back to the start.
  sfx('swoosh');
  await tween(c, 0.4, (t) => {
    a.position.z = c.gap + 0.4 - (c.gap + 0.4) * t;
    a.position.y = top * (1 - t) + Math.sin(Math.PI * t) * 0.3;
    a.rotation.x = 0.45 * (1 - t);
    a.rotation.y = Math.PI * 2 * t;
  });
  a.rotation.y = 0;
};

const volley: AttackFn = async (c, s) => {
  const a = c.attacker.body;
  if (s.windup === 'roar') {
    await tween(c, 0.2, (t) => (a.rotation.x = -0.25 * t), ease.outCubic);
    c.shake(0.05, c.T(0.5));
    sfx('roar');
    await tween(c, 0.5, (t) => a.scale.setScalar(1 + Math.sin(t * Math.PI * 5) * 0.035));
    await tween(c, 0.15, (t) => (a.rotation.x = -0.25 * (1 - t)));
  } else if (s.windup === 'command') {
    // "Charge!": rear up and point, then lob.
    sfx('cry');
    await tween(c, 0.25, (t) => {
      a.position.y = Math.sin(Math.PI * t) * 0.18;
      a.rotation.x = -0.2 * t;
    });
    await wait(c, 0.15);
  }
  const n = s.count ?? 1;
  const kind = s.projectile ?? 'ball';
  const spin = kind === 'boulder' || kind === 'bottle';
  const lobs: Promise<void>[] = [];
  for (let i = 0; i < n; i++) {
    const from = muzzleWorld(c.attacker);
    const to = targetWorld(c.defender).add(new THREE.Vector3((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2));
    void muzzleFlash(c.fx, c.tw, from, kind === 'missile' ? '#ffb43a' : '#fff2a8');
    void tween(c, 0.14, (t) => (a.position.z = -Math.sin(Math.PI * t) * 0.06), ease.linear);
    const heavy = i === n - 1;
    lobs.push(
      shoot(c.fx, c.tw, from, to, { kind, color: s.color ?? '#2a2a2e', duration: c.T(0.5), arc: s.arc ?? 0.7, spin }).then(() => {
        void blast(c.fx, c.tw, to, heavy ? 1.2 : 0.7);
        sfx('boom', { vol: heavy ? 1 : 0.6 });
        return c.hit(heavy);
      }),
    );
    await wait(c, 0.16);
  }
  await Promise.all(lobs);
  await tween(c, 0.15, (t) => (a.rotation.x *= 1 - t));
};

const twirl: AttackFn = async (c, s) => {
  const a = c.attacker.body;
  const turns = s.turns ?? 2;
  sfx('swoosh', { rate: 1.2 });
  await tween(c, 0.55, (t) => {
    a.rotation.y = Math.PI * 2 * turns * t;
    a.position.y = Math.sin(Math.PI * t) * 0.15;
  });
  a.rotation.y = 0;
  await rapidFire(c, s.shots ?? 4, s.projectile ?? 'dart', s.color ?? '#e0479e', true);
};

const breath: AttackFn = async (c) => {
  const a = c.attacker.body;
  // Tail sweep: a full spin with a glancing hit as the tail comes around.
  sfx('swoosh', { rate: 0.8 });
  let swept = false;
  await tween(c, 0.5, (t) => {
    a.rotation.y = Math.PI * 2 * t;
    if (!swept && t > 0.5) {
      swept = true;
      void c.hit(false);
    }
  });
  a.rotation.y = 0;
  await tween(c, 0.15, (t) => (a.rotation.x = -0.15 * t), ease.outCubic);
  const from = muzzleWorld(c.attacker);
  const to = targetWorld(c.defender);
  c.shake(0.025, c.T(0.6));
  await flameStream(c.fx, c.tw, from, to, c.T(0.55));
  await c.hit(true);
  await tween(c, 0.15, (t) => (a.rotation.x = -0.15 * (1 - t)));
};

export const ATTACKS = { burst, snipe, pounce, charge, dive, volley, twirl, breath } satisfies Record<string, AttackFn>;
export type AttackKind = keyof typeof ATTACKS;

// ---------------------------------------------------------------------------
// Knockouts (defender's local +Z faces the attacker, so "back" is -Z)
// ---------------------------------------------------------------------------

type KnockoutFn = (c: MoveCtx) => Promise<void>;

const pratfall: KnockoutFn = async (c) => {
  const d = c.defender.body;
  await tween(c, 0.22, (t) => {
    d.position.z = -0.15 * t;
    d.rotation.x = -0.25 * t;
  }, ease.outCubic);
  await tween(c, 0.22, (t) => {
    d.rotation.x = -0.25 - 1.2 * t;
    d.position.y = Math.sin(Math.PI * t) * 0.1;
  }, ease.inCubic);
  c.shake(0.025, c.T(0.15));
  sfx('thud');
  await dizzyStars(c.defender.root, c.tw, c.defender.height * 0.55, c.T(0.75));
};

const spinout: KnockoutFn = async (c) => {
  const d = c.defender.body;
  const stars = dizzyStars(c.defender.root, c.tw, c.defender.height + 0.1, c.T(0.9));
  sfx('swoosh', { rate: 1.3 });
  await tween(c, 0.75, (t) => {
    d.rotation.y = Math.PI * 4 * ease.outCubic(t);
    d.rotation.z = Math.sin(t * Math.PI * 6) * 0.2 * (1 - t);
  }, ease.linear);
  await stars;
  await tween(c, 0.25, (t) => (d.rotation.z = 1.4 * t), ease.inCubic);
  c.shake(0.02, c.T(0.12));
  sfx('thud', { vol: 0.6 });
};

const launch: KnockoutFn = async (c) => {
  const d = c.defender.body;
  sfx('whee');
  await tween(c, 0.65, (t) => {
    d.position.z = -1.3 * t;
    d.position.y = Math.sin(Math.PI * t * 0.85) * 1.2;
    d.rotation.x = -Math.PI * 3 * t;
    d.scale.setScalar(1 - 0.35 * t);
  }, ease.outCubic);
};

const topple: KnockoutFn = async (c) => {
  const d = c.defender.body;
  await tween(c, 0.25, (t) => (d.rotation.x = Math.sin(t * Math.PI * 3) * 0.08), ease.linear);
  await tween(c, 0.5, (t) => (d.rotation.x = -1.5 * t), ease.inCubic);
  c.shake(0.05, c.T(0.25));
  sfx('thud', { rate: 0.8 });
  const dust = c.defender.root.localToWorld(new THREE.Vector3(0, 0.05, -c.defender.height * 0.6));
  void blast(c.fx, c.tw, dust, 0.9, '#d8c7a8');
  await tween(c, 0.18, (t) => (d.rotation.x = -1.5 + Math.sin(Math.PI * t) * 0.12), ease.outCubic);
};

const flatten: KnockoutFn = async (c) => {
  const d = c.defender.body;
  await tween(c, 0.16, (t) => d.scale.set(1 + 0.45 * t, 1 - 0.88 * t, 1 + 0.45 * t), ease.outCubic);
  c.shake(0.03, c.T(0.15));
  sfx('squish');
  await dizzyStars(c.defender.root, c.tw, 0.2, c.T(0.7));
};

export const KNOCKOUTS = { pratfall, spinout, launch, topple, flatten } satisfies Record<string, KnockoutFn>;
export type KnockoutKind = keyof typeof KNOCKOUTS;
