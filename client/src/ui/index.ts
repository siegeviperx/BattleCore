import './hud.css';
import { NAME_MAX_LENGTH, cleanName } from '../../../shared/protocol';
import { audio, type SoundMode } from '../audio';
import data from '../data/pieces.json';
import type { Color, FightMode, Level, PieceType } from '../core/types';
import type { BannerKind, Hud, IntroMode, Lobby, MenuChoice, OnlineRequest, OpponentStatus, ScreenInsets } from './types';

export type { Hud, MenuChoice, BannerKind, IntroMode, Lobby, OnlineRequest, OpponentStatus, ScreenInsets } from './types';

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

interface FactionInfo {
  name: string;
  short: string;
  primary: string;
  secondary: string;
}

const FACTIONS = data.factions as Record<Color, FactionInfo>;
const PIECES = data.pieces as Record<Color, Record<PieceType, { name: string; icon: string }>>;
const GLYPHS = data.glyphs as Record<PieceType, string>;

const VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const LEVELS: { id: Level; label: string; hint: string }[] = [
  { id: 'easy', label: 'Easy', hint: 'Recruit' },
  { id: 'medium', label: 'Medium', hint: 'Soldier' },
  { id: 'hard', label: 'Hard', hint: 'Veteran' },
  { id: 'max', label: 'Max', hint: 'General' },
];
const FIGHT_MODES: { id: FightMode; label: string; hint: string }[] = [
  { id: 'full', label: 'Full', hint: 'Every capture' },
  { id: 'quick', label: 'Quick', hint: 'Short & sharp' },
  { id: 'off', label: 'Off', hint: 'Just poof' },
];
const INTRO_MODES: { id: IntroMode; label: string; hint: string }[] = [
  { id: 'always', label: 'Always', hint: 'Every launch' },
  { id: 'first', label: 'First time', hint: 'Just once' },
  { id: 'never', label: 'Never', hint: 'Straight in' },
];
const SOUND_MODES: { id: SoundMode; label: string; hint: string }[] = [
  { id: 'all', label: 'On', hint: 'Music + effects' },
  { id: 'sfx', label: 'Effects', hint: 'No music' },
  { id: 'off', label: 'Off', hint: 'Silence' },
];
const PROMO_ORDER: PieceType[] = ['q', 'r', 'b', 'n'];
const PROMO_KEYS: Record<string, PieceType> = { q: 'q', r: 'r', b: 'b', n: 'n' };
const STORAGE_KEY = 'battlecore.menu.v1';
/** Room code alphabet (no 0/O, 1/I/L to avoid mix-ups). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;
const sanitizeCode = (raw: string): string =>
  [...raw.toUpperCase()].filter((ch) => CODE_ALPHABET.includes(ch)).join('').slice(0, CODE_LEN);
const DRAW_COOLDOWN_MS = 10_000;
const RESIGN_CONFIRM_MS = 3_000;

/** Readable light label colour per faction (dino secondary gunmetal is too dark for text). */
const LABEL: Record<Color, string> = { w: '#d6c48f', b: '#f0a197' };
const facVars = (c: Color): string =>
  `--fac:${FACTIONS[c].primary};--fac2:${FACTIONS[c].secondary};--facl:${LABEL[c]}`;

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

type Attrs = Record<string, string | boolean | undefined>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  attrs?: Attrs,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === false) continue;
      node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children) node.append(c);
  return node;
}

function button(cls: string, label: string | Node[], onClick?: () => void, attrs?: Attrs): HTMLButtonElement {
  const b = el('button', cls, { type: 'button', ...attrs });
  if (typeof label === 'string') b.textContent = label;
  else b.append(...label);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_PATHS: Record<'undo' | 'flip' | 'menu' | 'chev' | 'flag' | 'handshake' | 'copy' | 'link' | 'sound' | 'mute', string> = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  flip: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  menu: 'M4 6h16M4 12h16M4 18h16',
  chev: 'M6 15l6-6 6 6',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  handshake:
    'M11 17l2 2a1 1 0 1 0 3-3M14 14l2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4M21 3l1 11h-2M3 3 2 14l6.47 6.47a1 1 0 1 0 3-3M3 4h8',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  sound: 'M11 5 6 9H2v6h4l5 4zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14',
  mute: 'M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
};

function icon(name: keyof typeof ICON_PATHS): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'bc-icon');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  svg.append(path);
  return svg;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

type OnlineSide = Color | 'random';

interface Saved {
  mode: 'ai' | 'local' | 'online';
  humanColor: Color;
  level: Level;
  autoRotate: boolean;
  fights: FightMode;
  onlineAction: 'create' | 'join';
  onlineSide: OnlineSide;
  playerName: string;
  intro: IntroMode;
}

const DEFAULTS: Saved = {
  mode: 'ai',
  humanColor: 'w',
  level: 'medium',
  autoRotate: true,
  fights: 'full',
  onlineAction: 'create',
  onlineSide: 'random',
  playerName: '',
  intro: 'first',
};

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Saved>;
    return {
      mode: p.mode === 'local' || p.mode === 'online' ? p.mode : 'ai',
      humanColor: p.humanColor === 'b' ? 'b' : 'w',
      level: LEVELS.some((l) => l.id === p.level) ? (p.level as Level) : DEFAULTS.level,
      autoRotate: typeof p.autoRotate === 'boolean' ? p.autoRotate : DEFAULTS.autoRotate,
      fights: FIGHT_MODES.some((f) => f.id === p.fights) ? (p.fights as FightMode) : DEFAULTS.fights,
      onlineAction: p.onlineAction === 'join' ? 'join' : 'create',
      onlineSide: p.onlineSide === 'w' || p.onlineSide === 'b' ? p.onlineSide : 'random',
      playerName: typeof p.playerName === 'string' ? cleanName(p.playerName) : '',
      intro: INTRO_MODES.some((m) => m.id === p.intro) ? (p.intro as IntroMode) : DEFAULTS.intro,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Room code from `?room=XXXXXX` in the page URL, if valid. */
function roomFromUrl(): string | null {
  try {
    const raw = new URLSearchParams(location.search).get('room');
    if (!raw) return null;
    const code = sanitizeCode(raw.replace(/\s+/g, ''));
    return code.length === CODE_LEN ? code : null;
  } catch {
    return null;
  }
}

/** Copy text to the clipboard; resolves true on success. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    const prev = document.activeElement as HTMLElement | null;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    prev?.focus({ preventScroll: true });
    return ok;
  } catch {
    return false;
  }
}

function save(s: Saved): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: ignore */
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

export function createHud(root: HTMLElement): Hud {
  root.classList.add('bc-root');

  const undoCbs: (() => void)[] = [];
  const flipCbs: (() => void)[] = [];
  const menuCbs: (() => void)[] = [];
  const resignCbs: (() => void)[] = [];
  const drawCbs: (() => void)[] = [];

  // ----- Turn pill -----
  const turnText = el('span', 'bc-turn__text');
  const turnDots = el('span', 'bc-dots', { 'aria-hidden': 'true' }, el('i'), el('i'), el('i'));
  const thinkingLabel = el('span', 'bc-turn__thinking', undefined, 'thinking', turnDots);
  const turnPill = el('div', 'bc-turn', { role: 'status', 'aria-live': 'polite' }, turnText, thinkingLabel);

  // ----- Opponent status chip (online only) -----
  const oppIcon = el('span', 'bc-opp__icon', { 'aria-hidden': 'true' });
  const oppName = el('span', 'bc-opp__name');
  const oppText = el('span', 'bc-opp__text');
  const oppChip = el(
    'div',
    'bc-opp',
    { role: 'status', 'aria-live': 'polite', 'data-status': 'waiting', hidden: true },
    el('span', 'bc-opp__dot', { 'aria-hidden': 'true' }),
    oppIcon,
    el('span', 'bc-opp__label', undefined, oppName, oppText),
  );
  const topBar = el('div', 'bc-top', undefined, turnPill, oppChip);

  // ----- Speaker (quick mute) -----
  const muteBtn = button('bc-mute', [], () => audio.setMuted(!audio.muted));
  const syncMute = (): void => {
    const label = audio.muted ? 'Unmute sound' : 'Mute sound';
    muteBtn.replaceChildren(icon(audio.muted ? 'mute' : 'sound'));
    muteBtn.title = label;
    muteBtn.setAttribute('aria-label', label);
    muteBtn.setAttribute('aria-pressed', String(audio.muted));
  };
  syncMute();
  audio.onChange(syncMute);

  // ----- Side panel -----
  const trays: Record<Color, { list: HTMLElement; adv: HTMLElement }> = {
    w: { list: el('div', 'bc-tray__list'), adv: el('span', 'bc-tray__adv') },
    b: { list: el('div', 'bc-tray__list'), adv: el('span', 'bc-tray__adv') },
  };
  const makeTray = (c: Color): HTMLElement =>
    el(
      'div',
      `bc-tray bc-tray--${c}`,
      { style: facVars(c) },
      el('div', 'bc-tray__head', undefined, el('span', 'bc-tray__name', undefined, FACTIONS[c].short), trays[c].adv),
      trays[c].list,
    );

  const movesList = el('ol', 'bc-moves__list', { 'aria-label': 'Move list' });
  const movesEmpty = el('p', 'bc-moves__empty', undefined, 'No moves yet. Hold the line!');
  const movesBox = el('div', 'bc-moves', undefined, movesEmpty, movesList);

  const toolLabel = (text: string): HTMLSpanElement => el('span', 'bc-tool__label', undefined, text);
  const undoBtn = button('bc-tool', [icon('undo'), toolLabel('Undo')], () => undoCbs.forEach((cb) => cb()));
  const flipBtn = button('bc-tool', [icon('flip'), toolLabel('Flip view')], () => flipCbs.forEach((cb) => cb()), {
    title: 'Flip view',
  });
  const menuBtn = button('bc-tool', [icon('menu'), toolLabel('Menu')], () => menuCbs.forEach((cb) => cb()), {
    title: 'Menu',
  });

  // Online-only tools
  const resignLabel = toolLabel('Resign');
  const resignBtn = button('bc-tool bc-tool--resign', [icon('flag'), resignLabel], onResignClick, {
    hidden: true,
    title: 'Resign',
  });
  const drawLabel = toolLabel('Offer draw');
  const drawBtn = button('bc-tool bc-tool--draw', [icon('handshake'), drawLabel], onDrawClick, {
    hidden: true,
    title: 'Offer draw',
  });
  let resignTimer = 0;
  let drawTimer = 0;

  function resetResign(): void {
    window.clearTimeout(resignTimer);
    resignTimer = 0;
    resignBtn.classList.remove('is-confirm');
    resignLabel.textContent = 'Resign';
    resignBtn.title = 'Resign';
  }

  function resetDraw(): void {
    window.clearTimeout(drawTimer);
    drawTimer = 0;
    drawBtn.disabled = false;
    drawLabel.textContent = 'Offer draw';
    drawBtn.title = 'Offer draw';
  }

  function onResignClick(): void {
    if (resignBtn.classList.contains('is-confirm')) {
      resetResign();
      resignCbs.forEach((cb) => cb());
      return;
    }
    resignBtn.classList.add('is-confirm');
    resignLabel.textContent = 'Confirm resign?';
    resignBtn.title = 'Click again to resign';
    resignTimer = window.setTimeout(resetResign, RESIGN_CONFIRM_MS);
  }

  function onDrawClick(): void {
    if (drawBtn.disabled) return;
    const hadFocus = document.activeElement === drawBtn;
    drawBtn.disabled = true;
    drawLabel.textContent = 'Draw offered';
    drawBtn.title = 'Draw offered';
    // Keep keyboard users in the toolbar instead of dropping focus to <body>.
    if (hadFocus) flipBtn.focus({ preventScroll: true });
    drawTimer = window.setTimeout(resetDraw, DRAW_COOLDOWN_MS);
    drawCbs.forEach((cb) => cb());
  }

  const toolbar = el(
    'div',
    'bc-toolbar',
    { role: 'toolbar', 'aria-label': 'Game controls' },
    undoBtn,
    resignBtn,
    drawBtn,
    flipBtn,
    menuBtn,
  );

  const lastMoveMini = el('span', 'bc-panel__last');
  const collapseBtn = button(
    'bc-panel__toggle',
    [el('span', 'bc-panel__title', undefined, 'Battle Log'), lastMoveMini, icon('chev')],
    () => {
      const open = panel.classList.toggle('is-open');
      collapseBtn.setAttribute('aria-expanded', String(open));
      if (open) scrollMoves();
    },
    { 'aria-expanded': 'false', 'aria-controls': 'bc-panel-body' },
  );

  const panel = el(
    'aside',
    'bc-panel',
    { 'aria-label': 'Battle log' },
    el('h2', 'bc-panel__heading', undefined, 'Battle Log'),
    collapseBtn,
    el('div', 'bc-panel__body', { id: 'bc-panel-body' }, el('div', 'bc-trays', undefined, makeTray('w'), makeTray('b')), movesBox),
    toolbar,
  );

  // ----- Layers -----
  const bannerLayer = el('div', 'bc-banner-layer', { 'aria-live': 'assertive', role: 'alert' });
  const hudLayer = el('div', 'bc-hud', undefined, topBar, muteBtn, panel);
  const modalLayer = el('div', 'bc-modal-layer');
  root.append(hudLayer, bannerLayer, modalLayer);

  // ----- State -----
  let menuEl: HTMLElement | null = null;
  let lobbyClose: (() => void) | null = null;

  function scrollMoves(): void {
    movesBox.scrollTop = movesBox.scrollHeight;
  }

  let cinematic = false;

  /** HUD is hidden while the menu, the lobby or a cutscene is up. */
  function syncHudHidden(): void {
    setHudHidden(menuEl !== null || lobbyClose !== null || cinematic);
  }

  function setCinematic(on: boolean): void {
    cinematic = on;
    syncHudHidden();
  }

  function setHudHidden(hidden: boolean): void {
    hudLayer.classList.toggle('is-hidden', hidden);
    hudLayer.toggleAttribute('inert', hidden);
    queueInsets();
  }

  // ----- Board insets: the board is framed in the space the top bar and panel leave free -----
  const insetCbs: ((i: ScreenInsets) => void)[] = [];
  let insets: ScreenInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  let insetFrame = 0;

  function measureInsets(): ScreenInsets {
    if (hudLayer.classList.contains('is-hidden')) return { top: 0, right: 0, bottom: 0, left: 0 };
    const r = root.getBoundingClientRect();
    const top = Math.round(topBar.getBoundingClientRect().bottom - r.top + 6);
    const p = panel.getBoundingClientRect();
    if (p.width >= r.width - 2) {
      // Phone: the panel is a bottom strip. While the log is pulled open it overlays the board instead of reframing it.
      const bottom = panel.classList.contains('is-open') ? insets.bottom : Math.round(r.bottom - p.top);
      return { top, right: 0, bottom, left: 0 };
    }
    return { top, right: Math.round(r.right - p.left + 8), bottom: 0, left: 0 };
  }

  function queueInsets(): void {
    cancelAnimationFrame(insetFrame);
    insetFrame = requestAnimationFrame(() => {
      const next = measureInsets();
      if (next.top === insets.top && next.right === insets.right && next.bottom === insets.bottom && next.left === insets.left) return;
      insets = next;
      for (const cb of insetCbs) cb(insets);
    });
  }

  /** Shows a modal dialog; returns a function that closes it and restores focus. */
  function openModal(node: HTMLElement, label: string, opts: { instant?: boolean } = {}): () => void {
    const prevFocus = document.activeElement as HTMLElement | null;
    const wrap = el('div', `bc-modal-backdrop${opts.instant ? ' is-instant' : ''}`, undefined, node);
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-modal', 'true');
    node.setAttribute('aria-label', label);
    modalLayer.append(wrap);
    const first = node.querySelector<HTMLElement>('[data-autofocus]') ?? node.querySelector<HTMLElement>('button:not([disabled])');
    requestAnimationFrame(() => first?.focus({ preventScroll: true }));
    return () => {
      wrap.remove();
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    };
  }

  // -------------------------------------------------------------------------
  // Menu
  // -------------------------------------------------------------------------

  let urlRoomUsed = false;

  function showMenu(): Promise<MenuChoice> {
    menuEl?.remove();
    const state = loadSaved();
    let joinCode = '';
    // An invite link (?room=XXXXXX) preselects Online -> Join, once per page load.
    const urlRoom = urlRoomUsed ? null : roomFromUrl();
    urlRoomUsed = true;
    if (urlRoom) {
      state.mode = 'online';
      state.onlineAction = 'join';
      joinCode = urlRoom;
    }
    setHudHidden(true);

    return new Promise<MenuChoice>((resolve) => {
      // Mode cards
      const modeCard = (id: 'ai' | 'local' | 'online', title: string, desc: string, badge: string): HTMLButtonElement =>
        button(
          `bc-mode bc-mode--${id}`,
          [
            el('span', 'bc-mode__badge', { 'aria-hidden': 'true' }, badge),
            el('span', 'bc-mode__title', undefined, title),
            el('span', 'bc-mode__desc', undefined, desc),
          ],
          () => setMode(id),
          { 'aria-pressed': 'false' },
        );
      const aiCard = modeCard('ai', 'vs Computer', 'Take on the war-room AI', PIECES.b.k.icon);
      const localCard = modeCard('local', 'Local 2-Player', 'Two generals, one screen', `${PIECES.w.p.icon}${PIECES.b.p.icon}`);
      const onlineCard = modeCard('online', 'Online', 'Private rooms with a code', '📡');

      // Side choice
      const sideBtns: Record<Color, HTMLButtonElement> = { w: null!, b: null! };
      for (const c of ['w', 'b'] as Color[]) {
        sideBtns[c] = button(
          `bc-side bc-side--${c}`,
          [
            el('span', 'bc-side__icon', { 'aria-hidden': 'true' }, PIECES[c].k.icon),
            el(
              'span',
              'bc-side__text',
              undefined,
              el('span', 'bc-side__name', undefined, FACTIONS[c].name),
              el('span', 'bc-side__sub', undefined, c === 'w' ? 'White · moves first' : 'Black · moves second'),
            ),
          ],
          () => {
            state.humanColor = c;
            sync();
          },
          { 'aria-pressed': 'false', style: facVars(c) },
        );
      }

      const levelBtns = LEVELS.map((l) =>
        button(
          'bc-seg__btn',
          [el('span', 'bc-seg__label', undefined, l.label), el('span', 'bc-seg__hint', undefined, l.hint)],
          () => {
            state.level = l.id;
            sync();
          },
          { 'aria-pressed': 'false', 'data-level': l.id },
        ),
      );

      const aiOptions = el(
        'div',
        'bc-options',
        undefined,
        el('div', 'bc-field', undefined, el('div', 'bc-field__label', undefined, 'Choose your army'), el('div', 'bc-sides', undefined, sideBtns.w, sideBtns.b)),
        el('div', 'bc-field', undefined, el('div', 'bc-field__label', undefined, 'Difficulty'), el('div', 'bc-seg', { role: 'group', 'aria-label': 'Difficulty' }, ...levelBtns)),
      );

      const fightBtns = FIGHT_MODES.map((f) =>
        button(
          'bc-seg__btn',
          [el('span', 'bc-seg__label', undefined, f.label), el('span', 'bc-seg__hint', undefined, f.hint)],
          () => {
            state.fights = f.id;
            sync();
          },
          { 'aria-pressed': 'false', 'data-fights': f.id },
        ),
      );
      const fightOptions = el(
        'div',
        'bc-field bc-field--fights',
        undefined,
        el('div', 'bc-field__label', undefined, 'Capture fights'),
        el('div', 'bc-seg bc-seg--3', { role: 'group', 'aria-label': 'Capture fights' }, ...fightBtns),
      );

      const introBtns = INTRO_MODES.map((m) =>
        button(
          'bc-seg__btn',
          [el('span', 'bc-seg__label', undefined, m.label), el('span', 'bc-seg__hint', undefined, m.hint)],
          () => {
            state.intro = m.id;
            save(state); // takes effect on the next launch, so keep it even without deploying
            sync();
          },
          { 'aria-pressed': 'false', 'data-intro': m.id },
        ),
      );
      const introOptions = el(
        'div',
        'bc-field bc-field--intro',
        undefined,
        el('div', 'bc-field__label', undefined, 'Intro cinematic'),
        el('div', 'bc-seg bc-seg--3', { role: 'group', 'aria-label': 'Intro cinematic' }, ...introBtns),
      );

      const soundBtns = SOUND_MODES.map((m) =>
        button(
          'bc-seg__btn',
          [el('span', 'bc-seg__label', undefined, m.label), el('span', 'bc-seg__hint', undefined, m.hint)],
          () => {
            audio.setMode(m.id); // applies at once and is saved, even without deploying
            sync();
          },
          { 'aria-pressed': 'false', 'data-sound': m.id },
        ),
      );
      const soundOptions = el(
        'div',
        'bc-field bc-field--sound',
        undefined,
        el('div', 'bc-field__label', undefined, 'Sound'),
        el('div', 'bc-seg bc-seg--3', { role: 'group', 'aria-label': 'Sound' }, ...soundBtns),
      );

      const rotateInput = el('input', 'bc-switch__input', { type: 'checkbox', role: 'switch' });
      rotateInput.addEventListener('change', () => {
        state.autoRotate = rotateInput.checked;
      });
      const localOptions = el(
        'div',
        'bc-options',
        undefined,
        el(
          'label',
          'bc-switch',
          undefined,
          rotateInput,
          el('span', 'bc-switch__track', { 'aria-hidden': 'true' }, el('span', 'bc-switch__thumb')),
          el('span', 'bc-switch__text', undefined, el('strong', undefined, undefined, 'Rotate board each turn'), el('small', undefined, undefined, 'Camera swings to face the side to move')),
        ),
      );

      // Online: create / join
      const actionBtns = (
        [
          ['create', 'Create room', 'Host a battle'],
          ['join', 'Join room', 'Enter a code'],
        ] as const
      ).map(([id, label, hint]) =>
        button(
          'bc-seg__btn',
          [el('span', 'bc-seg__label', undefined, label), el('span', 'bc-seg__hint', undefined, hint)],
          () => {
            state.onlineAction = id;
            sync();
            if (id === 'join') requestAnimationFrame(() => codeInput.focus({ preventScroll: true }));
          },
          { 'aria-pressed': 'false', 'data-action': id },
        ),
      );

      const onlineSideBtns = (['w', 'b', 'random'] as OnlineSide[]).map((c) => {
        const isRandom = c === 'random';
        return button(
          `bc-side bc-side--${c}`,
          [
            el('span', 'bc-side__icon', { 'aria-hidden': 'true' }, isRandom ? '🎲' : PIECES[c].k.icon),
            el(
              'span',
              'bc-side__text',
              undefined,
              el('span', 'bc-side__name', undefined, isRandom ? 'Random' : FACTIONS[c].name),
              el('span', 'bc-side__sub', undefined, isRandom ? 'HQ assigns sides' : c === 'w' ? 'Moves first' : 'Moves second'),
            ),
          ],
          () => {
            state.onlineSide = c;
            sync();
          },
          {
            'aria-pressed': 'false',
            'data-side': c,
            style: isRandom ? '--fac:#6b5531;--fac2:#f39a3c;--facl:#f4ead2' : facVars(c),
          },
        );
      });

      const codeInput = el('input', 'bc-code', {
        type: 'text',
        id: 'bc-join-code',
        inputmode: 'text',
        autocomplete: 'off',
        autocapitalize: 'characters',
        autocorrect: 'off',
        spellcheck: 'false',
        enterkeyhint: 'go',
        maxlength: String(CODE_LEN + 6),
        placeholder: 'XXXXXX',
        'aria-describedby': 'bc-join-hint',
      });
      codeInput.value = joinCode;
      const codeHint = el('p', 'bc-code__hint', { id: 'bc-join-hint', 'aria-live': 'polite' });
      codeInput.addEventListener('input', () => {
        const clean = sanitizeCode(codeInput.value);
        if (clean !== codeInput.value) codeInput.value = clean;
        joinCode = clean;
        sync();
      });
      codeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          deployBtn.click();
        }
      });

      const nameInput = el('input', 'bc-name', {
        type: 'text',
        id: 'bc-player-name',
        autocomplete: 'nickname',
        spellcheck: 'false',
        enterkeyhint: 'go',
        maxlength: String(NAME_MAX_LENGTH),
        placeholder: 'Optional',
      });
      nameInput.value = state.playerName;
      nameInput.addEventListener('input', () => {
        state.playerName = nameInput.value;
      });
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          deployBtn.click();
        }
      });
      const namePane = el(
        'div',
        'bc-field',
        undefined,
        el('label', 'bc-field__label', { for: 'bc-player-name' }, 'Your name'),
        nameInput,
      );

      const createPane = el(
        'div',
        'bc-field',
        undefined,
        el('div', 'bc-field__label', undefined, 'Choose your army'),
        el('div', 'bc-sides bc-sides--3', undefined, ...onlineSideBtns),
      );
      const joinPane = el(
        'div',
        'bc-field',
        undefined,
        el('label', 'bc-field__label', { for: 'bc-join-code' }, 'Room code'),
        codeInput,
        codeHint,
      );
      const onlineOptions = el(
        'div',
        'bc-options',
        undefined,
        el('div', 'bc-seg bc-seg--2', { role: 'group', 'aria-label': 'Online game' }, ...actionBtns),
        namePane,
        createPane,
        joinPane,
      );

      const canDeploy = (): boolean =>
        state.mode !== 'online' || state.onlineAction === 'create' || joinCode.length === CODE_LEN;

      const deployBtn = button('bc-deploy', 'Deploy!', () => {
        if (!canDeploy()) return;
        state.playerName = cleanName(state.playerName);
        save(state);
        let choice: MenuChoice;
        const fights = state.fights;
        if (state.mode === 'ai') choice = { mode: 'ai', humanColor: state.humanColor, level: state.level, autoRotate: false, fights };
        else if (state.mode === 'local') choice = { mode: 'local', autoRotate: state.autoRotate, fights };
        else {
          const name = state.playerName;
          const online: OnlineRequest =
            state.onlineAction === 'join'
              ? { action: 'join', code: joinCode, name }
              : { action: 'create', side: state.onlineSide, name };
          choice = { mode: 'online', autoRotate: false, fights, online };
        }
        close();
        resolve(choice);
      });

      const card = el(
        'div',
        'bc-menu__card',
        undefined,
        el('div', 'bc-modes', { role: 'group', 'aria-label': 'Game mode' }, aiCard, localCard, onlineCard),
        aiOptions,
        localOptions,
        onlineOptions,
        fightOptions,
        introOptions,
        soundOptions,
        deployBtn,
      );

      const menu = el(
        'div',
        'bc-menu',
        { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bc-menu-title' },
        el(
          'header',
          'bc-menu__head',
          undefined,
          el('h1', 'bc-title', { id: 'bc-menu-title' }, 'BattleCore'),
          el('p', 'bc-subtitle', undefined, el('span', 'bc-subtitle__w', undefined, FACTIONS.w.name), ' vs ', el('span', 'bc-subtitle__b', undefined, FACTIONS.b.name)),
        ),
        card,
      );

      function setMode(m: 'ai' | 'local' | 'online'): void {
        state.mode = m;
        sync();
      }

      function sync(): void {
        aiCard.setAttribute('aria-pressed', String(state.mode === 'ai'));
        localCard.setAttribute('aria-pressed', String(state.mode === 'local'));
        onlineCard.setAttribute('aria-pressed', String(state.mode === 'online'));
        aiOptions.hidden = state.mode !== 'ai';
        localOptions.hidden = state.mode !== 'local';
        onlineOptions.hidden = state.mode !== 'online';
        for (const b of actionBtns) b.setAttribute('aria-pressed', String(b.dataset.action === state.onlineAction));
        createPane.hidden = state.onlineAction !== 'create';
        joinPane.hidden = state.onlineAction !== 'join';
        for (const b of onlineSideBtns) b.setAttribute('aria-pressed', String(b.dataset.side === state.onlineSide));
        const n = joinCode.length;
        codeHint.textContent =
          n === CODE_LEN ? 'Code locked in. Ready to deploy!' : `${n}/${CODE_LEN} · letters and digits 2-9 from your invite`;
        codeHint.classList.toggle('is-ready', n === CODE_LEN);
        deployBtn.disabled = !canDeploy();
        for (const c of ['w', 'b'] as Color[]) sideBtns[c].setAttribute('aria-pressed', String(state.humanColor === c));
        for (const b of levelBtns) b.setAttribute('aria-pressed', String(b.dataset.level === state.level));
        rotateInput.checked = state.autoRotate;
        for (const b of fightBtns) b.setAttribute('aria-pressed', String(b.dataset.fights === state.fights));
        for (const b of introBtns) b.setAttribute('aria-pressed', String(b.dataset.intro === state.intro));
        for (const b of soundBtns) b.setAttribute('aria-pressed', String(b.dataset.sound === audio.mode));
      }

      function onKey(e: KeyboardEvent): void {
        if (e.key === 'Enter' && document.activeElement === document.body) deployBtn.click();
      }

      function close(): void {
        document.removeEventListener('keydown', onKey);
        menu.classList.add('is-leaving');
        if (menuEl === menu) menuEl = null;
        syncHudHidden();
        const done = (): void => menu.remove();
        if (prefersReducedMotion()) done();
        else {
          menu.addEventListener('animationend', done, { once: true });
          window.setTimeout(done, 600);
        }
      }

      sync();
      document.addEventListener('keydown', onKey);
      menuEl = menu;
      modalLayer.append(menu);
      requestAnimationFrame(() => (deployBtn.disabled ? codeInput : deployBtn).focus({ preventScroll: true }));
    });
  }

  // -------------------------------------------------------------------------
  // HUD updates
  // -------------------------------------------------------------------------

  function setTurn(color: Color): void {
    const f = FACTIONS[color];
    turnPill.style.setProperty('--fac', f.primary);
    turnPill.style.setProperty('--fac2', f.secondary);
    turnPill.style.setProperty('--facl', LABEL[color]);
    turnPill.dataset.color = color;
    turnText.textContent = '';
    turnText.append(
      el('span', 'bc-turn__icon', { 'aria-hidden': 'true' }, PIECES[color].k.icon),
      el('span', 'bc-turn__long', undefined, `${f.name} to move`),
      el('span', 'bc-turn__short', undefined, `${f.short} to move`),
    );
  }

  function setMoves(san: string[]): void {
    movesList.textContent = '';
    for (let i = 0; i < san.length; i += 2) {
      const row = el(
        'li',
        'bc-move',
        undefined,
        el('span', 'bc-move__num', undefined, `${i / 2 + 1}.`),
        el('span', 'bc-move__san bc-move__san--w', undefined, san[i]),
        el('span', 'bc-move__san bc-move__san--b', undefined, san[i + 1] ?? ''),
      );
      movesList.append(row);
    }
    const lastIdx = san.length - 1;
    if (lastIdx >= 0) {
      const lastRow = movesList.lastElementChild;
      lastRow?.querySelector(lastIdx % 2 === 0 ? '.bc-move__san--w' : '.bc-move__san--b')?.classList.add('is-latest');
      lastMoveMini.textContent = `${Math.floor(lastIdx / 2) + 1}.${lastIdx % 2 === 1 ? '..' : ''} ${san[lastIdx]}`;
    } else {
      lastMoveMini.textContent = '';
    }
    movesEmpty.hidden = san.length > 0;
    requestAnimationFrame(scrollMoves);
  }

  function setCaptured(byWhite: PieceType[], byBlack: PieceType[]): void {
    const sum = (arr: PieceType[]): number => arr.reduce((s, t) => s + VALUES[t], 0);
    const diff = sum(byWhite) - sum(byBlack);
    const fill = (capturer: Color, arr: PieceType[]): void => {
      const victim = other(capturer);
      const t = trays[capturer];
      t.list.textContent = '';
      const sorted = [...arr].sort((a, b) => VALUES[b] - VALUES[a]);
      for (const p of sorted) {
        t.list.append(
          el('span', `bc-cap bc-cap--${victim}`, { title: PIECES[victim][p].name, 'aria-label': PIECES[victim][p].name, role: 'img' }, PIECES[victim][p].icon),
        );
      }
      if (sorted.length === 0) t.list.append(el('span', 'bc-tray__none', undefined, 'No captures'));
      const adv = capturer === 'w' ? diff : -diff;
      t.adv.textContent = adv > 0 ? `+${adv}` : '';
    };
    fill('w', byWhite);
    fill('b', byBlack);
  }

  function showBanner(text: string, kind: BannerKind, durationMs = 1400): void {
    bannerLayer.textContent = '';
    const b = el('div', `bc-banner bc-banner--${kind}`, { style: `--dur:${Math.max(300, durationMs)}ms` }, el('span', 'bc-banner__text', undefined, text));
    bannerLayer.append(b);
    const remove = (): void => b.remove();
    b.addEventListener('animationend', (e) => {
      if (e.target === b) remove();
    });
    window.setTimeout(remove, durationMs + 200);
  }

  function showGameOver(title: string, subtitle: string): Promise<'rematch' | 'menu'> {
    return new Promise((resolve) => {
      const finish = (r: 'rematch' | 'menu'): void => {
        close();
        resolve(r);
      };
      const node = el(
        'div',
        'bc-dialog bc-gameover',
        undefined,
        el('div', 'bc-gameover__stripe', { 'aria-hidden': 'true' }),
        el('h2', 'bc-dialog__title', undefined, title),
        el('p', 'bc-dialog__sub', undefined, subtitle),
        el(
          'div',
          'bc-dialog__actions',
          undefined,
          button('bc-btn bc-btn--primary', 'Rematch', () => finish('rematch'), { 'data-autofocus': true }),
          button('bc-btn', 'Main Menu', () => finish('menu')),
        ),
      );
      const close = openModal(node, title);
    });
  }

  function choosePromotion(color: Color): Promise<PieceType> {
    return new Promise((resolve) => {
      const pick = (t: PieceType): void => {
        document.removeEventListener('keydown', onKey, true);
        close();
        resolve(t);
      };
      const opts = PROMO_ORDER.map((t) =>
        button(
          'bc-promo__opt',
          [
            el('span', 'bc-promo__icon', { 'aria-hidden': 'true' }, PIECES[color][t].icon),
            el('span', 'bc-promo__name', undefined, PIECES[color][t].name),
            el('span', 'bc-promo__glyph', { 'aria-hidden': 'true' }, GLYPHS[t]),
            el('kbd', 'bc-promo__key', { 'aria-hidden': 'true' }, t.toUpperCase()),
          ],
          () => pick(t),
          { 'aria-keyshortcuts': t.toUpperCase() },
        ),
      );
      const node = el(
        'div',
        'bc-dialog bc-promo',
        { style: facVars(color) },
        el('h2', 'bc-dialog__title', undefined, 'Field Promotion!'),
        el('p', 'bc-dialog__sub', undefined, `Choose a new rank for your ${PIECES[color].p.name}`),
        el('div', 'bc-promo__grid', undefined, ...opts),
      );
      const onKey = (e: KeyboardEvent): void => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const t = PROMO_KEYS[e.key.toLowerCase()];
        if (t) {
          e.preventDefault();
          e.stopPropagation();
          pick(t);
        }
      };
      document.addEventListener('keydown', onKey, true);
      const close = openModal(node, 'Choose promotion piece');
    });
  }

  function setThinking(thinking: boolean): void {
    turnPill.classList.toggle('is-thinking', thinking);
  }

  function setUndoEnabled(enabled: boolean): void {
    undoBtn.disabled = !enabled;
  }

  // -------------------------------------------------------------------------
  // Online play
  // -------------------------------------------------------------------------

  /** Brief "Copied!" feedback on a button's label span. */
  function flashLabel(btn: HTMLButtonElement, labelEl: HTMLElement, text: string, ok: boolean): void {
    const original = labelEl.dataset.label ?? labelEl.textContent ?? '';
    labelEl.dataset.label = original;
    labelEl.textContent = text;
    btn.classList.toggle('is-copied', ok);
    btn.classList.toggle('is-failed', !ok);
    window.clearTimeout(Number(btn.dataset.timer ?? 0));
    btn.dataset.timer = String(
      window.setTimeout(() => {
        labelEl.textContent = original;
        btn.classList.remove('is-copied', 'is-failed');
      }, 1800),
    );
  }

  function showLobby(code: string | null, side: Color | null): Lobby {
    const replacing = lobbyClose !== null;
    lobbyClose?.();

    let resolveCancel!: () => void;
    const cancelled = new Promise<void>((r) => (resolveCancel = r));
    let open = true;

    const status = el('p', 'bc-lobby__status', { role: 'status', 'aria-live': 'polite' });
    const cancelBtn = button('bc-btn', 'Cancel', () => {
      if (!open) return;
      close();
      resolveCancel();
    });

    const children: Node[] = [el('div', 'bc-gameover__stripe', { 'aria-hidden': 'true' })];
    let label: string;

    if (code === null) {
      label = 'Connecting to HQ';
      children.push(
        el('div', 'bc-radar', { 'aria-hidden': 'true' }, el('span', 'bc-radar__sweep'), el('span', 'bc-radar__blip')),
        el('h2', 'bc-dialog__title bc-lobby__title', undefined, 'Connecting to HQ…'),
        el('p', 'bc-dialog__sub', undefined, 'Establishing a secure line to the war room.'),
      );
    } else {
      label = `Room ${code}`;
      const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
      const copyLabel = el('span', undefined, undefined, 'Copy code');
      const linkLabel = el('span', undefined, undefined, 'Copy invite link');
      const copyBtn = button('bc-btn bc-btn--small', [icon('copy'), copyLabel], undefined, { 'data-autofocus': true });
      const linkBtn = button('bc-btn bc-btn--small', [icon('link'), linkLabel], undefined, { title: link });
      copyBtn.addEventListener('click', () => {
        void copyText(code).then((ok) => flashLabel(copyBtn, copyLabel, ok ? 'Copied!' : 'Copy failed', ok));
      });
      linkBtn.addEventListener('click', () => {
        void copyText(link).then((ok) => flashLabel(linkBtn, linkLabel, ok ? 'Copied!' : 'Copy failed', ok));
      });

      const tiles = el(
        'div',
        'bc-lobby__code',
        undefined,
        el('span', 'bc-sr-only', undefined, code.split('').join(' ')),
        ...code.split('').map((ch) => el('span', 'bc-lobby__char', { 'aria-hidden': 'true' }, ch)),
      );
      children.push(
        el('div', 'bc-field__label bc-lobby__label', undefined, 'Room code'),
        tiles,
        el('div', 'bc-lobby__copy', undefined, copyBtn, linkBtn),
      );
      if (side) {
        children.push(
          el(
            'div',
            'bc-lobby__side',
            { style: facVars(side) },
            el('span', 'bc-side__icon', { 'aria-hidden': 'true' }, PIECES[side].k.icon),
            el('span', undefined, undefined, 'You command the ', el('strong', undefined, undefined, FACTIONS[side].name)),
          ),
        );
      }
      status.append('Waiting for an opponent', el('span', 'bc-dots', { 'aria-hidden': 'true' }, el('i'), el('i'), el('i')));
      children.push(status, el('p', 'bc-lobby__tip', undefined, 'Send the code or link to a friend. The battle starts when they join.'));
    }
    children.push(el('div', 'bc-dialog__actions', undefined, cancelBtn));

    const node = el('div', `bc-dialog bc-lobby${code === null ? ' is-connecting' : ''}`, undefined, ...children);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelBtn.click();
      }
    };

    const closeModal = openModal(node, label, { instant: replacing });
    document.addEventListener('keydown', onKey);

    function close(): void {
      if (!open) return;
      open = false;
      document.removeEventListener('keydown', onKey);
      closeModal();
      if (lobbyClose === close) lobbyClose = null;
      syncHudHidden();
    }

    lobbyClose = close;
    syncHudHidden();
    return { close, cancelled };
  }

  function setOnlineMode(online: boolean): void {
    toolbar.classList.toggle('bc-toolbar--online', online);
    undoBtn.hidden = online;
    resignBtn.hidden = !online;
    drawBtn.hidden = !online;
    oppChip.hidden = !online;
    resetResign();
    resetDraw();
  }

  const OPP_TEXT: Record<OpponentStatus, string> = {
    waiting: 'Waiting for opponent',
    connected: 'Opponent online',
    disconnected: 'Opponent reconnecting…',
    left: 'Opponent left',
  };

  function setOpponentStatus(status: OpponentStatus, side: Color, name?: string | null): void {
    oppChip.dataset.status = status;
    oppChip.setAttribute('style', facVars(side));
    oppIcon.textContent = PIECES[side].k.icon;
    oppName.textContent = name || FACTIONS[side].short;
    oppChip.title = name ? `${name} (${FACTIONS[side].name})` : '';
    oppText.textContent = OPP_TEXT[status];
  }

  /** Draw offer prompt. Y / N (Escape = decline) are captured while it is open. */
  function askDraw(): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (accept: boolean): void => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        close();
        resolve(accept);
      };
      const keyHint = (k: string): HTMLElement => el('kbd', 'bc-kbd', { 'aria-hidden': 'true' }, k);
      const node = el(
        'div',
        'bc-dialog bc-truce',
        undefined,
        el('div', 'bc-gameover__stripe bc-truce__stripe', { 'aria-hidden': 'true' }),
        el('div', 'bc-truce__flag', { 'aria-hidden': 'true' }, '🏳️'),
        el('h2', 'bc-dialog__title', undefined, 'The enemy offers a truce'),
        el('p', 'bc-dialog__sub', undefined, 'Accept a draw and end the battle here?'),
        el(
          'div',
          'bc-dialog__actions',
          undefined,
          button('bc-btn bc-btn--primary', [el('span', undefined, undefined, 'Accept'), keyHint('Y')], () => finish(true), {
            'aria-keyshortcuts': 'Y',
          }),
          button('bc-btn', [el('span', undefined, undefined, 'Decline'), keyHint('N')], () => finish(false), {
            'aria-keyshortcuts': 'N',
            'data-autofocus': true,
          }),
        ),
      );
      const onKey = (e: KeyboardEvent): void => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key.toLowerCase();
        if (k === 'y' || k === 'n' || k === 'escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(k === 'y');
        }
      };
      document.addEventListener('keydown', onKey, true);
      const close = openModal(node, 'The enemy offers a truce');
    });
  }

  function showStart(): Promise<void> {
    return new Promise((resolve) => {
      const card = el(
        'div',
        'bc-start',
        { role: 'button', tabindex: '0', 'aria-label': 'Start BattleCore' },
        el('h1', 'bc-title', undefined, 'BattleCore'),
        el('p', 'bc-subtitle', undefined, el('span', 'bc-subtitle__w', undefined, FACTIONS.w.name), ' vs ', el('span', 'bc-subtitle__b', undefined, FACTIONS.b.name)),
        el('p', 'bc-start__prompt', undefined, 'Tap or press any key to start'),
      );
      const go = (e: Event): void => {
        e.preventDefault();
        window.removeEventListener('pointerdown', go, true);
        window.removeEventListener('keydown', go, true);
        card.classList.add('is-leaving');
        window.setTimeout(() => card.remove(), 350);
        resolve();
      };
      window.addEventListener('pointerdown', go, true);
      window.addEventListener('keydown', go, true);
      modalLayer.append(card);
      card.focus({ preventScroll: true });
    });
  }

  function showMessage(title: string, text: string): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        close();
        resolve();
      };
      const node = el(
        'div',
        'bc-dialog bc-message',
        undefined,
        el('div', 'bc-gameover__stripe', { 'aria-hidden': 'true' }),
        el('h2', 'bc-dialog__title', undefined, title),
        el('p', 'bc-dialog__sub', undefined, text),
        el('div', 'bc-dialog__actions', undefined, button('bc-btn bc-btn--primary', 'OK', finish, { 'data-autofocus': true })),
      );
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish();
        }
      };
      document.addEventListener('keydown', onKey, true);
      const close = openModal(node, title);
    });
  }

  const insetWatch = new ResizeObserver(queueInsets);
  insetWatch.observe(root);
  insetWatch.observe(panel);
  insetWatch.observe(topBar);

  // Initial state
  setTurn('w');
  setMoves([]);
  setCaptured([], []);

  return {
    showMenu,
    setTurn,
    setMoves,
    setCaptured,
    showBanner,
    showGameOver,
    choosePromotion,
    setThinking,
    setUndoEnabled,
    onUndo: (cb) => void undoCbs.push(cb),
    onFlip: (cb) => void flipCbs.push(cb),
    onMenu: (cb) => void menuCbs.push(cb),
    setCinematic,
    showStart,
    onInsetsChange: (cb) => {
      insetCbs.push(cb);
      cb(insets);
      queueInsets();
    },
    introMode: () => loadSaved().intro,
    showLobby,
    setOnlineMode,
    setOpponentStatus,
    onResign: (cb) => void resignCbs.push(cb),
    onOfferDraw: (cb) => void drawCbs.push(cb),
    askDraw,
    showMessage,
  };
}
