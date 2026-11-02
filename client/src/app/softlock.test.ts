// Softlock hunt: drives the real Controller with a fake board and HUD and checks that no sequence of clicks,
// hints, restarts or menu trips leaves the player unable to move.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Engine } from '../ai/types';
import { LESSONS, type Lesson } from '../core/lessons';
import type { PieceType, Square } from '../core/types';
import type { BoardView } from '../render/types';
import type { CoachAction, CoachState, Hud, MenuChoice } from '../ui/types';
import { Controller } from './controller';

vi.mock('../audio', () => ({ audio: { music() {}, play() {} }, sfx() {} }));

const ANIM_MS = 600;
const FILES = 'abcdefgh';
const ALL_SQUARES: Square[] = [...FILES].flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${f}${r}`));

interface Rig {
  ctl: Controller;
  /** Private controller state, for assertions. */
  c: any;
  click(sq: Square): void;
  coach(a: CoachAction): void;
  menuBtn(): void;
  undoBtn(): void;
  pickMenu(choice: Partial<MenuChoice>): Promise<void>;
  menuOpen(): boolean;
  introOpen(): boolean;
  passIntro(): Promise<void>;
  done: { title: string; resolve: (r: 'next' | 'replay' | 'menu') => void } | null;
  gameOver: { resolve: (r: 'rematch' | 'menu') => void } | null;
  coachState: CoachState | null;
  promoPick: PieceType;
  animFail: boolean;
  engine: { fail: boolean };
}

async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

function makeRig(): Rig {
  let clickCb: (sq: Square) => void = () => {};
  let coachCb: (a: CoachAction) => void = () => {};
  let menuCb: () => void = () => {};
  let undoCb: () => void = () => {};
  let menuResolve: ((c: MenuChoice) => void) | null = null;
  let introResolve: (() => void) | null = null;

  const rig = {
    done: null,
    gameOver: null,
    coachState: null,
    promoPick: 'q',
    animFail: false,
    engine: { fail: false },
  } as unknown as Rig;

  const board = new Proxy(
    {
      onSquareClick: (cb: (sq: Square) => void) => (clickCb = cb),
      animateMove: () =>
        new Promise<void>((res, rej) => setTimeout(() => (rig.animFail ? rej(new Error('anim failed')) : res()), ANIM_MS)),
      playCheckmate: () => new Promise<void>((res) => setTimeout(res, ANIM_MS * 3)),
      introReady: () => Promise.resolve(),
      playIntro: () => Promise.resolve(),
    } as Partial<BoardView>,
    { get: (t, k) => (k in t ? (t as any)[k] : () => {}) },
  ) as BoardView;

  const hud = new Proxy(
    {
      showMenu: () => new Promise<MenuChoice>((res) => (menuResolve = res)),
      onCoachAction: (cb: (a: CoachAction) => void) => (coachCb = cb),
      onMenu: (cb: () => void) => (menuCb = cb),
      onUndo: (cb: () => void) => (undoCb = cb),
      introMode: () => 'never',
      setCoach: (s: CoachState | null) => (rig.coachState = s),
      showLessonIntro: () => new Promise<void>((res) => (introResolve = res)),
      showLessonDone: (title: string) =>
        new Promise<'next' | 'replay' | 'menu'>((resolve) => {
          rig.done = { title, resolve };
        }),
      showGameOver: () =>
        new Promise<'rematch' | 'menu'>((resolve) => {
          rig.gameOver = { resolve };
        }),
      choosePromotion: () => Promise.resolve(rig.promoPick),
      showGuide: () => Promise.resolve(),
      showMessage: () => Promise.resolve(),
    } as Partial<Hud>,
    { get: (t, k) => (k in t ? (t as any)[k] : () => {}) },
  ) as Hud;

  // A tiny "AI": plays the first legal move it finds.
  const engine: Engine = {
    think: async (req) => {
      if (rig.engine.fail) throw new Error('engine crashed');
      const { Game } = await import('../core/game');
      const g = new Game(req.fen);
      for (const u of req.history) g.moveUci(u);
      for (const sq of ALL_SQUARES) {
        const p = g.pieceAt(sq);
        if (!p || p.color !== g.turn) continue;
        const t = g.legalTargets(sq)[0];
        if (t) return { move: sq + t.square + (g.isPromotion(sq, t.square) ? 'q' : '') } as any;
      }
      throw new Error('no moves');
    },
    cancel: () => {},
  } as Engine;

  const ctl = new Controller(board, hud, engine);
  Object.assign(rig, {
    ctl,
    c: ctl as any,
    click: (sq: Square) => clickCb(sq),
    coach: (a: CoachAction) => coachCb(a),
    menuBtn: () => menuCb(),
    undoBtn: () => undoCb(),
    menuOpen: () => menuResolve !== null,
    introOpen: () => introResolve !== null,
    async pickMenu(choice: Partial<MenuChoice>) {
      const r = menuResolve!;
      menuResolve = null;
      r({ mode: 'learn', autoRotate: true, fights: 'full', ...choice });
      await tick();
    },
    async passIntro() {
      const r = introResolve!;
      introResolve = null;
      r();
      await tick(10_000); // setup moves
    },
  });
  void ctl.start();
  return rig;
}

/** Click from → to (promotion piece comes from rig.promoPick). */
async function play(rig: Rig, uci: string): Promise<void> {
  if (uci.length > 4) rig.promoPick = uci[4] as PieceType;
  rig.click(uci.slice(0, 2));
  rig.click(uci.slice(2, 4));
  await tick();
}

/** The student can act: lesson idle, nothing animating, their turn, and the step's move is legal. */
function expectReady(rig: Rig, lesson: Lesson, step: number): void {
  const run = rig.c.lesson;
  expect(run, 'lesson running').not.toBeNull();
  expect(run.lesson.id).toBe(lesson.id);
  expect(run.step, 'on the expected step').toBe(step);
  expect(run.busy, 'lesson not busy').toBe(false);
  expect(rig.c.animating, 'not animating').toBe(false);
  expect(rig.c.game.turn, "student's turn").toBe(lesson.side);
  const uci = lesson.steps[step].accept[0];
  expect(rig.c.game.legalTargets(uci.slice(0, 2)).some((t: any) => t.square === uci.slice(2, 4)), `${uci} playable`).toBe(true);
}

async function startLesson(rig: Rig, lesson: Lesson): Promise<void> {
  await rig.pickMenu({ mode: 'learn', lesson: lesson.id });
  expect(rig.introOpen()).toBe(true);
  await rig.passIntro();
}

/** Play the lesson out from `fromStep` and expect the lesson-complete card. */
async function finish(rig: Rig, lesson: Lesson, fromStep = 0): Promise<void> {
  for (let i = fromStep; i < lesson.steps.length; i++) {
    expectReady(rig, lesson, i);
    await play(rig, lesson.steps[i].accept[0]);
    await tick(10_000);
  }
  expect(rig.done?.title, `${lesson.id}: lesson-complete card`).toBe(lesson.title);
}

/** Every legal move for the side to move, as UCI (all promotion pieces). */
function legalMoves(rig: Rig): string[] {
  const g = rig.c.game;
  const out: string[] = [];
  for (const sq of ALL_SQUARES) {
    const p = g.pieceAt(sq);
    if (!p || p.color !== g.turn) continue;
    for (const t of g.legalTargets(sq)) {
      if (g.isPromotion(sq, t.square)) for (const pr of 'qrbn') out.push(sq + t.square + pr);
      else out.push(sq + t.square);
    }
  }
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { search: '?intro=0' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('training: no softlocks', () => {
  for (const lesson of LESSONS) {
    describe(lesson.id, () => {
      it('plays straight through', async () => {
        const rig = makeRig();
        await tick();
        await startLesson(rig, lesson);
        await finish(rig, lesson);
      });

      it('survives every wrong move at every step (and spamming them)', async () => {
        const rig = makeRig();
        await tick();
        await startLesson(rig, lesson);
        for (let i = 0; i < lesson.steps.length; i++) {
          expectReady(rig, lesson, i);
          const fen = rig.c.game.fen();
          const wrong = legalMoves(rig).filter((u) => !lesson.steps[i].accept.includes(u));
          for (const u of wrong) {
            await play(rig, u); // no waiting between attempts
            expect(rig.c.game.fen(), `${u} taken back`).toBe(fen);
          }
          await tick(5_000);
          expectReady(rig, lesson, i);
          await play(rig, lesson.steps[i].accept[0]);
          await tick(10_000);
        }
        expect(rig.done?.title).toBe(lesson.title);
      });

      it('ignores clicks on every square while moves animate', async () => {
        const rig = makeRig();
        await tick();
        await startLesson(rig, lesson);
        for (let i = 0; i < lesson.steps.length; i++) {
          expectReady(rig, lesson, i);
          await play(rig, lesson.steps[i].accept[0]);
          // Hammer the board through the animation, reply pause and reply (stop once it's the student's go again,
          // or the spam would play the next step's move itself).
          for (let t = 0; t < 40 && (rig.c.lesson?.busy || rig.c.animating); t++) {
            for (const sq of ALL_SQUARES) rig.click(sq);
            await tick(100);
          }
          await tick(10_000);
        }
        expect(rig.done?.title).toBe(lesson.title);
      });

      it('hint works at every step, also after a wrong move', async () => {
        const rig = makeRig();
        await tick();
        await startLesson(rig, lesson);
        for (let i = 0; i < lesson.steps.length; i++) {
          expectReady(rig, lesson, i);
          const wrong = legalMoves(rig).find((u) => !lesson.steps[i].accept.includes(u));
          if (wrong) await play(rig, wrong);
          rig.coach('hint');
          rig.coach('hint'); // double tap
          const uci = lesson.steps[i].accept[0];
          rig.click(uci.slice(0, 2)); // tapping the hinted piece keeps it selected
          if (uci.length > 4) rig.promoPick = uci[4] as PieceType;
          rig.click(uci.slice(2, 4));
          await tick(10_000);
        }
        expect(rig.done?.title).toBe(lesson.title);
      });

      it('restart at any moment still leads to a finished lesson', async () => {
        // Restart at 0ms, 150ms, 300ms ... after each correct move, across the animation, reply and finish card.
        const total = lesson.steps.length;
        for (let step = 0; step < total; step++) {
          for (let at = 0; at <= 4_000; at += 150) {
            const rig = makeRig();
            await tick();
            await startLesson(rig, lesson);
            for (let i = 0; i < step; i++) {
              await play(rig, lesson.steps[i].accept[0]);
              await tick(10_000);
            }
            await play(rig, lesson.steps[step].accept[0]);
            await tick(at);
            rig.done = null;
            rig.coach('restart');
            await tick();
            expect(rig.introOpen(), `restart @step${step}+${at}ms opens the intro`).toBe(true);
            await rig.passIntro();
            await finish(rig, lesson);
          }
        }
      }, 120_000);

      it('restart while the intro card or setup moves are showing', async () => {
        const rig = makeRig();
        await tick();
        await rig.pickMenu({ mode: 'learn', lesson: lesson.id });
        rig.coach('restart'); // coach card is up behind the intro
        await tick();
        await rig.passIntro();
        await finish(rig, lesson);
      });

      it('menu mid-lesson, then back into the same lesson', async () => {
        const rig = makeRig();
        await tick();
        await startLesson(rig, lesson);
        await play(rig, lesson.steps[0].accept[0]);
        await tick(200);
        rig.menuBtn();
        await tick();
        expect(rig.menuOpen()).toBe(true);
        await tick(10_000); // stale timers from the old run must do nothing
        await startLesson(rig, lesson);
        await finish(rig, lesson);
      });

      it('Rules (guide) mid-step does not block', async () => {
        const rig = makeRig();
        await tick();
        await startLesson(rig, lesson);
        rig.coach('guide');
        await tick();
        await finish(rig, lesson);
      });
    });
  }

  it('Next lesson chains through every lesson', async () => {
    const rig = makeRig();
    await tick();
    await startLesson(rig, LESSONS[0]);
    for (let i = 0; i < LESSONS.length; i++) {
      await finish(rig, LESSONS[i]);
      if (i === LESSONS.length - 1) break;
      const d = rig.done!;
      rig.done = null;
      d.resolve('next');
      await tick();
      await rig.passIntro();
    }
  }, 60_000);

  it('Replay restarts the same lesson cleanly', async () => {
    const rig = makeRig();
    await tick();
    await startLesson(rig, LESSONS[0]);
    await finish(rig, LESSONS[0]);
    const d = rig.done!;
    rig.done = null;
    d.resolve('replay');
    await tick();
    await rig.passIntro();
    await finish(rig, LESSONS[0]);
  });
});

describe('animations always finish', () => {
  it('a tween that throws ends instead of jamming the ones behind it', async () => {
    const { Tweener } = await import('../render/tween');
    const tw = new Tweener();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let bad = false;
    let good = false;
    void tw.add(1, () => {
      throw new Error('boom');
    }).then(() => (bad = true));
    void tw.add(1, () => {}).then(() => (good = true));
    for (let t = 0; t <= 1.2; t += 0.1) tw.update(t);
    await Promise.resolve();
    expect({ bad, good, busy: tw.busy }).toEqual({ bad: true, good: true, busy: false });
    err.mockRestore();
  });
});

describe('regular games: no softlocks', () => {
  async function humanCanMove(rig: Rig): Promise<boolean> {
    await tick(10_000);
    return !rig.c.animating && rig.c.isHumanTurn() && !rig.c.game.outcome().over && legalMoves(rig).length > 0;
  }

  it('vs AI: a crashed engine move leaves the player a way on', async () => {
    const rig = makeRig();
    await tick();
    await rig.pickMenu({ mode: 'ai', humanColor: 'w', level: 'easy' });
    rig.engine.fail = true;
    await play(rig, 'e2e4');
    await tick(10_000);
    rig.engine.fail = false;
    expect(await humanCanMove(rig), 'after an AI crash the human can move again').toBe(true);
  });

  it('vs AI as Black: a crashed first AI move leaves the player a way on', async () => {
    const rig = makeRig();
    await tick();
    rig.engine.fail = true;
    await rig.pickMenu({ mode: 'ai', humanColor: 'b', level: 'easy' });
    await tick(10_000);
    rig.engine.fail = false;
    expect(await humanCanMove(rig), 'after an AI crash the human can move again').toBe(true);
  });

  it('a failed move animation does not freeze this or the next game', async () => {
    const rig = makeRig();
    await tick();
    await rig.pickMenu({ mode: 'local' });
    rig.animFail = true;
    await play(rig, 'e2e4');
    await tick(10_000);
    rig.animFail = false;
    const thisGame = await humanCanMove(rig);
    rig.menuBtn();
    await tick();
    await rig.pickMenu({ mode: 'local' });
    await play(rig, 'e2e4');
    await tick(10_000);
    const nextGameMoved = rig.c.game.ply === 1 && !rig.c.animating;
    expect({ thisGame, nextGameMoved }).toEqual({ thisGame: true, nextGameMoved: true });
  });

  it('a failed animation mid-lesson does not freeze the lesson', async () => {
    const lesson = LESSONS.find((l) => l.steps.length > 1)!;
    const rig = makeRig();
    await tick();
    await startLesson(rig, lesson);
    rig.animFail = true;
    await play(rig, lesson.steps[0].accept[0]);
    await tick(10_000);
    rig.animFail = false;
    expectReady(rig, lesson, 1);
  });

  it('undo spam during AI thinking and animation never strands the player', async () => {
    const rig = makeRig();
    await tick();
    await rig.pickMenu({ mode: 'ai', humanColor: 'w', level: 'easy' });
    for (const u of ['e2e4', 'd2d4', 'g1f3']) {
      const moves = legalMoves(rig);
      await play(rig, moves.includes(u) ? u : moves[0]);
      for (let t = 0; t < 20; t++) {
        rig.undoBtn();
        await tick(97);
      }
      expect(await humanCanMove(rig)).toBe(true);
    }
  });

  it('local 2P: every opening move by both sides, then menu and rematch', async () => {
    const rig = makeRig();
    await tick();
    await rig.pickMenu({ mode: 'local' });
    for (const u of legalMoves(rig)) {
      await play(rig, u);
      await tick(2_000);
      expect(rig.c.game.ply).toBe(1);
      rig.undoBtn();
      await tick();
      expect(rig.c.game.ply).toBe(0);
    }
  });
});
