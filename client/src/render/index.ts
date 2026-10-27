import * as THREE from 'three';
import type { BoardPiece, Color, FightMode, MoveAnim, MoveTarget, Square } from '../core/types';
import { FightDirector } from '../fight/director';
import type { BoardView } from './types';
import { createScene } from './scene';
import { createBoard } from './board';
import { PieceLayer } from './pieces';
import { Highlights } from './highlights';
import { CameraRig } from './camera';
import { Tweener } from './tween';
import { BOARD_Y, xzToSquare } from './coords';

export type { BoardView } from './types';

/** Pointer travel (px) above which a press counts as an orbit drag, not a click. */
const CLICK_SLOP = 6;

class ThreeBoardView implements BoardView {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private rig: CameraRig;
  private pieces: PieceLayer;
  private highlights = new Highlights();
  private pieceTw = new Tweener();
  private camTw = new Tweener();
  private clickCbs: ((sq: Square) => void)[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_Y);
  private down: { x: number; y: number; id: number } | null = null;
  private fights: FightDirector;
  private vignette: HTMLDivElement;
  private start = performance.now();

  constructor(private container: HTMLElement) {
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.domElement.style.display = 'block';
    r.domElement.style.width = '100%';
    r.domElement.style.height = '100%';
    r.domElement.style.touchAction = 'none';
    this.renderer = r;
    container.appendChild(r.domElement);

    const { scene } = createScene();
    this.scene = scene;
    scene.add(createBoard());
    this.pieces = new PieceLayer(this.pieceTw);
    scene.add(this.highlights.group, this.pieces.group);

    this.rig = new CameraRig(r.domElement, this.camTw);

    // Darkened edges that focus the eye on a fight.
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.vignette = document.createElement('div');
    Object.assign(this.vignette.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      opacity: '0',
      background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 38%, rgba(12,6,4,0.78) 100%)',
    });
    container.appendChild(this.vignette);
    this.fights = new FightDirector(scene, this.pieces, this.rig, this.pieceTw, {
      setDim: (a) => (this.vignette.style.opacity = String(a)),
    });
    this.pieces.setFightHandler((m, mover, victim) => this.fights.play(m, mover, victim));

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    this.bindInput(r.domElement);
    const loop = () => {
      requestAnimationFrame(loop); // schedule first so one bad frame can't stop the loop
      this.frame();
    };
    requestAnimationFrame(loop);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.rig.setAspect(w / h);
  }

  private frame(): void {
    const t = (performance.now() - this.start) / 1000;
    this.camTw.update(t);
    this.pieceTw.update(t);
    this.rig.update();
    // Keep the far table fading into the sunset haze at any zoom/aspect.
    const fog = this.scene.fog as THREE.Fog;
    const d = this.rig.camera.position.length();
    fog.near = d + 1;
    fog.far = d + 24;
    this.pieces.update(t, this.rig.camera);
    this.highlights.update(t);
    this.renderer.render(this.scene, this.rig.camera);
  }

  // ---- input -------------------------------------------------------------

  private bindInput(el: HTMLElement): void {
    el.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary) return;
      this.down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    el.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || d.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP) return;
      const sq = this.pick(e.clientX, e.clientY);
      if (sq) for (const cb of this.clickCbs) cb(sq);
    });
    el.addEventListener('pointercancel', () => (this.down = null));
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (this.down && e.buttons) return; // dragging the camera
      el.style.cursor = this.pick(e.clientX, e.clientY) ? 'pointer' : '';
    });
  }

  private pick(clientX: number, clientY: number): Square | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    const hits = this.raycaster.intersectObjects(this.pieces.pickables(), false);
    for (const h of hits) {
      const p = this.pieces.pieceOf(h.object);
      if (p && p.hitTest(h)) return p.square;
    }
    const pt = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.boardPlane, pt)) return xzToSquare(pt.x, pt.z);
    return null;
  }

  // ---- BoardView ----------------------------------------------------------

  setPosition(pieces: BoardPiece[]): void {
    this.fights.abort();
    this.pieces.setPosition(pieces);
  }

  animateMove(move: MoveAnim): Promise<void> {
    return this.pieces.animateMove(move);
  }

  setSelection(square: Square | null, targets: MoveTarget[]): void {
    this.highlights.setSelection(square, targets);
  }

  setLastMove(from: Square | null, to: Square | null): void {
    this.highlights.setLastMove(from, to);
  }

  setCheck(square: Square | null): void {
    this.highlights.setCheck(square);
  }

  setFightMode(mode: FightMode): void {
    this.fights.mode = mode;
    this.pieces.setFightHandler(mode === 'off' ? null : (m, mover, victim) => this.fights.play(m, mover, victim));
  }

  setViewSide(color: Color, animate: boolean): void {
    this.rig.setViewSide(color, animate);
  }

  onSquareClick(cb: (square: Square) => void): void {
    this.clickCbs.push(cb);
  }
}

export function createBoardView(container: HTMLElement): BoardView {
  return new ThreeBoardView(container);
}
