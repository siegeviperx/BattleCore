import * as THREE from 'three';
import type { MoveTarget, Square } from '../core/types';
import { BOARD_Y, squareToXZ } from './coords';

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.55, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft-edged square tint texture (bright border fading toward the centre). */
function squareGlowTexture(): THREE.CanvasTexture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 16; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${1 - i / 16})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(i * 1.5 + 1, i * 1.5 + 1, S - i * 3 - 2, S - i * 3 - 2);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function basicMat(opts: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    ...opts,
  });
}

const flat = <G extends THREE.BufferGeometry>(g: G): G => g.rotateX(-Math.PI / 2) as G;

export class Highlights {
  readonly group = new THREE.Group();
  private selected: THREE.Mesh;
  private lastFrom: THREE.Mesh;
  private lastTo: THREE.Mesh;
  private check: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private dots: THREE.Mesh[] = [];
  private rings: THREE.Mesh[] = [];
  private dotGeo = flat(new THREE.CircleGeometry(0.15, 32));
  private ringGeo = flat(new THREE.RingGeometry(0.38, 0.47, 48));
  private dotMat = basicMat({ color: '#1c1a14', opacity: 0.38 });
  private ringMat = basicMat({ color: '#ff5a2a', opacity: 0.75 });

  constructor() {
    const sqGeo = flat(new THREE.PlaneGeometry(1, 1));
    const glow = squareGlowTexture();
    this.selected = new THREE.Mesh(sqGeo, basicMat({ color: '#ffd21f', map: glow, opacity: 1, blending: THREE.AdditiveBlending }));
    this.selected.renderOrder = 3;
    const amber = basicMat({ color: '#ffa630', opacity: 0.38 });
    this.lastFrom = new THREE.Mesh(sqGeo, amber);
    this.lastTo = new THREE.Mesh(sqGeo, amber);
    this.lastFrom.renderOrder = this.lastTo.renderOrder = 1;
    this.check = new THREE.Mesh(
      flat(new THREE.PlaneGeometry(1.9, 1.9)),
      basicMat({ map: radialTexture('rgba(255,40,20,1)', 'rgba(255,0,0,0)'), blending: THREE.AdditiveBlending }),
    );
    this.check.renderOrder = 2;
    for (const m of [this.selected, this.lastFrom, this.lastTo, this.check]) {
      m.visible = false;
      this.group.add(m);
    }
  }

  private put(m: THREE.Object3D, sq: Square, y: number): void {
    const { x, z } = squareToXZ(sq);
    m.position.set(x, BOARD_Y + y, z);
    m.visible = true;
  }

  setSelection(square: Square | null, targets: MoveTarget[]): void {
    if (square) this.put(this.selected, square, 0.004);
    else this.selected.visible = false;
    let di = 0;
    let ri = 0;
    for (const t of square ? targets : []) {
      if (t.capture) {
        let r = this.rings[ri++];
        if (!r) {
          r = new THREE.Mesh(this.ringGeo, this.ringMat);
          r.renderOrder = 4;
          this.rings.push(r);
          this.group.add(r);
        }
        this.put(r, t.square, 0.006);
      } else {
        let d = this.dots[di++];
        if (!d) {
          d = new THREE.Mesh(this.dotGeo, this.dotMat);
          d.renderOrder = 4;
          this.dots.push(d);
          this.group.add(d);
        }
        this.put(d, t.square, 0.006);
      }
    }
    for (let i = di; i < this.dots.length; i++) this.dots[i].visible = false;
    for (let i = ri; i < this.rings.length; i++) this.rings[i].visible = false;
  }

  setLastMove(from: Square | null, to: Square | null): void {
    if (from) this.put(this.lastFrom, from, 0.002);
    else this.lastFrom.visible = false;
    if (to) this.put(this.lastTo, to, 0.002);
    else this.lastTo.visible = false;
  }

  setCheck(square: Square | null): void {
    if (square) this.put(this.check, square, 0.005);
    else this.check.visible = false;
  }

  update(time: number): void {
    if (this.check.visible) {
      const p = 0.5 + 0.5 * Math.sin(time * 6);
      this.check.material.opacity = 0.55 + 0.45 * p;
      this.check.scale.setScalar(0.9 + 0.2 * p);
    }
    if (this.selected.visible) {
      (this.selected.material as THREE.MeshBasicMaterial).opacity = 0.85 + 0.15 * Math.sin(time * 4);
    }
    const rp = 1 + 0.06 * Math.sin(time * 5);
    for (const r of this.rings) r.scale.setScalar(rp);
  }
}
