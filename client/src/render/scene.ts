import * as THREE from 'three';

/** Top of the war table (the board plinth stands on it). */
export const TABLE_Y = -0.32;

const SKY_TOP = new THREE.Color('#2e2f5c');
const SKY_MID = new THREE.Color('#c8604a');
const SKY_HORIZON = new THREE.Color('#ffb36b');
const FOG = new THREE.Color('#e9925e');

export interface SceneParts {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
}

export function createScene(): SceneParts {
  const scene = new THREE.Scene();
  scene.background = SKY_HORIZON.clone();
  scene.fog = new THREE.Fog(FOG, 13, 34);

  scene.add(createSky());

  const hemi = new THREE.HemisphereLight('#ffd9b0', '#3a2a22', 1.25);
  scene.add(hemi);

  // Warm, low sunset sun from the far left so both sides get a readable key light.
  const sun = new THREE.DirectionalLight('#ffbe85', 2.6);
  sun.position.set(-8, 10, -3.5);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -7.5;
  sc.right = 7.5;
  sc.top = 7.5;
  sc.bottom = -7.5;
  sc.near = 2;
  sc.far = 30;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // Soft cool fill from the camera side so the stickers never go muddy.
  const fill = new THREE.DirectionalLight('#9fb4ff', 0.35);
  fill.position.set(4, 6, 10);
  scene.add(fill);

  scene.add(createTable());
  scene.add(createProps());
  return { scene, sun };
}

function createSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(90, 32, 16);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / 90; // -1..1
    if (h < 0.02) c.copy(FOG);
    else if (h < 0.18) c.copy(SKY_HORIZON).lerp(SKY_MID, (h - 0.02) / 0.16);
    else c.copy(SKY_MID).lerp(SKY_TOP, Math.min(1, (h - 0.18) / 0.5));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -10;
  return sky;
}

function woodTexture(base: string, dark: string, size = 1024, planks = 6): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const plankH = size / planks;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let p = 0; p < planks; p++) {
    const y0 = p * plankH;
    // per-plank tone shift
    ctx.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,220,180'},${0.04 + rnd() * 0.08})`;
    ctx.fillRect(0, y0, size, plankH);
    // grain lines
    for (let g = 0; g < 26; g++) {
      ctx.strokeStyle = dark;
      ctx.globalAlpha = 0.08 + rnd() * 0.18;
      ctx.lineWidth = 1 + rnd() * 2.5;
      ctx.beginPath();
      const yy = y0 + rnd() * plankH;
      ctx.moveTo(0, yy);
      for (let x = 0; x <= size; x += 32) {
        ctx.lineTo(x, yy + Math.sin(x * 0.01 + g) * 3 + (rnd() - 0.5) * 2);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // plank seam
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, y0, size, 3);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export { woodTexture };

function createTable(): THREE.Mesh {
  const tex = woodTexture('#3a2618', '#140a05');
  tex.repeat.set(5, 5);
  const geo = new THREE.BoxGeometry(44, 1, 30);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.05 });
  const table = new THREE.Mesh(geo, mat);
  table.position.y = TABLE_Y - 0.5;
  table.receiveShadow = true;
  return table;
}

function createProps(): THREE.Group {
  const g = new THREE.Group();
  const brass = new THREE.MeshStandardMaterial({ color: '#c9973f', metalness: 1, roughness: 0.32 });
  const copper = new THREE.MeshStandardMaterial({ color: '#b5653a', metalness: 1, roughness: 0.35 });
  const caseGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.5, 20);
  const tipGeo = new THREE.CylinderGeometry(0.01, 0.07, 0.18, 20);
  const shell = (x: number, z: number, rot: number, withTip: boolean) => {
    const s = new THREE.Group();
    const body = new THREE.Mesh(caseGeo, brass);
    body.castShadow = true;
    s.add(body);
    if (withTip) {
      const tip = new THREE.Mesh(tipGeo, copper);
      tip.position.y = 0.34;
      tip.castShadow = true;
      s.add(tip);
    }
    s.rotation.set(0, rot, Math.PI / 2);
    s.position.set(x, TABLE_Y + 0.075, z);
    g.add(s);
  };
  shell(5.7, 3.1, 0.4, true);
  shell(6.2, 2.3, 1.9, false);
  shell(-5.9, -2.6, -0.7, false);
  shell(-6.3, 1.8, 2.6, true);

  // A folded map on the table.
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 340;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#d8c9a3';
  ctx.fillRect(0, 0, 512, 340);
  ctx.strokeStyle = 'rgba(80,60,30,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 30 + i * 36);
    ctx.bezierCurveTo(150, 10 + i * 40, 330, 60 + i * 30, 512, 20 + i * 38);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(160,40,30,0.7)';
  ctx.lineWidth = 4;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(60, 280);
  ctx.bezierCurveTo(200, 200, 260, 220, 420, 90);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(254, 0, 4, 340);
  const mapTex = new THREE.CanvasTexture(cv);
  mapTex.colorSpace = THREE.SRGBColorSpace;
  const map = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 2.25),
    new THREE.MeshStandardMaterial({ map: mapTex, roughness: 0.9 }),
  );
  map.rotation.set(-Math.PI / 2, 0, 0.35);
  map.position.set(-6.6, TABLE_Y + 0.005, 4.2);
  map.receiveShadow = true;
  g.add(map);

  // Ammo crate on the far side.
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.9, 1),
    new THREE.MeshStandardMaterial({ color: '#4f5530', roughness: 0.8 }),
  );
  crate.position.set(6.4, TABLE_Y + 0.45, -4.6);
  crate.rotation.y = -0.3;
  crate.castShadow = true;
  crate.receiveShadow = true;
  g.add(crate);
  return g;
}
