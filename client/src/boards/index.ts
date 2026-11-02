// Board definitions: one folder per board (src/boards/<id>/board.json), picked up automatically.
// A board is a visual theme plus an 8x8 grid of hazard squares; with no hazards it is plain chess.
// See docs/PLATFORM.md §4. Hazard rules arrive in P3 (walls) and P4 (fire, ice, craters).

export type HazardKind = 'wall' | 'fire' | 'ice' | 'crater';
export const HAZARD_KINDS: readonly HazardKind[] = ['wall', 'fire', 'ice', 'crater'];

export interface BoardTheme {
  /** Light and dark square colors. */
  squares: [string, string];
  frame: string;
  rim: string;
  /** Brass inlay and corner caps. */
  trim: string;
}

export interface BoardDef {
  id: string;
  name: string;
  theme: BoardTheme;
  /** Rank 8 first, as in FEN; "." is a normal square, other characters map through `hazards`. */
  grid: string[];
  hazards: Record<string, HazardKind>;
}

/** Checks a board file. Throws with the board folder and the problem. */
export function loadBoard(folder: string, b: BoardDef): BoardDef {
  const fail = (msg: string): never => {
    throw new Error(`Board "${folder}": ${msg}`);
  };
  if (b.id !== folder) fail(`id "${b.id}" must match its folder name`);
  const [light, dark] = b.theme?.squares ?? [];
  for (const [name, c] of [['squares[0]', light], ['squares[1]', dark], ['frame', b.theme?.frame], ['rim', b.theme?.rim], ['trim', b.theme?.trim]]) {
    if (!/^#[0-9a-f]{6}$/i.test(c ?? '')) fail(`theme.${name} must be a #rrggbb color`);
  }
  if (b.grid?.length !== 8 || b.grid.some((row) => row.length !== 8)) fail('grid must be 8 rows of 8 characters');
  for (const [ch, kind] of Object.entries(b.hazards ?? {})) {
    if (ch.length !== 1 || ch === '.') fail(`hazard key "${ch}" must be one character other than "."`);
    if (!HAZARD_KINDS.includes(kind)) fail(`unknown hazard "${kind}"`);
  }
  b.grid.forEach((row, i) => {
    for (const ch of row) if (ch !== '.' && !(ch in b.hazards)) fail(`grid row ${i + 1} uses "${ch}", which isn't in hazards`);
    // Rows 0,1 and 6,7 are ranks 8,7 and 2,1: both armies must start complete.
    if ((i <= 1 || i >= 6) && row !== '........') fail(`rank ${8 - i} must be clear (armies start there)`);
    // Fairness: each side sees the same layout.
    if (row !== b.grid[7 - i]) fail(`grid must mirror between the two sides (rank ${8 - i} vs rank ${i + 1})`);
  });
  return b;
}

const files = import.meta.glob<BoardDef>('./*/board.json', { eager: true, import: 'default' });

export const BOARDS: Record<string, BoardDef> = Object.fromEntries(
  Object.entries(files).map(([path, def]) => {
    const folder = path.split('/')[1];
    return [folder, loadBoard(folder, def)];
  }),
);

/** The board in play. Fixed to the classic board until the menu gets a board picker (P3). */
export function activeBoard(): BoardDef {
  return BOARDS.classic;
}

/** The hazard on `square` (e.g. "e4") of `board`, or null. */
export function hazardAt(board: BoardDef, square: string): HazardKind | null {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const ch = board.grid[8 - rank]?.[file];
  return ch && ch !== '.' ? (board.hazards[ch] ?? null) : null;
}
