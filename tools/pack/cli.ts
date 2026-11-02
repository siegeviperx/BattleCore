// BattleCore pack tool. Runs on a developer's machine (never in the game): makes and checks piece packs in
// client/src/packs/<id>/. Run from the repo root:
//
//   npm run pack:new -- dragons --name "Dragon Clans" --short Dragons
//   npm run pack:piece -- dragons k --prompt "an elder dragon king in a gold crown"
//   npm run pack:preview -- dragons
//   npm run pack:check            (every pack; CI runs this too)
//   npm run pack:balance
//
// The step-by-step guide is docs/PACKS.md.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { PIECE_TYPES, loadPack, parseSlot, type PackFile } from '../../client/src/packs/validate.ts';
import { ATTACK_KINDS, KNOCKOUT_KINDS } from '../../client/src/fight/move-kinds.ts';
import { glbStats, optimize, pngSize } from './glb.ts';
import * as meshy from './meshy.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const PACKS = join(ROOT, 'client', 'src', 'packs');
const SOURCES = join(ROOT, 'art-source', 'packs');
const DEV_PORT = 5174;

/** Budgets a shipped look should stay within (docs/PLATFORM.md §9). */
const MAX_MODEL_BYTES = 1_200_000;
const MAX_TRIANGLES = 60_000;
const STICKER = { width: 512, height: 640 };

try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch {
  /* no .env: fine until a command needs the Meshy key */
}

const ROLE = { k: 'King', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn' } as const;

/** Starter fight moves for a new pack; change them in pack.json. */
const STARTER: Record<keyof typeof ROLE, { attack: Record<string, unknown> & { kind: string }; knockout: { kind: string } }> = {
  k: { attack: { kind: 'volley', count: 4, projectile: 'missile', color: '#c2312a', arc: 0.9 }, knockout: { kind: 'topple' } },
  q: { attack: { kind: 'breath' }, knockout: { kind: 'spinout' } },
  r: { attack: { kind: 'volley', count: 1, projectile: 'boulder', color: '#6b6460', arc: 1.3 }, knockout: { kind: 'topple' } },
  b: { attack: { kind: 'snipe' }, knockout: { kind: 'spinout' } },
  n: { attack: { kind: 'dive' }, knockout: { kind: 'launch' } },
  p: { attack: { kind: 'burst', shots: 3, projectile: 'dart', color: '#ff7a1a' }, knockout: { kind: 'pratfall' } },
};
// ---------------------------------------------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);
const commands: Record<string, (args: string[]) => Promise<void> | void> = { new: cmdNew, piece: cmdPiece, check: cmdCheck, preview: cmdPreview, balance: cmdBalance, help };

try {
  await (commands[command ?? 'help'] ?? unknown)(rest);
} catch (err) {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

function unknown(): void {
  help();
  process.exit(1);
}

function help(): void {
  console.log(`BattleCore pack tool (guide: docs/PACKS.md)

  npm run pack:new -- <id> --name "Army Name" --short Short [--primary #rrggbb --secondary #rrggbb --base #rrggbb --emblem star]
      Start a new pack in client/src/packs/<id>/ (and art-source/packs/<id>/ for prompts and raw files).

  npm run pack:piece -- <id> <slot> --prompt "what this piece looks like" [options]
      Make one piece: sticker art + 3D model with Meshy, shrunk for the web, wired into pack.json.
      Slots: k q r b n p (p2 p3 ... for extra pawn looks). Shows the credit cost and asks first.
      --image <file.png>   use your own art (transparent PNG) instead of generating it (no art credits)
      --model <file.glb>   use your own full-size 3D model instead of generating it (no model credits)
      --ref <file.png>     extra style reference image (repeatable; art-source/packs/<id>/concept/* are always used)
      --art-only           only make the sticker        --model-only   only make the 3D model from existing art
      --fresh              ignore earlier Meshy tasks for this slot and pay for new ones
      --yes                don't ask before spending credits

  npm run pack:preview -- <id> [--vs dinos] [--side w|b]
      Open the fight preview with this pack in a local dev server.

  npm run pack:check [-- <id>]
      Check one pack or all of them: required fields, files, sizes, compression.

  npm run pack:balance
      Show your Meshy credit balance (free).`);
}

// --- new -------------------------------------------------------------------------------------------------------

function cmdNew(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      short: { type: 'string' },
      primary: { type: 'string', default: '#1f6b63' },
      secondary: { type: 'string', default: '#d9a93a' },
      base: { type: 'string', default: '#203a3a' },
      emblem: { type: 'string', default: 'star' },
    },
  });
  const id = positionals[0];
  if (!id || !/^[a-z][a-z0-9-]{1,30}$/.test(id)) throw new Error('Give a pack id: lowercase letters, digits and dashes, e.g. "dragons".');
  const dir = join(PACKS, id);
  if (existsSync(dir)) throw new Error(`client/src/packs/${id} already exists.`);
  const name = values.name ?? `${id[0].toUpperCase()}${id.slice(1)}`;
  const short = values.short ?? name.split(' ')[0];
  const pack: PackFile = {
    id,
    version: 1,
    name,
    short,
    colors: { primary: values.primary!, secondary: values.secondary!, base: values.base!, emblem: values.emblem! },
    credits: [{ role: '3D models & art', name: 'Meshy AI' }],
    pieces: Object.fromEntries(
      PIECE_TYPES.map((t) => [t, { name: `${short} ${ROLE[t]}`, icon: '❔', ...STARTER[t], looks: [{}] }]),
    ) as PackFile['pieces'],
  };
  mkdirSync(join(dir, 'pieces'), { recursive: true });
  mkdirSync(join(dir, 'models'), { recursive: true });
  writePack(id, pack);
  const src = join(SOURCES, id);
  mkdirSync(join(src, 'concept'), { recursive: true });
  writeFileSync(join(src, 'concept', 'README.md'), 'Put 1-5 style reference images here (png/jpg/webp). Every piece\'s art is generated in their style.\n');
  writeFileSync(
    join(src, 'style.md'),
    `Collectible cartoon toy figurine, full body, standing, facing the viewer, plain white background, bright
saturated colors, soft studio lighting, chunky toy proportions. Part of the "${name}" army in a toy war game.
Fierce but cute, slapstick rather than scary, no blood or gore. If a character holds a weapon it is clearly a toy.
`,
  );
  writeFileSync(join(src, 'meshy-tasks.json'), '{}\n');
  console.log(`✔ Created client/src/packs/${id}/pack.json and art-source/packs/${id}/

Next:
  1. Edit art-source/packs/${id}/style.md (the look every piece shares) and add reference art to concept/.
  2. Fill in names, icons and fight moves in client/src/packs/${id}/pack.json.
  3. Make a piece:  npm run pack:piece -- ${id} k --prompt "…"`);
}

// --- piece -----------------------------------------------------------------------------------------------------

interface SlotTasks {
  art?: { kind: meshy.TaskKind; id: string };
  model?: string;
}

async function cmdPiece(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      prompt: { type: 'string' },
      image: { type: 'string' },
      model: { type: 'string' },
      ref: { type: 'string', multiple: true, default: [] },
      'art-only': { type: 'boolean', default: false },
      'model-only': { type: 'boolean', default: false },
      fresh: { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
    },
  });
  const [id, slot] = positionals;
  const pack = readPack(id);
  const where = slot ? parseSlot(slot) : null;
  if (!where) throw new Error('Give a slot: k q r b n p, or p2 p3 ... for extra looks.');
  const src = join(SOURCES, id);
  const rawArt = join(src, 'pieces', `${slot}.png`);
  const rawModel = join(src, 'raw', `${slot}.glb`);
  const tasksFile = join(src, 'meshy-tasks.json');
  const tasks = (existsSync(tasksFile) ? JSON.parse(readFileSync(tasksFile, 'utf8')) : {}) as Record<string, SlotTasks>;
  const mine: SlotTasks = values.fresh ? {} : { ...tasks[slot] };
  const saveTasks = (): void => {
    tasks[slot] = mine;
    mkdirSync(src, { recursive: true });
    writeFileSync(tasksFile, `${JSON.stringify(tasks, null, 2)}\n`);
  };

  const wantArt = !values['model-only'];
  const wantModel = !values['art-only'];
  const ownImage = values.image ? resolve(values.image) : null;
  if (ownImage && !existsSync(ownImage)) throw new Error(`No such image: ${values.image}`);
  const ownModel = values.model ? resolve(values.model) : null;
  if (ownModel && !existsSync(ownModel)) throw new Error(`No such model: ${values.model}`);
  if (values['model-only'] && !existsSync(rawArt) && !mine.art) throw new Error(`No art for ${slot} yet; make it first (drop --model-only).`);

  // What will run, and what it costs. Earlier tasks for this slot are reused, never paid for twice.
  const newArt = wantArt && !ownImage && !mine.art;
  if (newArt && !values.prompt) throw new Error('Describe the piece with --prompt "…" (or bring your own art with --image file.png).');
  // Art that differs from what this slot already has means the old 3D model no longer matches it.
  const artChanged = newArt || (ownImage !== null && ownImage !== resolve(rawArt));
  const newModel = wantModel && !ownModel && (!mine.model || artChanged);
  const cost = (newArt ? meshy.COST.art : 0) + (newModel ? meshy.COST.model : 0);
  const label = `${pack.pieces[where.type]?.name ?? ROLE[where.type]}${where.look ? ` (look ${where.look + 1})` : ''}`;
  console.log(`\n${label}, slot "${slot}":`);
  if (wantArt) console.log(ownImage ? `  • sticker art from ${relative(ROOT, ownImage)} (free)` : newArt ? `  • sticker art with ${meshy.ART_MODEL} (${meshy.COST.art} credits)` : '  • sticker art: reuse earlier Meshy task (free)');
  if (wantModel) {
    console.log(ownModel ? `  • 3D model from ${relative(ROOT, ownModel)} (free)` : newModel ? `  • 3D model with ${meshy.MESH_MODEL}, textured (${meshy.COST.model} credits)` : '  • 3D model: reuse earlier Meshy task (free)');
  }
  if (cost > 0) {
    const bal = await meshy.balance();
    console.log(`  Total: ${cost} credits. Your balance: ${bal}.`);
    if (bal < cost) throw new Error('Not enough Meshy credits.');
    if (!values.yes && !(await confirm(`Spend ${cost} credits?`))) {
      console.log('Nothing spent.');
      return;
    }
  }

  // 1. Sticker art
  if (wantArt) {
    mkdirSync(dirname(rawArt), { recursive: true });
    if (ownImage) {
      if (ownImage !== resolve(rawArt)) {
        copyFileSync(ownImage, rawArt);
        delete mine.art; // new art: a model must now come from this image, not the old Meshy picture
      }
    } else {
      if (!mine.art) {
        const refs = referenceImages(id, values.ref ?? []);
        mine.art = await meshy.createArt(composePrompt(id, values.prompt!), refs);
        delete mine.model;
        saveTasks(); // recorded before waiting, so a crash or Ctrl+C never pays twice
        console.log(`  art task ${mine.art.id} (${refs.length ? `${refs.length} style reference${refs.length > 1 ? 's' : ''}` : 'no style references'})`);
      }
      const task = await meshy.waitTask(mine.art.kind, mine.art.id, progress('art'));
      writeFileSync(rawArt, await meshy.download(task.image_urls![0]));
      done('art');
    }
    buildSticker(id, slot);
  }

  // 2. 3D model
  if (wantModel) {
    mkdirSync(dirname(rawModel), { recursive: true });
    if (ownModel) {
      if (ownModel !== resolve(rawModel)) copyFileSync(ownModel, rawModel);
    } else {
      if (newModel || !mine.model) {
        mine.model = await meshy.createModel(mine.art ? { artTaskId: mine.art.id } : { image: dataUri(rawArt) });
        saveTasks();
        console.log(`  model task ${mine.model}`);
      }
      const task = await meshy.waitTask('image-to-3d', mine.model, progress('3D model'));
      writeFileSync(rawModel, await meshy.download(task.model_urls!.glb!));
      done('3D model');
    }
    process.stdout.write('  shrinking for the web…');
    const out = join(PACKS, id, 'models', `${slot}.glb`);
    optimize(rawModel, out);
    const s = glbStats(out);
    console.log(` ${Math.round(s.bytes / 1024)} KB, ${s.triangles.toLocaleString()} triangles`);
  }
  saveTasks();

  // 3. Wire the files into pack.json
  const fresh = readPack(id);
  const looks = fresh.pieces[where.type].looks;
  while (looks.length <= where.look) looks.push({});
  if (existsSync(join(PACKS, id, 'pieces', `${slot}.png`))) looks[where.look].art = `pieces/${slot}.png`;
  if (existsSync(join(PACKS, id, 'models', `${slot}.glb`))) looks[where.look].model = `models/${slot}.glb`;
  writePack(id, fresh);
  console.log(`\n✔ ${label} is in client/src/packs/${id}/. See it fight:  npm run pack:preview -- ${id}`);
}

function composePrompt(id: string, prompt: string): string {
  const stylePath = join(SOURCES, id, 'style.md');
  const style = existsSync(stylePath) ? readFileSync(stylePath, 'utf8').trim() : '';
  return style ? `${style}\n\nThis piece: ${prompt}` : prompt;
}

function referenceImages(id: string, extra: string[]): string[] {
  const dir = join(SOURCES, id, 'concept');
  const found = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).map((f) => join(dir, f)) : [];
  const all = [...found, ...extra.map((f) => resolve(f))];
  if (all.length > 5) console.log(`  (Meshy takes 5 reference images at most; using the first 5 of ${all.length})`);
  return all.slice(0, 5).map(dataUri);
}

function dataUri(file: string): string {
  if (!existsSync(file)) throw new Error(`No such image: ${relative(ROOT, file)}`);
  if (statSync(file).size > 20_000_000) throw new Error(`${relative(ROOT, file)} is over Meshy's 20 MB limit.`);
  const ext = extname(file).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mime};base64,${readFileSync(file).toString('base64')}`;
}

function buildSticker(id: string, slot: string): void {
  for (const python of ['python', 'python3', 'py']) {
    const r = spawnSync(python, [join(ROOT, 'art-source', 'build_stickers.py'), '--pack', id, slot], { encoding: 'utf8' });
    if (r.error || r.status === 9009) continue; // not installed under this name: try the next
    if (r.status !== 0) throw new Error(`Sticker build failed:\n${(r.stderr ?? '').trim()}\n(It needs Python with Pillow: pip install pillow)`);
    done('sticker');
    return;
  }
  throw new Error('Python was not found. Install Python 3 and run: pip install pillow');
}

function progress(what: string): (pct: number) => void {
  let last = -1;
  return (pct) => {
    if (pct === last) return;
    last = pct;
    process.stdout.write(`\r  ${what}: ${pct}%   `);
  };
}

function done(what: string): void {
  process.stdout.write(`\r  ${what}: done        \n`);
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

// --- check -----------------------------------------------------------------------------------------------------

function cmdCheck(args: string[]): void {
  const ids = args.length ? args : readdirSync(PACKS).filter((d) => existsSync(join(PACKS, d, 'pack.json')));
  let errors = 0;
  for (const id of ids) {
    const problems: string[] = [];
    const warnings: string[] = [];
    const dir = join(PACKS, id);
    let file: PackFile;
    try {
      file = readPack(id);
    } catch (err) {
      console.log(`✖ ${id}: ${(err as Error).message}`);
      errors++;
      continue;
    }
    // Every file in the pack folder, keyed the way the game's loader sees it.
    const files = ['pieces', 'models'].flatMap((sub) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).map((f) => `${sub}/${f}`) : []));
    const urls = Object.fromEntries(files.map((f) => [`./${id}/${f}`, f]));
    try {
      loadPack(id, file, urls);
    } catch (err) {
      problems.push((err as Error).message.replace(`Pack "${id}": `, ''));
    }
    const used = new Set<string>();
    const rows: string[] = [];
    for (const t of PIECE_TYPES) {
      (file.pieces?.[t]?.looks ?? []).forEach((look, i) => {
        const slot = i ? `${t}${i + 1}` : t;
        const cells = [`${slot.padEnd(3)} ${file.pieces[t].name ?? '?'}`];
        if (look.art) {
          used.add(look.art);
          if (existsSync(join(dir, look.art))) {
            const { width, height } = pngSize(join(dir, look.art));
            if (width !== STICKER.width || height !== STICKER.height) warnings.push(`${look.art} is ${width}×${height}; stickers should be ${STICKER.width}×${STICKER.height} (run it through build_stickers.py)`);
            cells.push('art ✓');
          }
        } else {
          cells.push('art –');
          warnings.push(`${slot} has no sticker art (a drawn placeholder stands in)`);
        }
        if (look.model) {
          used.add(look.model);
          const path = join(dir, look.model);
          if (existsSync(path)) {
            const s = glbStats(path);
            cells.push(`model ✓ ${Math.round(s.bytes / 1024)} KB, ${s.triangles.toLocaleString()} tris`);
            if (!s.compressed) problems.push(`${look.model} is not meshopt-compressed; the game can't load it as shipped (re-run pack:piece, or gltf-transform meshopt)`);
            if (s.bytes > MAX_MODEL_BYTES) warnings.push(`${look.model} is ${Math.round(s.bytes / 1024)} KB (budget ${MAX_MODEL_BYTES / 1000} KB)`);
            if (s.triangles > MAX_TRIANGLES) warnings.push(`${look.model} has ${s.triangles.toLocaleString()} triangles (budget ${MAX_TRIANGLES.toLocaleString()})`);
          }
        } else {
          cells.push('model –');
          warnings.push(`${slot} has no 3D model (the procedural toy fights instead)`);
        }
        rows.push(cells.join('  '));
      });
    }
    for (const f of files) if (!used.has(f)) warnings.push(`${f} isn't used by pack.json`);
    console.log(`${problems.length ? '✖' : '✔'} ${id}: ${file.name}`);
    for (const r of rows) console.log(`    ${r}`);
    for (const p of problems) console.log(`  ✖ ${p}`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
    errors += problems.length;
  }
  console.log(`\nFight moves you can use. Attacks: ${ATTACK_KINDS.join(', ')}. Knockouts: ${KNOCKOUT_KINDS.join(', ')}.`);
  if (errors) {
    console.log(`\n${errors} problem${errors > 1 ? 's' : ''} to fix.`);
    process.exit(1);
  }
}

// --- preview ---------------------------------------------------------------------------------------------------

async function cmdPreview(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { vs: { type: 'string', default: 'dinos' }, side: { type: 'string', default: 'w' } },
  });
  const id = positionals[0];
  readPack(id);
  readPack(values.vs!);
  const [white, black] = values.side === 'b' ? [values.vs, id] : [id, values.vs];
  const url = `http://localhost:${DEV_PORT}/src/fight/preview.html?white=${white}&black=${black}`;
  if (!(await serverUp())) {
    console.log('Starting the dev server (Ctrl+C to stop)…');
    spawn(`npx --prefix client vite client --port ${DEV_PORT} --strictPort`, { cwd: ROOT, stdio: 'inherit', shell: true });
    for (let i = 0; i < 60 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`\nFight preview: ${url}\nThe whole game with this pack: http://localhost:${DEV_PORT}/?intro=0&white=${white}&black=${black}`);
  const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(`${opener} "${url}"`, { shell: true, stdio: 'ignore' });
}

async function serverUp(): Promise<boolean> {
  try {
    return (await fetch(`http://localhost:${DEV_PORT}/`)).ok;
  } catch {
    return false;
  }
}

// --- balance ---------------------------------------------------------------------------------------------------

async function cmdBalance(): Promise<void> {
  console.log(`Meshy balance: ${await meshy.balance()} credits`);
}

// --- pack.json -------------------------------------------------------------------------------------------------

function readPack(id: string | undefined): PackFile {
  if (!id) throw new Error('Give a pack id, e.g. "dragons".');
  const path = join(PACKS, id, 'pack.json');
  if (!existsSync(path)) throw new Error(`No pack "${id}" (client/src/packs/${id}/pack.json). Start one with: npm run pack:new -- ${id}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackFile;
  } catch (err) {
    throw new Error(`client/src/packs/${id}/pack.json is not valid JSON: ${(err as Error).message}`);
  }
}

function writePack(id: string, pack: PackFile): void {
  writeFileSync(join(PACKS, id, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
}
