import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Color } from '../core/types';
import { BOARD_Y } from './coords';
import { ease, Tweener } from './tween';

const FOV = 42;
/** Default polar angle (from +Y), matches a camera at about (0, 9, 8.5). */
const DEFAULT_POLAR = Math.atan2(8.5, 9);
const BASE_DIST = Math.hypot(8.5, 9);
/** Half-width (world units) that must fit horizontally. */
const HALF_WIDTH = 5.0;
/** Scripted shots (intro, fights) are framed for a 16:9 screen. Narrower screens widen the lens up to
 *  MAX_SHOT_FOV and pull the camera back for the rest, so each shot keeps its width on a phone. */
const SHOT_ASPECT = 16 / 9;
const MAX_SHOT_FOV = 70;
/** A pulled-back shot camera never sinks below this (it would look up through the table). */
const MIN_SHOT_Y = BOARD_Y + 0.25;
const toRad = THREE.MathUtils.degToRad;
const toDeg = THREE.MathUtils.radToDeg;

/** Screen edges (CSS px) covered by HUD panels; the board is framed in the space between them. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A scripted camera shot (fight scenes). Mutate `pos`/`target`; the rig applies them every frame. */
export interface Shot {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  /** Where the orbit camera was when the shot began. */
  readonly home: { pos: THREE.Vector3; target: THREE.Vector3 };
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private side: Color = 'w';
  private animating = false;
  private shot: Shot | null = null;
  /** Camera shake amplitude (world units) during a shot. */
  shakeAmp = 0;
  private size = { w: 1, h: 1 };
  private shotPos = new THREE.Vector3();
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

  constructor(dom: HTMLElement, private tw: Tweener) {
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
    this.controls = new OrbitControls(this.camera, dom);
    const c = this.controls;
    c.enablePan = false;
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.minPolarAngle = 0.12;
    c.maxPolarAngle = 1.32;
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 0.8;
    c.target.set(0, 0, 0);
    this.place(this.azimuthFor('w'), DEFAULT_POLAR, BASE_DIST);
  }

  private azimuthFor(side: Color): number {
    return side === 'w' ? 0 : Math.PI;
  }

  /** Distance that fits the board's width into the area the HUD leaves free. */
  fitDistance(): number {
    const { w, h } = this.size;
    const freeW = Math.max(1, w - this.insets.left - this.insets.right);
    const vHalf = THREE.MathUtils.degToRad(FOV / 2);
    const hHalf = Math.atan((Math.tan(vHalf) * freeW) / h);
    return Math.max(BASE_DIST, HALF_WIDTH / Math.tan(hHalf) + 2.5);
  }

  setViewport(w: number, h: number): void {
    this.size = { w, h };
    this.applyView();
  }

  setInsets(insets: Insets): void {
    const a = this.insets;
    if (a.top === insets.top && a.right === insets.right && a.bottom === insets.bottom && a.left === insets.left) return;
    this.insets = { ...insets };
    this.applyView();
  }

  private applyView(): void {
    const { w, h } = this.size;
    const i = this.insets;
    this.camera.aspect = w / h;
    // Shift the projection so the orbit target sits in the middle of the free area, not the middle of the screen.
    this.camera.setViewOffset(w, h, (i.right - i.left) / 2, (i.bottom - i.top) / 2, w, h);
    this.camera.updateProjectionMatrix();
    const fit = this.fitDistance();
    this.controls.minDistance = Math.min(7, fit * 0.6);
    this.controls.maxDistance = fit * 1.6;
    if (!this.animating) {
      const s = this.spherical();
      this.place(s.theta, s.phi, fit);
    }
  }

  private spherical(): THREE.Spherical {
    return new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
  }

  private place(theta: number, phi: number, radius: number): void {
    const v = new THREE.Vector3().setFromSpherical(new THREE.Spherical(radius, phi, theta));
    this.camera.position.copy(this.controls.target).add(v);
    this.camera.lookAt(this.controls.target);
  }

  setViewSide(color: Color, animate: boolean): void {
    this.side = color;
    const targetTheta = this.azimuthFor(color);
    const fit = this.fitDistance();
    if (!animate) {
      this.animating = false;
      this.place(targetTheta, DEFAULT_POLAR, fit);
      this.controls.update();
      return;
    }
    const s = this.spherical();
    let dTheta = targetTheta - s.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    if (Math.abs(Math.abs(dTheta) - Math.PI) < 1e-3) dTheta = Math.PI; // pick a consistent direction
    const from = { theta: s.theta, phi: s.phi, r: s.radius };
    this.animating = true;
    this.controls.enabled = false;
    const mySide = color;
    void this.tw
      .add(
        0.8,
        (t) => {
          if (this.side !== mySide) return;
          this.place(from.theta + dTheta * t, from.phi + (DEFAULT_POLAR - from.phi) * t, from.r + (fit - from.r) * t);
        },
        { ease: ease.inOutCubic },
      )
      .then(() => {
        if (this.side !== mySide) return;
        this.animating = false;
        this.controls.enabled = !this.shot;
        this.controls.update();
      });
  }

  /** Lens and pull-back that give a shot on this screen the width it has on a 16:9 screen. */
  private narrowFit(): { fov: number; dolly: number } {
    const aspect = this.camera.aspect;
    if (aspect >= SHOT_ASPECT) return { fov: FOV, dolly: 1 };
    const want = Math.tan(toRad(FOV / 2)) * SHOT_ASPECT; // tan of the horizontal half-angle a 16:9 shot shows
    const fov = Math.min(MAX_SHOT_FOV, 2 * toDeg(Math.atan(want / aspect)));
    return { fov, dolly: want / (Math.tan(toRad(fov / 2)) * aspect) };
  }

  private setFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) < 1e-3) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Take the camera off the orbit controls for a scripted shot, starting from the current view. */
  beginShot(): Shot {
    this.endShot();
    const pos = this.camera.position.clone();
    const target = this.controls.target.clone();
    this.shot = { pos, target, home: { pos: pos.clone(), target: target.clone() } };
    this.controls.enabled = false;
    return this.shot;
  }

  /** Snap back to where the shot began and hand control back to the player. */
  endShot(): void {
    const s = this.shot;
    if (!s) return;
    this.shot = null;
    this.shakeAmp = 0;
    this.setFov(FOV);
    this.camera.position.copy(s.home.pos);
    this.controls.target.copy(s.home.target);
    this.camera.lookAt(s.home.target);
    this.controls.enabled = !this.animating;
  }

  update(): void {
    const s = this.shot;
    if (s) {
      // Ease the narrow-screen adjustment in as the shot leaves the board view, so cutting away and back never jumps.
      const fit = this.narrowFit();
      const away = Math.min(1, s.pos.distanceTo(s.home.pos) / 2);
      this.setFov(FOV + (fit.fov - FOV) * away);
      const p = this.shotPos.copy(s.pos).sub(s.target).multiplyScalar(1 + (fit.dolly - 1) * away).add(s.target);
      p.y = Math.max(p.y, Math.min(s.pos.y, MIN_SHOT_Y));
      const k = this.shakeAmp;
      this.camera.position.set(p.x + (Math.random() - 0.5) * k, p.y + (Math.random() - 0.5) * k, p.z + (Math.random() - 0.5) * k);
      this.camera.lookAt(s.target);
      return;
    }
    if (!this.animating) this.controls.update();
  }
}
