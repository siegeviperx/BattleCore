import * as THREE from 'three';
import type { BoardPiece, Color, MoveAnim, PieceType, Square } from '../core/types';
import data from '../data/pieces.json';
import { BOARD_Y, squareToFR, squareToXZ } from './coords';
import { CUTOUT_ASPECT, cutoutHit, getBaseTopTexture, getCutout, hasArt } from './cutouts';
import { sfx } from '../audio';
import { burst } from '../fight/fx';
import { ease, Tweener } from './tween';

export const BASE_H = 0.16;
const BASE_R_TOP = 0.35;
const BASE_R_BOTTOM = 0.38;

const HEIGHTS: Record<PieceType, number> = { p: 0.95, n: 1.08, b: 1.08, r: 1.08, q: 1.22, k: 1.3 };
/** Die-cut character art has no card background, so it needs to be larger to read at the same size. */
const ART_SCALE = 1.25;

const baseGeo = new THREE.CylinderGeometry(BASE_R_TOP, BASE_R_BOTTOM, BASE_H, 40);
baseGeo.translate(0, BASE_H / 2, 0);
const rimGeo = new THREE.TorusGeometry((BASE_R_TOP + BASE_R_BOTTOM) / 2 + 0.006, 0.012, 6, 40).rotateX(Math.PI / 2);
const cutoutGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);

const baseMats = new Map<Color, THREE.Material[]>();
function getBaseMaterials(color: Color): THREE.Material[] {
  let m = baseMats.get(color);
  if (!m) {
    const side = new THREE.MeshStandardMaterial({ color: data.factions[color].base, roughness: 0.42, metalness: 0.25 });
    const top = new THREE.MeshStandardMaterial({ map: getBaseTopTexture(color), roughness: 0.38, metalness: 0.15 });
    m = [side, top, side];
    baseMats.set(color, m);
  }
  return m;
}
const rimMat = new THREE.MeshStandardMaterial({ color: '#b8893f', metalness: 1, roughness: 0.35 });

export class PieceObj {
  readonly root = new THREE.Group();
  /** Scaled/spun for squash, poof and pops. */
  readonly body = new THREE.Group();
  /** Billboards around Y and sways. */
  readonly pivot = new THREE.Group();
  readonly base: THREE.Mesh;
  readonly cutout: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private depthMat: THREE.MeshDepthMaterial;
  color: Color;
  type: PieceType;
  /** Art variant; only meaningful while the piece keeps its type (a promoted pawn uses look 0). */
  look: number;
  square: Square;
  moving = false;
  readonly phase = Math.random() * Math.PI * 2;

  constructor(p: BoardPiece) {
    this.color = p.color;
    this.type = p.type;
    this.look = p.look ?? 0;
    this.square = p.square;
    this.base = new THREE.Mesh(baseGeo, getBaseMaterials(p.color));
    this.base.castShadow = true;
    this.base.receiveShadow = true;
    // Emblem faces its owner.
    this.base.rotation.y = p.color === 'w' ? Math.PI / 2 : -Math.PI / 2;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.y = 0.012;
    const c = getCutout(p.color, p.type, this.look);
    const mat = new THREE.MeshStandardMaterial({
      map: c.texture,
      emissive: '#ffffff',
      emissiveMap: c.texture,
      emissiveIntensity: 0.5,
      transparent: true,
      alphaTest: 0.04,
      side: THREE.DoubleSide,
      roughness: 0.65,
    });
    this.cutout = new THREE.Mesh(cutoutGeo, mat);
    this.cutout.castShadow = true;
    this.depthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: c.texture,
      alphaTest: 0.5,
    });
    this.cutout.customDepthMaterial = this.depthMat;
    this.applySize();
    this.pivot.position.y = BASE_H - 0.03;
    this.pivot.add(this.cutout);
    this.body.add(this.base, rim, this.pivot);
    this.root.add(this.body);
    this.root.userData.piece = this;
    this.placeAt(p.square);
  }

  private applySize(): void {
    const h = HEIGHTS[this.type] * (hasArt(this.color, this.type) ? ART_SCALE : 1);
    this.cutout.scale.set(h * CUTOUT_ASPECT, h, 1);
  }

  setType(type: PieceType): void {
    this.type = type;
    this.look = 0;
    const c = getCutout(this.color, type);
    this.cutout.material.map = c.texture;
    this.cutout.material.emissiveMap = c.texture;
    this.cutout.material.needsUpdate = true;
    this.depthMat.map = c.texture;
    this.depthMat.needsUpdate = true;
    this.applySize();
  }

  placeAt(sq: Square): void {
    const { x, z } = squareToXZ(sq);
    this.root.position.set(x, BOARD_Y, z);
    this.square = sq;
  }

  /** Is the given raycast hit on an opaque part of this piece? */
  hitTest(hit: THREE.Intersection): boolean {
    if (hit.object === this.base) return true;
    if (hit.object === this.cutout && hit.uv) return cutoutHit(getCutout(this.color, this.type, this.look), hit.uv.x, hit.uv.y);
    return false;
  }

  dispose(): void {
    this.cutout.material.dispose();
    this.depthMat.dispose();
  }
}

type XZ = { x: number; z: number };

/** Plays a capture as a fight scene instead of the plain hop + poof. The handler removes the victim. */
export type FightHandler = (m: MoveAnim, mover: PieceObj, victim: PieceObj) => Promise<void>;

export class PieceLayer {
  readonly group = new THREE.Group();
  private bySquare = new Map<Square, PieceObj>();
  private all = new Set<PieceObj>();
  private fx = new THREE.Group();
  /** Bumped by setPosition so in-flight animations stop touching the scene. */
  private gen = 0;
  private fight: FightHandler | null = null;

  constructor(private tw: Tweener) {
    this.group.add(this.fx);
  }

  setPosition(pieces: BoardPiece[]): void {
    this.gen++;
    this.tw.clear();
    for (const p of this.all) {
      this.group.remove(p.root);
      p.dispose();
    }
    this.all.clear();
    this.bySquare.clear();
    this.fx.clear();
    for (const bp of pieces) {
      const p = new PieceObj(bp);
      this.all.add(p);
      this.bySquare.set(bp.square, p);
      this.group.add(p.root);
    }
  }

  setFightHandler(fn: FightHandler | null): void {
    this.fight = fn;
  }

  get generation(): number {
    return this.gen;
  }

  pieces(): Iterable<PieceObj> {
    return this.all;
  }

  /** Remove a piece from the board right away (no effect). */
  discard(p: PieceObj): void {
    this.group.remove(p.root);
    this.all.delete(p);
    if (this.bySquare.get(p.square) === p) this.bySquare.delete(p.square);
    p.dispose();
  }

  at(sq: Square): PieceObj | undefined {
    return this.bySquare.get(sq);
  }

  /** Meshes for raycasting. */
  pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const p of this.all) out.push(p.base, p.cutout);
    return out;
  }

  pieceOf(obj: THREE.Object3D): PieceObj | null {
    let o: THREE.Object3D | null = obj;
    while (o) {
      if (o.userData.piece) return o.userData.piece as PieceObj;
      o = o.parent;
    }
    return null;
  }

  /** Per-frame: cylindrical billboard + idle sway. */
  update(time: number, camera: THREE.Camera): void {
    const cp = camera.position;
    for (const p of this.all) {
      const wp = p.root.position;
      const yaw = Math.atan2(cp.x - wp.x, cp.z - wp.z);
      p.pivot.rotation.y = yaw - p.body.rotation.y;
      if (!p.moving) {
        p.pivot.rotation.z = Math.sin(time * 1.7 + p.phase) * 0.035;
        p.pivot.rotation.x = Math.sin(time * 1.1 + p.phase * 1.3) * 0.015;
      }
    }
  }

  async animateMove(m: MoveAnim): Promise<void> {
    const mover = this.bySquare.get(m.from);
    if (!mover) return;
    const gen = this.gen;
    const jobs: Promise<void>[] = [];

    // Captured piece (en passant: different square).
    let victim: PieceObj | undefined;
    const capSq = m.captured?.square ?? m.to;
    const occupant = this.bySquare.get(capSq);
    if (occupant && occupant !== mover && (m.captured || capSq === m.to)) victim = occupant;
    if (victim) this.bySquare.delete(capSq);

    this.bySquare.delete(m.from);
    this.bySquare.set(m.to, mover);
    mover.square = m.to;

    // Castling rook bookkeeping.
    let rook: PieceObj | undefined;
    if (m.rookMove) {
      rook = this.bySquare.get(m.rookMove.from);
      if (rook) {
        this.bySquare.delete(m.rookMove.from);
        this.bySquare.set(m.rookMove.to, rook);
        rook.square = m.rookMove.to;
      }
    }

    const promote = async () => {
      if (gen !== this.gen) return;
      if (m.promotion && m.promotion !== mover.type) {
        mover.setType(m.promotion);
        await this.pop(mover);
      }
    };
    if (victim && this.fight) {
      await this.fight(m, mover, victim);
      await promote();
      return;
    }

    const hopDur = this.hopDuration(m.from, m.to);
    jobs.push(this.hop(mover, squareToXZ(m.from), squareToXZ(m.to), 0).then(promote));
    if (victim) {
      const v = victim;
      const poofDur = 0.42;
      jobs.push(this.poof(v, Math.max(0, hopDur - poofDur), poofDur));
    }
    if (rook && m.rookMove) jobs.push(this.hop(rook, squareToXZ(m.rookMove.from), squareToXZ(m.rookMove.to), hopDur * 0.55));
    await Promise.all(jobs);
  }

  private hopDuration(from: Square, to: Square): number {
    const a = squareToFR(from);
    const b = squareToFR(to);
    return hopSeconds(Math.hypot(a.f - b.f, a.r - b.r));
  }

  /** Paper hop between two board points (world x/z). `speed` > 1 makes it quicker. */
  async hop(p: PieceObj, a: XZ, b: XZ, delay: number, speed = 1): Promise<void> {
    const gen = this.gen;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const h = 0.35 + Math.min(1.4, d * 0.22);
    const dur = hopSeconds(d) / speed;
    // Tilt toward travel direction (in pivot space roughly along screen-x is fine).
    const dirX = b.x - a.x;
    let lifted = false;
    await this.tw.add(
      dur,
      (t) => {
        p.moving = true;
        if (!lifted && gen === this.gen) {
          lifted = true;
          sfx('flutter');
        }
        p.root.position.set(a.x + (b.x - a.x) * t, BOARD_Y + Math.sin(Math.PI * t) * h, a.z + (b.z - a.z) * t);
        // stretch in the air, lean slightly
        const air = Math.sin(Math.PI * t);
        p.body.scale.set(1 - air * 0.06, 1 + air * 0.1, 1 - air * 0.06);
        p.pivot.rotation.z = -Math.sign(dirX) * air * 0.12;
        p.pivot.rotation.x = 0;
      },
      { delay, ease: ease.inOutCubic },
    );
    if (gen !== this.gen) return;
    p.root.position.set(b.x, BOARD_Y, b.z);
    sfx('land');
    // Landing squash.
    await this.tw.add(0.16 / speed, (t) => {
      const s = Math.sin(Math.PI * t);
      p.body.scale.set(1 + s * 0.12, 1 - s * 0.16, 1 + s * 0.12);
      p.pivot.rotation.z *= 1 - t;
    });
    p.body.scale.set(1, 1, 1);
    p.moving = false;
  }

  private async pop(p: PieceObj): Promise<void> {
    const gen = this.gen;
    p.moving = true;
    sfx('promote');
    await this.tw.add(0.32, (t) => {
      const s = 1 + Math.sin(Math.PI * t) * 0.35;
      p.body.scale.setScalar(s);
      p.body.rotation.y = t * Math.PI * 2;
    }, { ease: ease.outCubic });
    if (gen !== this.gen) return;
    p.body.scale.setScalar(1);
    p.body.rotation.y = 0;
    p.moving = false;
  }

  private async poof(p: PieceObj, delay: number, dur: number): Promise<void> {
    const gen = this.gen;
    const squash = dur * 0.35;
    await this.tw.add(
      squash,
      (t) => {
        p.moving = true;
        p.body.scale.set(1 + t * 0.25, 1 - t * 0.35, 1 + t * 0.25);
      },
      { delay, ease: ease.outCubic },
    );
    if (gen !== this.gen) return;
    const puff = burst(this.fx, this.tw, p.root.position.clone().setY(BOARD_Y));
    await this.tw.add(
      dur - squash,
      (t) => {
        const s = 1 - t;
        p.body.scale.set(1.25 * s, 0.65 * s + 0.0001, 1.25 * s);
        p.body.rotation.y = t * Math.PI * 1.5;
        p.root.position.y = BOARD_Y + Math.sin(Math.PI * t) * 0.25;
      },
      { ease: ease.inCubic },
    );
    if (gen !== this.gen) return;
    this.group.remove(p.root);
    this.all.delete(p);
    p.dispose();
    await puff;
  }
}

function hopSeconds(dist: number): number {
  return 0.36 + Math.min(0.22, dist * 0.035);
}
