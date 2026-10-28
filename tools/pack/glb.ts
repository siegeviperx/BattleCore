// GLB helpers for the pack tool: shrink a raw Meshy model for the web, and read a model's stats without decoding
// it (the JSON chunk already says how many triangles it has and whether it is meshopt-compressed).
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

/**
 * Raw Meshy model (about 1M triangles) -> web model: about 25k triangles, 1024 WebP texture, meshopt-compressed.
 * Same settings as the Baby Army and Dinos (docs/TECHNICAL_REQUIREMENTS.md §7.1).
 */
export function optimize(raw: string, out: string): void {
  const tmp = `${out}.tmp.glb`;
  gltf(['optimize', raw, tmp, '--compress', 'false', '--simplify-ratio', '0.025', '--simplify-error', '0.002', '--texture-compress', 'webp', '--texture-size', '1024']);
  gltf(['meshopt', tmp, out]);
  rmSync(tmp, { force: true });
}

function gltf(args: string[]): void {
  // `npx` finds the gltf-transform version pinned in the root package.json.
  // One quoted command string: npx is a .cmd script on Windows, which needs a shell.
  const cmd = ['npx', 'gltf-transform', ...args.map((a) => `"${a.replace(/"/g, '\\"')}"`)].join(' ');
  const r = spawnSync(cmd, { stdio: ['ignore', 'ignore', 'pipe'], shell: true });
  if (r.status !== 0) throw new Error(`gltf-transform ${args[0]} failed:\n${r.stderr?.toString().trim()}`);
}

export interface GlbStats {
  bytes: number;
  triangles: number;
  compressed: boolean;
  animations: number;
}

export function glbStats(path: string): GlbStats {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    extensionsUsed?: string[];
    meshes?: { primitives: { indices?: number; attributes: { POSITION: number }; mode?: number }[] }[];
    accessors?: { count: number }[];
    animations?: unknown[];
  };
  let triangles = 0;
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives) {
      if (p.mode !== undefined && p.mode !== 4) continue; // only plain triangle lists count
      const acc = json.accessors?.[p.indices ?? p.attributes.POSITION];
      triangles += Math.floor((acc?.count ?? 0) / 3);
    }
  }
  return {
    bytes: buf.length,
    triangles,
    compressed: (json.extensionsUsed ?? []).includes('EXT_meshopt_compression'),
    animations: json.animations?.length ?? 0,
  };
}

/** Width and height of a PNG, from its header. */
export function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG file');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
