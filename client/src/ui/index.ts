import './hud.css';
import data from '../data/pieces.json';
import type { Color, Level, PieceType } from '../core/types';
import type { BannerKind, Hud, MenuChoice } from './types';

export type { Hud, MenuChoice, BannerKind } from './types';

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
const PROMO_ORDER: PieceType[] = ['q', 'r', 'b', 'n'];
const PROMO_KEYS: Record<string, PieceType> = { q: 'q', r: 'r', b: 'b', n: 'n' };
const STORAGE_KEY = 'battlecore.menu.v1';

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
const ICON_PATHS: Record<'undo' | 'flip' | 'menu' | 'chev', string> = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  flip: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  menu: 'M4 6h16M4 12h16M4 18h16',
  chev: 'M6 15l6-6 6 6',
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

interface Saved {
  mode: 'ai' | 'local';
  humanColor: Color;
  level: Level;
  autoRotate: boolean;
}

const DEFAULTS: Saved = { mode: 'ai', humanColor: 'w', level: 'medium', autoRotate: true };

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Saved>;
    return {
      mode: p.mode === 'local' ? 'local' : 'ai',
      humanColor: p.humanColor === 'b' ? 'b' : 'w',
      level: LEVELS.some((l) => l.id === p.level) ? (p.level as Level) : DEFAULTS.level,
      autoRotate: typeof p.autoRotate === 'boolean' ? p.autoRotate : DEFAULTS.autoRotate,
    };
  } catch {
    return { ...DEFAULTS };
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

  // ----- Turn pill -----
  const turnText = el('span', 'bc-turn__text');
  const turnDots = el('span', 'bc-dots', { 'aria-hidden': 'true' }, el('i'), el('i'), el('i'));
  const thinkingLabel = el('span', 'bc-turn__thinking', undefined, 'thinking', turnDots);
  const turnPill = el('div', 'bc-turn', { role: 'status', 'aria-live': 'polite' }, turnText, thinkingLabel);

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

  const undoBtn = button('bc-tool', [icon('undo'), el('span', undefined, undefined, 'Undo')], () =>
    undoCbs.forEach((cb) => cb()),
  );
  const flipBtn = button('bc-tool', [icon('flip'), el('span', undefined, undefined, 'Flip view')], () =>
    flipCbs.forEach((cb) => cb()),
  );
  const menuBtn = button('bc-tool', [icon('menu'), el('span', undefined, undefined, 'Menu')], () =>
    menuCbs.forEach((cb) => cb()),
  );
  const toolbar = el('div', 'bc-toolbar', { role: 'toolbar', 'aria-label': 'Game controls' }, undoBtn, flipBtn, menuBtn);

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
  const hudLayer = el('div', 'bc-hud', undefined, turnPill, panel);
  const modalLayer = el('div', 'bc-modal-layer');
  root.append(hudLayer, bannerLayer, modalLayer);

  // ----- State -----
  let menuEl: HTMLElement | null = null;

  function scrollMoves(): void {
    movesBox.scrollTop = movesBox.scrollHeight;
  }

  function setHudHidden(hidden: boolean): void {
    hudLayer.classList.toggle('is-hidden', hidden);
    hudLayer.toggleAttribute('inert', hidden);
  }

  /** Shows a modal dialog; returns a function that closes it and restores focus. */
  function openModal(node: HTMLElement, label: string): () => void {
    const prevFocus = document.activeElement as HTMLElement | null;
    const wrap = el('div', 'bc-modal-backdrop', undefined, node);
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

  function showMenu(): Promise<MenuChoice> {
    menuEl?.remove();
    const state = loadSaved();
    setHudHidden(true);

    return new Promise<MenuChoice>((resolve) => {
      // Mode cards
      const modeCard = (id: 'ai' | 'local' | 'online', title: string, desc: string, badge: string): HTMLButtonElement => {
        const disabled = id === 'online';
        const b = button(
          `bc-mode bc-mode--${id}`,
          [
            el('span', 'bc-mode__badge', { 'aria-hidden': 'true' }, badge),
            el('span', 'bc-mode__title', undefined, title),
            el('span', 'bc-mode__desc', undefined, desc),
            ...(disabled ? [el('span', 'bc-tag', undefined, 'Coming soon')] : []),
          ],
          disabled ? undefined : () => setMode(id),
          { disabled, 'aria-pressed': disabled ? undefined : 'false' },
        );
        return b;
      };
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

      const deployBtn = button('bc-deploy', 'Deploy!', () => {
        save(state);
        const choice: MenuChoice =
          state.mode === 'ai'
            ? { mode: 'ai', humanColor: state.humanColor, level: state.level, autoRotate: false }
            : { mode: 'local', autoRotate: state.autoRotate };
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

      function setMode(m: 'ai' | 'local'): void {
        state.mode = m;
        sync();
      }

      function sync(): void {
        aiCard.setAttribute('aria-pressed', String(state.mode === 'ai'));
        localCard.setAttribute('aria-pressed', String(state.mode === 'local'));
        aiOptions.hidden = state.mode !== 'ai';
        localOptions.hidden = state.mode !== 'local';
        for (const c of ['w', 'b'] as Color[]) sideBtns[c].setAttribute('aria-pressed', String(state.humanColor === c));
        for (const b of levelBtns) b.setAttribute('aria-pressed', String(b.dataset.level === state.level));
        rotateInput.checked = state.autoRotate;
      }

      function onKey(e: KeyboardEvent): void {
        if (e.key === 'Enter' && document.activeElement === document.body) deployBtn.click();
      }

      function close(): void {
        document.removeEventListener('keydown', onKey);
        menu.classList.add('is-leaving');
        setHudHidden(false);
        const done = (): void => {
          menu.remove();
          if (menuEl === menu) menuEl = null;
        };
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
      requestAnimationFrame(() => deployBtn.focus({ preventScroll: true }));
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
    turnText.append(el('span', 'bc-turn__icon', { 'aria-hidden': 'true' }, PIECES[color].k.icon), `${f.name} to move`);
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
  };
}
