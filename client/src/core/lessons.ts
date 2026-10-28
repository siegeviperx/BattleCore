// Training lessons (data/lessons.json): a start position, the move(s) the student should find, and scripted
// replies. Text may name pieces with {w.n}-style tokens, filled in with the current army names.
import data from '../data/lessons.json';
import pieces from '../data/pieces.json';
import type { Color, PieceType } from './types';

export interface LessonStep {
  /** Instruction shown while the student looks for the move. */
  say: string;
  /** Moves (UCI) that count as correct; the first one is the hint. */
  accept: string[];
  /** Shown after a correct move, while the reply plays. */
  praise?: string;
  /** Opponent's scripted answer (UCI). Every step but the last needs one. */
  reply?: string;
  /** Shown when the student plays a legal move that isn't in `accept`. */
  wrong?: string;
}

export interface Lesson {
  id: string;
  group: string;
  title: string;
  summary: string;
  /** The side the student plays. */
  side: Color;
  fen: string;
  /** Moves played automatically before the first step (e.g. the enemy pawn's charge for en passant). */
  setup?: string[];
  intro: string;
  steps: LessonStep[];
  done: string;
}

export interface LessonGroup {
  id: string;
  title: string;
  sub: string;
}

export const LESSON_GROUPS: LessonGroup[] = data.groups;
export const LESSONS = data.lessons as Lesson[];

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

/** The lesson after `id` in menu order, if any. */
export function nextLesson(id: string): Lesson | undefined {
  const i = LESSONS.findIndex((l) => l.id === id);
  return i >= 0 ? LESSONS[i + 1] : undefined;
}

const NAMES = pieces.pieces as Record<Color, Record<PieceType, { name: string }>>;

/** Replace {w.n}-style tokens with piece names, e.g. "{w.n}" -> "Jetpack Baby". */
export function lessonText(text: string): string {
  return text.replace(/\{([wb])\.([pnbrqk])\}/g, (_, c: Color, t: PieceType) => NAMES[c][t].name);
}

// --- Progress (which lessons are complete), kept in localStorage ---

const PROGRESS_KEY = 'battlecore.learn.v1';

export function completedLessons(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function markLessonDone(id: string): void {
  const done = completedLessons();
  done.add(id);
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify([...done]));
  } catch {
    /* storage unavailable: progress lasts for this visit only */
  }
}
