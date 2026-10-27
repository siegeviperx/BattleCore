// Throwaway demo page for the HUD. Not part of the game build.
import { createHud } from './index';
import type { PieceType } from '../core/types';
import type { Lobby, OpponentStatus } from './types';

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
hud.onResign(() => log('resign confirmed'));
hud.onOfferDraw(() => log('draw offered'));

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

/** Lobby flow: connecting -> code -> (opponent joins) close. Logs cancel. */
function trackLobby(lobby: Lobby, name: string): void {
  void lobby.cancelled.then(() => log(`${name} -> cancelled`));
}

const STATUSES: OpponentStatus[] = ['waiting', 'connected', 'disconnected', 'left'];

async function run(): Promise<void> {
  if (step === 'lobby-connecting') {
    trackLobby(hud.showLobby(null, null), 'lobby-connecting');
    return;
  }
  if (step === 'lobby') {
    const code = params.get('code') ?? 'K7QM2P';
    const side = (params.get('color') as 'w' | 'b') ?? 'w';
    trackLobby(hud.showLobby(code, side), 'lobby');
    return;
  }
  if (step === 'online') {
    fillGame();
    hud.setOnlineMode(true);
    const fixed = params.get('status') as OpponentStatus | null;
    if (fixed) {
      hud.setOpponentStatus(fixed, 'b');
      return;
    }
    for (let i = 0; ; i++) {
      hud.setOpponentStatus(STATUSES[i % STATUSES.length], 'b');
      await wait(2500);
    }
  }
  if (step === 'askdraw') {
    fillGame();
    hud.setOnlineMode(true);
    hud.setOpponentStatus('connected', 'b');
    const accept = await hud.askDraw();
    log(`askDraw -> ${accept}`);
    return;
  }
  if (step === 'message') {
    fillGame();
    const t0 = Date.now();
    await hud.showMessage(params.get('title') ?? 'Mission aborted', params.get('text') ?? 'Room not found. Check the code and try again.');
    log(`message -> closed after ${Date.now() - t0}ms`);
    return;
  }
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
  if (choice.mode === 'online') {
    // Simulated online handshake: connecting -> room code -> opponent joins.
    let cancelled = false;
    const watch = (l: Lobby): Lobby => {
      void l.cancelled.then(() => {
        cancelled = true;
        log('lobby -> cancelled');
      });
      return l;
    };
    let lobby = watch(hud.showLobby(null, null));
    await wait(1200);
    if (cancelled) return void run();
    const side = choice.online?.action === 'create' && choice.online.side !== 'random' ? choice.online.side : 'w';
    hud.setOnlineMode(true);
    hud.setOpponentStatus('waiting', side === 'w' ? 'b' : 'w');
    if (choice.online?.action === 'create') {
      lobby = watch(hud.showLobby('K7QM2P', side));
      await wait(Number(params.get('lobbyMs') ?? 4000));
      if (cancelled) {
        hud.setOnlineMode(false);
        return void run();
      }
    }
    lobby.close();
    lobby.close(); // idempotent
    hud.setOpponentStatus('connected', side === 'w' ? 'b' : 'w');
    hud.showBanner('You move first!', 'info');
  }
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
  hud.setOnlineMode(false);
  if (r === 'menu') void run();
}

void run();
