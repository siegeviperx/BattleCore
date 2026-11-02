import * as THREE from 'three';
import { activeBoard } from '../boards';
import { BOARD_Y } from './coords';
import { TABLE_Y, woodTexture } from './scene';

const THEME = activeBoard().theme;
const [LIGHT, DARK] = THEME.squares;
/** Outer size of the frame (board is 8×8). */
const FRAME = 9.5;
const RIM = (FRAME - 8) / 2;
const RIM_TOP = BOARD_Y + 0.07;

function squaresTexture(): THREE.CanvasTexture {
  const S = 1024;
  const q = S / 8;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let row = 0; row < 8; row++) {
    for (let f = 0; f < 8; f++) {
      const r = 7 - row; // canvas top = rank 8
      const dark = (f + r) % 2 === 0;
      ctx.fillStyle = dark ? DARK : LIGHT;
      ctx.fillRect(f * q, row * q, q, q);
      // marble-ish streaks
      ctx.save();
      ctx.beginPath();
      ctx.rect(f * q, row * q, q, q);
      ctx.clip();
      for (let i = 0; i < 6; i++) {
        ctx.strokeStyle = dark ? 'rgba(255,230,200,0.06)' : 'rgba(90,70,40,0.08)';
        ctx.lineWidth = 1 + rnd() * 3;
        ctx.beginPath();
        const y = row * q + rnd() * q;
        ctx.moveTo(f * q, y);
        ctx.bezierCurveTo(f * q + q * 0.3, y + (rnd() - 0.5) * 40, f * q + q * 0.7, y + (rnd() - 0.5) * 40, f * q + q, y + (rnd() - 0.5) * 30);
        ctx.stroke();
      }
      ctx.restore();
      // subtle bevel line
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 2;
      ctx.strokeRect(f * q + 1, row * q + 1, q - 2, q - 2);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Wooden rim with file/rank labels; transparent in the centre. */
function labelsTexture(): THREE.CanvasTexture {
  const S = 1536;
  const u = S / FRAME; // px per world unit
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  // wood rim
  const wood = woodTexture('#4a2f1c', '#1a0d06', 512, 4).image as HTMLCanvasElement;
  ctx.fillStyle = ctx.createPattern(wood, 'repeat')!;
  ctx.fillRect(0, 0, S, S);
  ctx.clearRect(RIM * u, RIM * u, 8 * u, 8 * u);
  // inner brass trim + outer edge
  ctx.strokeStyle = THEME.trim;
  ctx.lineWidth = 7;
  ctx.strokeRect(RIM * u - 4, RIM * u - 4, 8 * u + 8, 8 * u + 8);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, S - 10, S - 10);
  // corner rivets
  for (const [cx, cy] of [
    [RIM * u * 0.5, RIM * u * 0.5],
    [S - RIM * u * 0.5, RIM * u * 0.5],
    [RIM * u * 0.5, S - RIM * u * 0.5],
    [S - RIM * u * 0.5, S - RIM * u * 0.5],
  ]) {
    const g = ctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 22);
    g.addColorStop(0, '#f3d38a');
    g.addColorStop(1, '#6b4a1a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#efe2c4';
  ctx.font = `bold ${Math.round(u * 0.42)}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const mid = RIM * u * 0.5;
  const draw = (text: string, x: number, y: number, rot: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  for (let i = 0; i < 8; i++) {
    const file = String.fromCharCode(97 + i);
    const along = (RIM + i + 0.5) * u;
    draw(file, along, S - mid, 0); // near (white) edge
    draw(file, along, mid, Math.PI); // far edge, readable from black's side
    const rank = String(8 - i); // canvas row i from top = rank 8-i
    draw(rank, mid, along, 0);
    draw(rank, S - mid, along, Math.PI);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createBoard(): THREE.Group {
  const g = new THREE.Group();

  // Plinth under the board, from the table up to the board surface.
  const plinthH = BOARD_Y - TABLE_Y;
  const frameMat = new THREE.MeshStandardMaterial({ color: THEME.frame, roughness: 0.55, metalness: 0.1 });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(FRAME, plinthH, FRAME), frameMat);
  plinth.position.y = TABLE_Y + plinthH / 2;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  g.add(plinth);

  // Playing surface.
  const squares = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2),
    new THREE.MeshPhysicalMaterial({
      map: squaresTexture(),
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.6,
      clearcoatRoughness: 0.22,
    }),
  );
  squares.position.y = BOARD_Y + 0.001;
  squares.receiveShadow = true;
  g.add(squares);

  // Raised rim (four boxes) + labelled top.
  const rimH = RIM_TOP - BOARD_Y + 0.02;
  const rimMat = new THREE.MeshStandardMaterial({ color: THEME.rim, roughness: 0.6 });
  const mk = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, rimH, d), rimMat);
    m.position.set(x, RIM_TOP - rimH / 2, z);
    m.receiveShadow = true;
    m.castShadow = true;
    g.add(m);
  };
  const off = 4 + RIM / 2;
  mk(FRAME, RIM, 0, off);
  mk(FRAME, RIM, 0, -off);
  mk(RIM, 8, off, 0);
  mk(RIM, 8, -off, 0);

  const labels = new THREE.Mesh(
    new THREE.PlaneGeometry(FRAME, FRAME).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      map: labelsTexture(),
      alphaTest: 0.5,
      roughness: 0.5,
      metalness: 0.1,
    }),
  );
  labels.position.y = RIM_TOP + 0.001;
  labels.receiveShadow = true;
  g.add(labels);

  // Brass corner caps.
  const brass = new THREE.MeshStandardMaterial({ color: THEME.trim, metalness: 1, roughness: 0.35 });
  const capGeo = new THREE.BoxGeometry(0.5, 0.42, 0.5);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cap = new THREE.Mesh(capGeo, brass);
      cap.position.set(sx * (FRAME / 2 - 0.22), RIM_TOP - 0.2, sz * (FRAME / 2 - 0.22));
      cap.castShadow = true;
      g.add(cap);
    }
  }
  return g;
}
