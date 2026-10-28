import type { Color, FightMode, Level, PieceType } from '../core/types';
import type { Matchup } from '../packs/validate';

export type OnlineRequest =
  | { action: 'create'; side: Color | 'random'; name: string; army: string }
  | { action: 'join'; code: string; name: string; army: string };

export interface MenuChoice {
  mode: 'ai' | 'local' | 'online' | 'learn';
  /** Which army (pack id) plays each side. Online games get theirs from the server instead. */
  matchup?: Matchup;
  /** Training only: the lesson to start (core/lessons.ts id). */
  lesson?: string;
  /** vs Computer only: which side the human plays. */
  humanColor?: Color;
  level?: Level;
  /** Local 2P: rotate the camera to face the side to move. */
  autoRotate: boolean;
  /** How captures play out on this screen (online: only affects this player's view). */
  fights: FightMode;
  /** Online only. */
  online?: OnlineRequest;
}

export type BannerKind = 'check' | 'mate' | 'draw' | 'info';

/** When the intro cinematic plays on launch. */
export type IntroMode = 'always' | 'first' | 'never';

/** Screen edges (CSS px) covered by HUD panels. */
export interface ScreenInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** What the hover tag says about a piece under the mouse. */
export interface PieceTip {
  color: Color;
  type: PieceType;
  /** Whose piece it is from this player's point of view (null in local 2-player). */
  owner: 'yours' | 'enemy' | null;
}

/** The coach card shown during a training lesson. */
export interface CoachState {
  /** Small line above the title, e.g. "Boot Camp · Step 1 of 2". */
  kicker: string;
  title: string;
  /** Instruction or feedback, with piece names already filled in. */
  text: string;
  /** 'task' = find the move, 'good' = that was right, 'oops' = try again. */
  mood: 'task' | 'good' | 'oops';
}

export type CoachAction = 'hint' | 'restart' | 'guide';

export type OpponentStatus = 'waiting' | 'connected' | 'disconnected' | 'left';

export interface Lobby {
  /** Close the lobby overlay (game is starting or was aborted). */
  close(): void;
  /** Resolves if the player presses Cancel. */
  cancelled: Promise<void>;
}

export interface Hud {
  /** Show the main menu and resolve with the player's choice. */
  showMenu(): Promise<MenuChoice>;
  setTurn(color: Color): void;
  /** SAN moves in order, e.g. ["e4", "e5", "Nf3"]. */
  setMoves(san: string[]): void;
  /** Pieces captured BY each side. */
  setCaptured(byWhite: PieceType[], byBlack: PieceType[]): void;
  showBanner(text: string, kind: BannerKind, durationMs?: number): void;
  showGameOver(title: string, subtitle: string): Promise<'rematch' | 'menu'>;
  choosePromotion(color: Color): Promise<PieceType>;
  setThinking(thinking: boolean): void;
  setUndoEnabled(enabled: boolean): void;
  onUndo(cb: () => void): void;
  onFlip(cb: () => void): void;
  onMenu(cb: () => void): void;
  /** Hide the HUD for a cutscene. */
  setCinematic(on: boolean): void;
  /** Show the name tag for the piece under the mouse at client (x, y), or hide it with null. */
  showPieceTip(tip: PieceTip | null, x?: number, y?: number): void;
  /** Fires when the screen area covered by the HUD changes (resize, panel layout, HUD hidden for a cutscene). */
  onInsetsChange(cb: (insets: ScreenInsets) => void): void;
  /** Title card: shows "Loading" until `ready` settles, then waits for a tap or key press (which also lets the browser start audio). */
  showStart(ready: Promise<void>): Promise<void>;
  /** The saved intro preference (read before the menu opens). */
  introMode(): IntroMode;

  // --- Online play ---
  /** Overlay shown while connecting / waiting for an opponent. `code` is null while still connecting. */
  showLobby(code: string | null, side: Color | null): Lobby;
  /** Online games: swap Undo for Offer Draw, show the opponent status chip. False restores offline controls. */
  setOnlineMode(online: boolean): void;
  /** `name` replaces the faction label on the chip when the opponent gave one. */
  setOpponentStatus(status: OpponentStatus, side: Color, name?: string | null): void;
  /** Forfeit confirmed (every mode). */
  onResign(cb: () => void): void;
  onOfferDraw(cb: () => void): void;
  /** Ask whether to accept the opponent's draw offer. */
  askDraw(): Promise<boolean>;
  // --- Training ---
  /** Show or update the lesson coach card; null hides it. While shown, Undo and Forfeit are hidden. */
  setCoach(state: CoachState | null): void;
  onCoachAction(cb: (action: CoachAction) => void): void;
  /** Lesson start card with the lesson's explanation. Resolves when the player is ready. */
  showLessonIntro(kicker: string, title: string, text: string): Promise<void>;
  /** Lesson complete card. */
  showLessonDone(title: string, text: string, hasNext: boolean): Promise<'next' | 'replay' | 'menu'>;
  /** The How to Play guide (also reachable from the menu). */
  showGuide(): Promise<void>;
  /** Simple blocking message (e.g. "Room not found"). Resolves on OK. */
  showMessage(title: string, text: string): Promise<void>;
}
