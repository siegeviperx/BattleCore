// Dev harness: play any capture matchup on an otherwise sparse board (not part of the app).
// ?a=wq&d=bk&mode=quick&auto=1 plays one fight on load. &stop=<sec> freezes the clock that many seconds into the
// fight, for repeatable headless screenshots.
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
if (params.get('auto')) void fight(aSel.value, dSel.value);

(window as unknown as { fight: typeof fight }).fight = fight;
