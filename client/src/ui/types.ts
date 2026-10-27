import type { Color, Level, PieceType } from '../core/types';

export interface MenuChoice {
  mode: 'ai' | 'local';
  /** vs Computer only: which side the human plays. */
  humanColor?: Color;
  level?: Level;
  /** Local 2P: rotate the camera to face the side to move. */
  autoRotate: boolean;
}

export type BannerKind = 'check' | 'mate' | 'draw' | 'info';

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
}
