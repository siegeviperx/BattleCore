// Throwaway preview harness for the board renderer (not part of the app).
import type { BoardPiece, Color, MoveTarget, PieceType, Square } from '../core/types';
import { createBoardView } from './index';

const view = createBoardView(document.getElementById('app')!);
const board = new Map<Square, BoardPiece>();

function startPosition(): BoardPiece[] {
  const back: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  const out: BoardPiece[] = [];
  for (let f = 0; f < 8; f++) {
    const file = String.fromCharCode(97 + f);
    out.push({ square: file + '1', color: 'w', type: back[f] });
    out.push({ square: file + '2', color: 'w', type: 'p' });
    out.push({ square: file + '7', color: 'b', type: 'p' });
    out.push({ square: file + '8', color: 'b', type: back[f] });
  }
  return out;
}

function reset() {
  board.clear();
  for (const p of startPosition()) board.set(p.square, p);
  view.setPosition([...board.values()]);
  view.setSelection(null, []);
  view.setLastMove(null, null);
  view.setCheck(null);
}
reset();

let selected: Square | null = null;
let busy = false;
let side: Color = 'w';
let check = false;

function targetsFor(sq: Square): MoveTarget[] {
  const f0 = sq.charCodeAt(0) - 97;
  const r0 = +sq[1] - 1;
  const me = board.get(sq)!;
  const out: MoveTarget[] = [];
  for (let df = -2; df <= 2; df++)
    for (let dr = -2; dr <= 2; dr++) {
      if (!df && !dr) continue;
      if (df && dr && Math.abs(df) !== Math.abs(dr)) continue;
      const f = f0 + df;
      const r = r0 + dr;
      if (f < 0 || f > 7 || r < 0 || r > 7) continue;
      const s = String.fromCharCode(97 + f) + (r + 1);
      const occ = board.get(s);
      if (occ && occ.color === me.color) continue;
      out.push({ square: s, capture: !!occ });
    }
  return out;
}

view.onSquareClick(async (sq) => {
  if (busy) return;
  const p = board.get(sq);
  if (!selected || (p && p.color === board.get(selected)!.color)) {
    selected = p ? sq : null;
    view.setSelection(selected, selected ? targetsFor(selected) : []);
    return;
  }
  const from = selected;
  const mover = board.get(from)!;
  selected = null;
  view.setSelection(null, []);
  const captured = board.get(sq);
  let rookMove: { from: Square; to: Square } | undefined;
  const df = sq.charCodeAt(0) - from.charCodeAt(0);
  if (mover.type === 'k' && Math.abs(df) === 2 && from[1] === sq[1]) {
    const rank = from[1];
    rookMove = df > 0 ? { from: 'h' + rank, to: 'f' + rank } : { from: 'a' + rank, to: 'd' + rank };
  }
  const promotion = mover.type === 'p' && (sq[1] === '8' || sq[1] === '1') ? 'q' : undefined;
  busy = true;
  await view.animateMove({ from, to: sq, color: mover.color, piece: mover.type, captured, promotion, rookMove });
  busy = false;
  board.delete(from);
  board.set(sq, { square: sq, color: mover.color, type: promotion ?? mover.type });
  if (rookMove) {
    const rk = board.get(rookMove.from);
    if (rk) {
      board.delete(rookMove.from);
      board.set(rookMove.to, { ...rk, square: rookMove.to });
    }
  }
  view.setLastMove(from, sq);
});

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'v' || k === 'f') {
    side = side === 'w' ? 'b' : 'w';
    view.setViewSide(side, k === 'v');
  } else if (k === 'c') {
    check = !check;
    const king = [...board.values()].find((p) => p.type === 'k' && p.color === 'w');
    view.setCheck(check && king ? king.square : null);
  } else if (k === 'r') reset();
});

// Expose for automated poking from devtools.
(window as unknown as { view: typeof view }).view = view;

// ?demo=1 runs a scripted sequence (for headless screenshots); ?side=b views from black; ?stop=<sec> freezes time.
const params = new URLSearchParams(location.search);
if (params.get('side') === 'b') view.setViewSide('b', params.has('animside'));
if (params.get('demo')) {
  void (async () => {
    const mv = async (from: Square, to: Square) => {
      const m = board.get(from)!;
      const cap = board.get(to);
      await view.animateMove({ from, to, color: m.color, piece: m.type, captured: cap });
      board.delete(from);
      board.set(to, { ...m, square: to });
      view.setLastMove(from, to);
    };
    await mv('e2', 'e4');
    await mv('d7', 'd5');
    if (params.get('demo') === '2') {
      void mv('e4', 'd5');
      return;
    }
    await mv('e4', 'd5');
    view.setSelection('d1', targetsFor('d1').concat([{ square: 'd5', capture: false }, { square: 'd8', capture: true }]));
    view.setCheck('e8');
  })();
}
if (params.get('debug')) {
  let frames = 0;
  const f = () => { frames++; requestAnimationFrame(f); };
  requestAnimationFrame(f);
  setInterval(() => console.log('tick', performance.now().toFixed(0), 'frames', frames), 500);
}
