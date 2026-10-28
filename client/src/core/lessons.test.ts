import { describe, expect, it } from 'vitest';
import { Game } from './game';
import { LESSON_GROUPS, LESSONS, lessonText } from './lessons';

/** Lessons whose last move must deliver checkmate. */
const MATES = new Set(['back-rank', 'scholars-mate', 'fools-mate', 'smothered']);

describe('training lessons', () => {
  it('has unique ids in known groups and at least 10 battle tactics', () => {
    const ids = LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(LESSON_GROUPS.map((g) => g.id));
    for (const l of LESSONS) expect(groups.has(l.group)).toBe(true);
    expect(LESSONS.filter((l) => l.group === 'moves').length).toBeGreaterThanOrEqual(10);
  });

  for (const lesson of LESSONS) {
    it(`${lesson.id}: every scripted move is legal and the lesson ends as taught`, () => {
      const g = new Game(lesson.fen);
      for (const uci of lesson.setup ?? []) expect(g.moveUci(uci), `setup ${uci}`).not.toBeNull();
      lesson.steps.forEach((step, i) => {
        const last = i === lesson.steps.length - 1;
        expect(g.turn, `step ${i}: student to move`).toBe(lesson.side);
        expect(step.accept.length).toBeGreaterThan(0);
        // Every accepted alternative must be legal here.
        for (const uci of step.accept) {
          expect(g.moveUci(uci), `step ${i}: ${uci}`).not.toBeNull();
          g.undo();
        }
        g.moveUci(step.accept[0]);
        if (last) {
          expect(step.reply, 'the last step has no reply').toBeUndefined();
        } else {
          expect(step.reply, `step ${i} needs a reply`).toBeDefined();
          expect(g.moveUci(step.reply!), `step ${i} reply ${step.reply}`).not.toBeNull();
        }
      });
      const outcome = g.outcome();
      if (MATES.has(lesson.id)) expect(outcome).toEqual({ over: true, reason: 'checkmate', winner: lesson.side });
      // Lessons end before any game-over screen, so a bare-kings draw is fine; a surprise mate or stalemate is not.
      else expect(outcome.over && outcome.reason !== 'insufficient').toBe(false);
    });
  }

  it('fills piece-name tokens and leaves none behind', () => {
    expect(lessonText('Move your {w.n}!')).toBe('Move your Jetpack Baby!');
    for (const l of LESSONS) {
      const texts = [l.title, l.summary, l.intro, l.done, ...l.steps.flatMap((s) => [s.say, s.praise ?? '', s.wrong ?? ''])];
      for (const t of texts) expect(lessonText(t)).not.toMatch(/[{}]/);
    }
  });
});
