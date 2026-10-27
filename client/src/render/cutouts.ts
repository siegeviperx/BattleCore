import * as THREE from 'three';
import type { Color, PieceType } from '../core/types';
import data from '../data/pieces.json';

/** Logical canvas size (drawn at 2× for crispness). */
const W = 256;
const H = 320;
const SCALE = 2;
/** Alpha mask downsample factor for hit tests. */
const MASK_STEP = 4;

export const CUTOUT_ASPECT = W / H;

const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
const GLYPH_FONT = '"Segoe UI Symbol","DejaVu Sans","Noto Sans Symbols 2","Arial Unicode MS",serif';
const LABEL_FONT = '"Arial Black","Impact","Segoe UI",sans-serif';

export interface Cutout {
  texture: THREE.CanvasTexture;
  /** Downsampled alpha mask (row 0 = canvas top). */
  mask: Uint8Array;
  maskW: number;
  maskH: number;
}

const cache = new Map<string, Cutout>();

export function getCutout(color: Color, type: PieceType): Cutout {
  const key = color + type;
  let c = cache.get(key);
  if (!c) {
    c = drawCutout(color, type);
    cache.set(key, c);
  }
  return c;
}

/** True if the sticker is opaque at texture uv (three.js uv, v up). */
export function cutoutHit(c: Cutout, u: number, v: number): boolean {
  const x = Math.min(c.maskW - 1, Math.max(0, Math.floor(u * c.maskW)));
  const y = Math.min(c.maskH - 1, Math.max(0, Math.floor((1 - v) * c.maskH)));
  return c.mask[y * c.maskW + x] > 100;
}

function shade(hex: string, amt: number): string {
  const col = new THREE.Color(hex);
  if (amt > 0) col.lerp(new THREE.Color('#ffffff'), amt);
  else col.lerp(new THREE.Color('#000000'), -amt);
  return '#' + col.getHexString();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCutout(color: Color, type: PieceType): Cutout {
  const faction = data.factions[color];
  const piece = data.pieces[color][type];
  const glyph = data.glyphs[type];

  const cv = document.createElement('canvas');
  cv.width = W * SCALE;
  cv.height = H * SCALE;
  const ctx = cv.getContext('2d')!;
  ctx.scale(SCALE, SCALE);

  // Sticker outline (white border) with soft drop shadow.
  const bx = 14;
  const by = 8;
  const bw = W - 28;
  const bh = H - 22;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, bx, by, bw, bh, 38);
  ctx.fill();
  ctx.restore();

  // Inner fill: faction primary gradient + camo blobs.
  const inset = 9;
  const ix = bx + inset;
  const iy = by + inset;
  const iw = bw - inset * 2;
  const ih = bh - inset * 2;
  ctx.save();
  roundRect(ctx, ix, iy, iw, ih, 30);
  ctx.clip();
  const grad = ctx.createLinearGradient(0, iy, 0, iy + ih);
  grad.addColorStop(0, shade(faction.primary, 0.35));
  grad.addColorStop(0.55, faction.primary);
  grad.addColorStop(1, shade(faction.primary, -0.45));
  ctx.fillStyle = grad;
  ctx.fillRect(ix, iy, iw, ih);
  let seed = (color === 'w' ? 101 : 211) + type.charCodeAt(0);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.globalAlpha = 0.16;
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = i % 2 ? faction.secondary : shade(faction.primary, -0.5);
    ctx.beginPath();
    ctx.ellipse(ix + rnd() * iw, iy + rnd() * ih, 12 + rnd() * 22, 7 + rnd() * 12, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Glossy highlight.
  const gloss = ctx.createLinearGradient(0, iy, 0, iy + ih * 0.45);
  gloss.addColorStop(0, 'rgba(255,255,255,0.28)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(ix, iy, iw, ih * 0.45);
  ctx.restore();

  // Big emoji.
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `140px ${EMOJI_FONT}`;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 4;
  ctx.fillText(piece.icon, W / 2, iy + 118);
  ctx.restore();

  // Name banner along the bottom.
  const bannerH = 38;
  const bannerY = iy + ih - bannerH - 12;
  ctx.save();
  ctx.fillStyle = shade(faction.secondary, color === 'w' ? -0.05 : -0.2);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ix - 4, bannerY);
  ctx.lineTo(ix + iw + 4, bannerY);
  ctx.lineTo(ix + iw - 6, bannerY + bannerH / 2);
  ctx.lineTo(ix + iw + 4, bannerY + bannerH);
  ctx.lineTo(ix - 4, bannerY + bannerH);
  ctx.lineTo(ix + 6, bannerY + bannerH / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color === 'w' ? '#2b2a1a' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = piece.name.toUpperCase();
  let size = 19;
  ctx.font = `${size}px ${LABEL_FONT}`;
  while (ctx.measureText(label).width > iw - 26 && size > 9) {
    size--;
    ctx.font = `${size}px ${LABEL_FONT}`;
  }
  ctx.fillText(label, W / 2, bannerY + bannerH / 2 + 1);
  ctx.restore();

  // Chess glyph corner badge.
  const cx = ix + 26;
  const cy = iy + 26;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = color === 'w' ? '#fffaf0' : '#1d1d20';
  ctx.beginPath();
  ctx.arc(cx, cy, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color === 'w' ? '#2b2a1a' : '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color === 'w' ? '#2b2a1a' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // U+FE0E forces text presentation so the glyph isn't swapped for an emoji.
  ctx.font = `32px ${GLYPH_FONT}`;
  ctx.fillText(glyph + '︎', cx, cy + 2);

  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  // Alpha mask for pixel-accurate picking.
  const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const step = MASK_STEP * SCALE;
  const maskW = Math.floor(cv.width / step);
  const maskH = Math.floor(cv.height / step);
  const mask = new Uint8Array(maskW * maskH);
  for (let y = 0; y < maskH; y++) {
    for (let x = 0; x < maskW; x++) {
      mask[y * maskW + x] = img[((y * step + step / 2) * cv.width + x * step + step / 2) * 4 + 3];
    }
  }
  return { texture, mask, maskW, maskH };
}

/** Top-cap texture for a faction base: base colour + white emblem. */
const baseCache = new Map<Color, THREE.CanvasTexture>();
export function getBaseTopTexture(color: Color): THREE.CanvasTexture {
  let t = baseCache.get(color);
  if (t) return t;
  const f = data.factions[color];
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S / 2);
  g.addColorStop(0, shade(f.base, 0.12));
  g.addColorStop(1, shade(f.base, -0.25));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // outer ring
  ctx.strokeStyle = color === 'w' ? '#9a8a60' : '#f1e6e0';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f7f3ea';
  ctx.strokeStyle = '#f7f3ea';
  if (f.baseEmblem === 'star') {
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 72, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 62 : 25;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = S / 2 + Math.cos(a) * r;
      const y = S / 2 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  } else {
    // Three tapered claw slashes.
    for (let i = -1; i <= 1; i++) {
      const ox = i * 34;
      ctx.beginPath();
      ctx.moveTo(S / 2 + ox - 30, S / 2 - 70);
      ctx.quadraticCurveTo(S / 2 + ox + 18, S / 2 - 10, S / 2 + ox + 26, S / 2 + 72);
      ctx.quadraticCurveTo(S / 2 + ox - 2, S / 2 - 6, S / 2 + ox - 30, S / 2 - 70);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 7;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  baseCache.set(color, t);
  return t;
}
