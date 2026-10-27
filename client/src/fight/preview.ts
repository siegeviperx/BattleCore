// Dev harness: play any capture matchup on an otherwise sparse board (not part of the app).
// ?a=wq&d=bk&mode=quick&auto=1 plays one fight on load. &stop=<sec> freezes the clock that many seconds into the
// fight, for repeatable headless screenshots.
import { audio, sfx, type CueName } from '../audio';
import { CUES, FILES } from '../audio/cues';
import type { BoardPiece, Color, FightMode, PieceType } from '../core/types';
import data from '../data/pieces.json';
import { createBoardView } from '../render';

const params = new URLSearchParams(location.search);
let fightStart: number | null = null;
const stopAt = params.get('stop');
if (stopAt) {
  const real = performance.now.bind(performance);
  performance.now = () => {
    const t = real();
    return fightStart === null ? t : Math.min(t, fightStart + +stopAt * 1000);
  };
}

const view = createBoardView(document.getElementById('app')!);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const aSel = $<HTMLSelectElement>('a');
const dSel = $<HTMLSelectElement>('d');
const modeSel = $<HTMLSelectElement>('mode');
const status = $<HTMLSpanElement>('status');

const TYPES: PieceType[] = ['p', 'n', 'b', 'r', 'q', 'k'];
for (const c of ['w', 'b'] as Color[]) {
  for (const t of TYPES) {
    const label = `${data.factions[c].short}: ${data.pieces[c][t].name}`;
    aSel.add(new Option(label, c + t));
    dSel.add(new Option(label, c + t));
  }
}

aSel.value = params.get('a') ?? 'wp';
dSel.value = params.get('d') ?? 'bp';
modeSel.value = params.get('mode') ?? 'full';

let busy = false;

/** Attacker on d4 hits the defender on e5, with a few bystanders around to check the arena clearing. */
async function fight(a: string, d: string): Promise<void> {
  if (busy) return;
  busy = true;
  const ac = a[0] as Color;
  const dc = (d[0] === a[0] ? (ac === 'w' ? 'b' : 'w') : d[0]) as Color;
  const pieces: BoardPiece[] = [
    { square: 'd4', color: ac, type: a[1] as PieceType },
    { square: 'e5', color: dc, type: d[1] as PieceType },
    { square: 'c3', color: 'w', type: 'p' },
    { square: 'f6', color: 'b', type: 'p' },
    { square: 'e4', color: 'w', type: 'n' },
    { square: 'd5', color: 'b', type: 'b' },
    { square: 'a1', color: 'w', type: 'k' },
    { square: 'h8', color: 'b', type: 'k' },
  ];
  view.setPosition(pieces);
  view.setViewSide(ac, false);
  view.setFightMode(modeSel.value as FightMode);
  status.textContent = `${data.pieces[ac][a[1] as PieceType].name} vs ${data.pieces[dc][d[1] as PieceType].name}`;
  await new Promise((r) => setTimeout(r, 400));
  const t0 = performance.now();
  fightStart = t0;
  await view.animateMove({
    from: 'd4',
    to: 'e5',
    color: ac,
    piece: a[1] as PieceType,
    captured: { square: 'e5', color: dc, type: d[1] as PieceType },
  });
  status.textContent += ` · ${((performance.now() - t0) / 1000).toFixed(1)} s`;
  busy = false;
}

$('go').addEventListener('click', () => void fight(aSel.value, dSel.value));
$('all').addEventListener('click', async () => {
  for (const c of ['w', 'b'] as Color[]) {
    for (const t of TYPES) {
      const foe = (c === 'w' ? 'b' : 'w') + TYPES[Math.floor(Math.random() * TYPES.length)];
      aSel.value = c + t;
      dSel.value = foe;
      await fight(c + t, foe);
      await new Promise((r) => setTimeout(r, 600));
    }
  }
});
// Sound board: every cue, grouped by where it plays, plus the music tracks.
const SOUND_GROUPS: [string, string][] = [
  ['UI', 'click'],
  ['Board', 'flutter'],
  ['Fights', 'pop'],
  ['Intro', 'stomp'],
];
const board = $<HTMLDivElement>('sfx');
const row = (title: string): HTMLDivElement => {
  const h = document.createElement('h4');
  h.textContent = title;
  const r = document.createElement('div');
  board.append(h, r);
  return r;
};
const addBtn = (r: HTMLElement, label: string, onClick: () => void): void => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  r.append(b);
};
const recLabel = document.createElement('label');
const recBox = document.createElement('input');
recBox.type = 'checkbox';
recBox.checked = audio.useFiles;
recBox.addEventListener('change', () => (audio.useFiles = recBox.checked));
recLabel.append(recBox, ' Use recordings (green = has a recording; untick to hear the synth version)');
board.append(recLabel);
const music = row('Music');
for (const [label, track] of [['Menu', 'menu'], ['Battle', 'battle'], ['Intro', 'intro'], ['Victory', 'victory'], ['Defeat', 'defeat']] as const) {
  addBtn(music, label, () => {
    audio.music(null, 0); // restart even if it's already playing (e.g. after flipping "Use recordings")
    audio.music(track);
  });
}
addBtn(music, 'Stop', () => audio.music(null));
let cueRow: HTMLElement = music;
for (const name of Object.keys(CUES) as CueName[]) {
  const group = SOUND_GROUPS.find(([, first]) => first === name);
  if (group) cueRow = row(group[0]);
  addBtn(cueRow, name, () => sfx(name));
  if (FILES[name]) cueRow.lastElementChild!.classList.add('rec');
}

// Pack browser: every sound in the downloaded Kenney packs (art-source/audio/packs, gitignored), searchable.
const packFiles = import.meta.glob('../../../art-source/audio/packs/**/*.ogg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const packs = $<HTMLDivElement>('packs');
const search = document.createElement('input');
search.placeholder = `Search ${Object.keys(packFiles).length} pack sounds (e.g. impact, laser, jingles_SAX)`;
const list = document.createElement('ul');
packs.append(search, list);
const entries = Object.entries(packFiles).map(([path, url]) => {
  const rel = path.split('/packs/')[1];
  const li = document.createElement('li');
  const b = document.createElement('button');
  const file = rel.split('/').pop()!;
  b.innerHTML = `${file} <small>${rel.split('/')[0]}</small>`;
  b.addEventListener('click', () => audio.playUrl(url));
  li.append(b);
  list.append(li);
  return { li, key: rel.toLowerCase() };
});
search.addEventListener('input', () => {
  const q = search.value.toLowerCase().trim();
  for (const e of entries) e.li.hidden = !!q && !e.key.includes(q);
});

if (params.get('auto')) void fight(aSel.value, dSel.value);

(window as unknown as { fight: typeof fight }).fight = fight;
