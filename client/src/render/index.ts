import * as THREE from 'three';
import type { BoardPiece, Color, FightMode, MoveAnim, MoveTarget, Square } from '../core/types';
import { IntroDirector } from '../cutscene/intro';
import { FightDirector } from '../fight/director';
import type { BoardView } from './types';
import { createScene } from './scene';
import { createBoard } from './board';
import { PieceLayer } from './pieces';
import { Highlights } from './highlights';
import { CameraRig, type Insets } from './camera';
import { BOARD_Y, squareToXZ, xzToSquare } from './coords';
import { ease, Tweener } from './tween';

export type { BoardView } from './types';
export type { Insets } from './camera';

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
  private intro: IntroDirector;
  private introPlaying = false;
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
    this.intro = new IntroDirector(scene, this.pieces, this.rig, this.pieceTw);

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
    this.rig.setViewport(w, h);
  }

  private frame(): void {
    const t = (performance.now() - this.start) / 1000;
    this.camTw.update(t);
    this.pieceTw.update(t);
    this.fights.update(t);
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
    if (this.introPlaying) return null;
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

  showCheck(square: Square): void {
    void this.pieces.alarm(square);
    this.ringBurst(square, '#ff3a1a', 2.2, 0.6);
    this.shake(0.05, 0.3);
  }

  async playCheckmate(king: Square, winner: Color): Promise<void> {
    this.ringBurst(king, '#ff3a1a', 2.6, 0.6);
    const fall = this.pieces.topple(king);
    await new Promise((r) => setTimeout(r, 1100)); // as the king hits the board
    this.flash('#fff1c4');
    this.ringBurst(king, '#ffd36a', 6, 0.9);
    this.shake(0.14, 0.5);
    await fall;
    await this.pieces.cheer(winner);
  }

  /** A shockwave ring expanding from a square. */
  private ringBurst(square: Square, color: string, size: number, seconds: number): void {
    const { x, z } = squareToXZ(square);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 64).rotateX(-Math.PI / 2), mat);
    ring.position.set(x, BOARD_Y + 0.01, z);
    ring.renderOrder = 5;
    this.scene.add(ring);
    void this.pieceTw.add(seconds, (t) => {
      ring.scale.setScalar(0.6 + t * size);
      mat.opacity = 1 - t;
    }, { ease: ease.outCubic }).then(() => {
      this.scene.remove(ring);
      ring.geometry.dispose();
      mat.dispose();
    });
  }

  /** Shake the whole table (the camera rig only shakes inside fight shots). */
  private shake(amp: number, seconds: number): void {
    const s = this.scene.position;
    void this.camTw.add(seconds, (t) => {
      const k = amp * (1 - t);
      s.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k * 0.5, (Math.random() - 0.5) * k);
    }).then(() => s.set(0, 0, 0));
  }

  /** A quick full-screen flash of light. */
  private flash(color: string): void {
    const el = document.createElement('div');
    Object.assign(el.style, { position: 'absolute', inset: '0', pointerEvents: 'none', background: color, opacity: '0' });
    this.container.appendChild(el);
    el.animate([{ opacity: 0.65 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' }).onfinish = () => el.remove();
  }

  setInsets(insets: Insets): void {
    this.rig.setInsets(insets);
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

  async playIntro(pieces: BoardPiece[]): Promise<void> {
    this.fights.abort();
    this.introPlaying = true;
    const hint = document.createElement('div');
    hint.textContent = 'Tap or press any key to skip';
    Object.assign(hint.style, {
      position: 'absolute',
      left: '50%',
      bottom: '18px',
      transform: 'translateX(-50%)',
      padding: '6px 14px',
      borderRadius: '999px',
      background: 'rgba(12, 8, 6, 0.55)',
      color: '#f4ead2',
      font: '600 13px system-ui, sans-serif',
      letterSpacing: '0.04em',
      pointerEvents: 'none',
    });
    this.container.appendChild(hint);
    let stop: () => void = () => {};
    const skip = new Promise<void>((resolve) => {
      const onInput = (e: Event): void => {
        if ((e as KeyboardEvent).repeat) return; // a key still held from the start card
        e.preventDefault();
        resolve();
      };
      window.addEventListener('keydown', onInput, true);
      window.addEventListener('pointerdown', onInput, true);
      stop = () => {
        window.removeEventListener('keydown', onInput, true);
        window.removeEventListener('pointerdown', onInput, true);
      };
    });
    try {
      await this.intro.play(pieces, skip);
    } finally {
      stop();
      hint.remove();
      this.introPlaying = false;
    }
  }
}

export function createBoardView(container: HTMLElement): BoardView {
  return new ThreeBoardView(container);
}
