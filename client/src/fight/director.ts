// Fight-scene director: turns a capture into zoom in → pop to 3D → attack → knockout → poof → flatten → zoom out.
// The framing, camera and timing are shared by every fight; only the attack and knockout clips change per piece.
import * as THREE from 'three';
import type { FightMode, MoveAnim } from '../core/types';
import choreo from '../data/fights.json';
import type { CameraRig } from '../render/camera';
import { BOARD_Y, squareToXZ } from '../render/coords';
import { BASE_H, type PieceLayer, type PieceObj } from '../render/pieces';
import { ease, type Tweener } from '../render/tween';
import { createFighter, type Fighter } from './fighters';
import { blast, burst } from './fx';
import { ATTACKS, KNOCKOUTS, type AttackSpec, type KnockoutSpec, type MoveCtx } from './moves';

const timing = choreo.timing;
/** Where the two fighters stand, relative to the captured square's center, along the line of attack. */
const ATTACKER_OFFSET = -0.58;
const DEFENDER_OFFSET = 0.2;
const HOVER = 0.28;
/** Board pieces closer than this to the arena (or to the camera's sightline) step aside during the fight. */
const CLEAR_RADIUS = 1.15;

export interface Dimmer {
  /** 0 = normal board, 1 = fully darkened edges. */
  setDim(amount: number): void;
}

export function attackSpec(color: 'w' | 'b', type: keyof typeof choreo.pieces.w): AttackSpec {
  return choreo.pieces[color][type].attack as AttackSpec;
}

export function knockoutSpec(color: 'w' | 'b', type: keyof typeof choreo.pieces.w): KnockoutSpec {
  return choreo.pieces[color][type].knockout as KnockoutSpec;
}

export class FightDirector {
  private stage: THREE.Group | null = null;
  private fighters: Fighter[] = [];
  /** Bumped on abort so a running fight stops touching the scene. */
  private token = 0;
  mode: FightMode = 'full';

  constructor(
    private scene: THREE.Scene,
    private layer: PieceLayer,
    private rig: CameraRig,
    private tw: Tweener,
    private dimmer: Dimmer,
  ) {}

  /** Stop any fight at once (new position, undo, menu) and give the camera back. */
  abort(): void {
    this.token++;
    this.cleanup();
  }

  private cleanup(): void {
    if (this.stage) this.scene.remove(this.stage);
    this.stage = null;
    for (const f of this.fighters) f.dispose();
    this.fighters = [];
    this.rig.endShot();
    this.dimmer.setDim(0);
  }

  async play(m: MoveAnim, mover: PieceObj, victim: PieceObj): Promise<void> {
    this.abort();
    const token = this.token;
    const gen = this.layer.generation;
    const alive = () => token === this.token && gen === this.layer.generation;
    const quick = this.mode === 'quick';
    const speed = quick ? timing.quickSpeed : 1;
    const T = (s: number) => s / speed;
    const cam = quick ? choreo.camera.quick : choreo.camera.full;
    const tw = this.tw;

    const stage = new THREE.Group();
    this.stage = stage;
    this.scene.add(stage);

    // Line of attack along the board.
    const center = squareToXZ(victim.square);
    const start = { x: mover.root.position.x, z: mover.root.position.z };
    const dir = new THREE.Vector3(center.x - start.x, 0, center.z - start.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, mover.color === 'w' ? -1 : 1);
    dir.normalize();
    const atkXZ = { x: center.x + dir.x * ATTACKER_OFFSET, z: center.z + dir.z * ATTACKER_OFFSET };
    const defXZ = { x: center.x + dir.x * DEFENDER_OFFSET, z: center.z + dir.z * DEFENDER_OFFSET };
    const mid = new THREE.Vector3((atkXZ.x + defXZ.x) / 2, BOARD_Y, (atkXZ.z + defXZ.z) / 2);

    // Camera: side-on to the line of attack, on whichever side the player is already looking from.
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    if (side.dot(this.rig.camera.position.clone().sub(mid)) < 0) side.negate();
    const shotPos = mid.clone().addScaledVector(side, cam.side).addScaledVector(dir, -cam.back).setY(BOARD_Y + cam.up);
    const shotTarget = mid.clone().setY(BOARD_Y + cam.lookUp);
    const shot = this.rig.beginShot();
    const fromPos = shot.pos.clone();
    const fromTarget = shot.target.clone();

    mover.moving = victim.moving = true;
    const cleared = this.clearArena(mid, shotPos, mover, victim);

    await Promise.all([
      tw.add(T(timing.cameraIn), (t) => {
        shot.pos.lerpVectors(fromPos, shotPos, t);
        shot.target.lerpVectors(fromTarget, shotTarget, t);
        this.dimmer.setDim(t);
      }, { ease: ease.inOutCubic }),
      this.layer.hop(mover, start, atkXZ, 0, quick ? 1.6 : 1),
      tw.add(T(0.3), (t) => victim.root.position.set(center.x + (defXZ.x - center.x) * t, BOARD_Y, center.z + (defXZ.z - center.z) * t), {
        ease: ease.inOutCubic,
      }),
    ]);
    if (!alive()) return;

    // Slow push-in for the rest of the fight.
    const pushFrom = shotPos.clone();
    const pushTo = shotPos.clone().lerp(shotTarget, cam.pushIn);
    void tw.add(T(2.5), (t) => {
      if (alive()) shot.pos.lerpVectors(pushFrom, pushTo, t);
    }, { ease: ease.outCubic });

    // Pop to 3D.
    const attacker = this.spawn(mover, dir);
    const defender = this.spawn(victim, dir.clone().negate());
    await Promise.all([this.popIn(attacker, mover, T), this.popIn(defender, victim, T)]);
    if (!alive()) return;

    const ctx: MoveCtx = {
      tw,
      T,
      fx: stage,
      attacker,
      defender,
      gap: Math.hypot(defXZ.x - atkXZ.x, defXZ.z - atkXZ.z),
      shake: (amount, seconds) => {
        void tw.add(seconds, (t) => {
          if (alive()) this.rig.shakeAmp = amount * (1 - t);
        });
      },
      hit: (heavy) => this.hit(ctx, heavy, T, alive),
    };

    await ATTACKS[attackSpec(mover.color, mover.type).kind](ctx, attackSpec(mover.color, mover.type));
    if (!alive()) return;
    await KNOCKOUTS[knockoutSpec(victim.color, victim.type).kind](ctx);
    if (!alive()) return;

    // Poof the loser.
    const at = defender.body.getWorldPosition(new THREE.Vector3());
    at.y = Math.max(BOARD_Y, at.y - 0.2);
    const puff = burst(stage, tw, at, 1.2);
    stage.remove(defender.root);
    this.layer.discard(victim);
    await tw.wait(T(0.3));
    if (!alive()) return;

    // Flatten the winner back into paper and walk home.
    await Promise.all([
      tw.add(T(timing.settle), (t) => attacker.root.scale.setScalar(Math.max(0.001, 1 - t)), { ease: ease.inCubic }),
      tw.add(T(timing.settle), (t) => {
        mover.pivot.visible = true;
        mover.pivot.scale.x = Math.max(0.001, t);
      }, { ease: ease.outBack }),
    ]);
    if (!alive()) return;
    stage.remove(attacker.root);

    const home = squareToXZ(m.to);
    const outFrom = shot.pos.clone();
    const outTarget = shot.target.clone();
    await Promise.all([
      this.layer.hop(mover, atkXZ, home, 0, quick ? 1.6 : 1),
      tw.add(T(timing.cameraOut), (t) => {
        shot.pos.lerpVectors(outFrom, shot.home.pos, t);
        shot.target.lerpVectors(outTarget, shot.home.target, t);
        this.dimmer.setDim(1 - t);
      }, { ease: ease.inOutCubic }),
      ...cleared.map((p) =>
        tw.add(T(0.25), (t) => p.body.scale.setScalar(Math.max(0.001, t)), { ease: ease.outBack, delay: T(0.15) }),
      ),
      puff,
    ]);
    if (!alive()) return;
    mover.placeAt(m.to);
    mover.moving = false;
    this.cleanup();
  }

  /** Tuck nearby pieces out of the way so the fighters have room and the camera has a clear view. */
  private clearArena(mid: THREE.Vector3, camPos: THREE.Vector3, ...keep: PieceObj[]): PieceObj[] {
    const out: PieceObj[] = [];
    const sight = new THREE.Line3(new THREE.Vector3(camPos.x, 0, camPos.z), new THREE.Vector3(mid.x, 0, mid.z));
    const closest = new THREE.Vector3();
    for (const p of this.layer.pieces()) {
      if (keep.includes(p)) continue;
      const pos = new THREE.Vector3(p.root.position.x, 0, p.root.position.z);
      const near = pos.distanceTo(new THREE.Vector3(mid.x, 0, mid.z)) < CLEAR_RADIUS;
      sight.closestPointToPoint(pos, true, closest);
      if (near || closest.distanceTo(pos) < 0.6) out.push(p);
    }
    for (const p of out) {
      void this.tw.add(0.2, (t) => p.body.scale.setScalar(Math.max(0.001, 1 - t)), { ease: ease.inCubic });
    }
    return out;
  }

  private spawn(piece: PieceObj, facing: THREE.Vector3): Fighter {
    const f = createFighter(piece.color, piece.type);
    f.root.position.copy(piece.root.position);
    f.root.position.y = BOARD_Y + BASE_H - 0.02 + (f.flier ? HOVER : 0);
    f.root.rotation.y = Math.atan2(facing.x, facing.z);
    f.root.scale.setScalar(0.001);
    this.stage!.add(f.root);
    this.fighters.push(f);
    return f;
  }

  private async popIn(f: Fighter, piece: PieceObj, T: (s: number) => number): Promise<void> {
    const flat = this.tw.add(T(timing.popIn * 0.5), (t) => (piece.pivot.scale.x = Math.max(0.001, 1 - t)), { ease: ease.inCubic });
    await flat;
    piece.pivot.visible = false;
    void blast(this.stage!, this.tw, f.root.position.clone().setY(BOARD_Y + 0.4), 0.5, '#ffffff');
    await this.tw.add(T(timing.popIn), (t) => f.root.scale.setScalar(Math.max(0.001, t)), { ease: ease.outBack });
  }

  private async hit(c: MoveCtx, heavy: boolean, T: (s: number) => number, alive: () => boolean): Promise<void> {
    if (!alive()) return;
    const d = c.defender;
    d.setFlash(heavy ? 1 : 0.6);
    if (heavy) {
      c.shake(timing.shake, T(0.25));
      await this.tw.wait(T(timing.hitStop));
    } else {
      c.shake(timing.shake * 0.3, T(0.1));
    }
    void this.tw.add(T(heavy ? 0.2 : 0.12), (t) => d.setFlash((heavy ? 1 : 0.6) * (1 - t)));
  }
}
