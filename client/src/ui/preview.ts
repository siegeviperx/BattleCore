// Throwaway demo page for the HUD. Not part of the game build.
import { createHud } from './index';
import type { PieceType } from '../core/types';

const root = document.getElementById('ui')!;
const logEl = document.getElementById('log')!;
const log = (msg: string): void => {
  logEl.textContent = msg;
  console.log('[preview]', msg);
};
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

document.getElementById('fake-board')!.addEventListener('click', () => log('board clicked (pointer passthrough OK)'));

const hud = createHud(root);
hud.onUndo(() => log('undo clicked'));
hud.onFlip(() => log('flip clicked'));
hud.onMenu(() => log('menu clicked'));

const params = new URLSearchParams(location.search);
const step = params.get('step');
if (params.has('freezeBanner')) {
  // Screenshot helper: pause the banner animation 40% of the way through.
  const st = document.createElement('style');
  st.textContent = '.bc-banner { animation-delay: -24s !important; animation-play-state: paused !important; }';
  document.head.append(st);
}
if (params.has('static')) {
  // Screenshot helper: freeze CSS animations at their end state.
  const st = document.createElement('style');
  st.textContent = '.bc-root *, .bc-root *::before { animation-duration: 0s !important; animation-delay: 0s !important; }';
  document.head.append(st);
}

const SAN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3', 'Nb8', 'd4', 'Nbd7', 'c4', 'c6', 'cxb5', 'axb5', 'Nc3', 'Bb7', 'Bg5', 'b4', 'Nb1', 'h6', 'Bh4', 'c5', 'dxe5', 'Nxe4', 'Bxe7+'];
const byWhite: PieceType[] = ['p', 'p', 'b', 'n'];
const byBlack: PieceType[] = ['p', 'n'];

function fillGame(): void {
  hud.setMoves(SAN);
  hud.setTurn('b');
  hud.setCaptured(byWhite, byBlack);
  hud.setUndoEnabled(true);
}

async function run(): Promise<void> {
  if (step === 'hud') {
    fillGame();
    return;
  }
  if (step === 'thinking') {
    fillGame();
    hud.setThinking(true);
    return;
  }
  if (step === 'banner') {
    fillGame();
    hud.showBanner(params.get('text') ?? 'Check!', (params.get('kind') as 'check') ?? 'check', 60000);
    return;
  }
  if (step === 'promo') {
    fillGame();
    const t = await hud.choosePromotion((params.get('color') as 'w' | 'b') ?? 'w');
    log(`promotion -> ${t}`);
    return;
  }
  if (step === 'gameover') {
    fillGame();
    const r = await hud.showGameOver('Checkmate!', 'Baby Army wins — the T-Rex is down for a nap.');
    log(`game over -> ${r}`);
    return;
  }

  if (params.get('mode') === 'local') {
    try {
      localStorage.setItem('battlecore.menu.v1', JSON.stringify({ mode: 'local', autoRotate: true }));
    } catch {
      /* ignore */
    }
  }
  // Full scripted run.
  const choice = await hud.showMenu();
  log(`menu -> ${JSON.stringify(choice)}`);
  hud.setUndoEnabled(false);
  for (let i = 1; i <= SAN.length; i++) {
    hud.setMoves(SAN.slice(0, i));
    hud.setTurn(i % 2 === 0 ? 'w' : 'b');
    hud.setThinking(i % 2 === 1);
    hud.setCaptured(byWhite.slice(0, Math.floor(i / 8)), byBlack.slice(0, Math.floor(i / 12)));
    hud.setUndoEnabled(i > 0);
    await wait(120);
  }
  hud.setThinking(false);
  hud.showBanner('Check!', 'check');
  await wait(1800);
  const promo = await hud.choosePromotion('w');
  log(`promotion -> ${promo}`);
  hud.showBanner('Checkmate!', 'mate');
  await wait(1500);
  const r = await hud.showGameOver('Victory!', 'Baby Army wins by checkmate.');
  log(`game over -> ${r}`);
  if (r === 'menu') void run();
}

void run();
