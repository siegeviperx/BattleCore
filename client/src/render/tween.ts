// Tiny tween helper driven by the render loop (no libs).

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

interface TweenItem {
  start: number;
  duration: number;
  update: (t: number) => void;
  ease: Ease;
  started: boolean;
  resolve: () => void;
}

export interface TweenOptions {
  /** Delay in seconds before the tween starts. */
  delay?: number;
  ease?: Ease;
}

export class Tweener {
  private items: TweenItem[] = [];
  /** Current clock (seconds), advanced by `update`. */
  private now = 0;

  /** Run `update(easedT)` for `duration` seconds. Resolves after the final update(1). */
  add(duration: number, update: (t: number) => void, opts: TweenOptions = {}): Promise<void> {
    return new Promise((resolve) => {
      this.items.push({
        start: this.now + (opts.delay ?? 0),
        duration: Math.max(1e-4, duration),
        update,
        ease: opts.ease ?? ease.linear,
        started: false,
        resolve,
      });
    });
  }

  wait(seconds: number): Promise<void> {
    return this.add(seconds, () => {}, {});
  }

  update(nowSec: number): void {
    this.now = nowSec;
    if (this.items.length === 0) return;
    const done: TweenItem[] = [];
    // Copy: callbacks may add new tweens.
    for (const it of this.items.slice()) {
      if (nowSec < it.start) continue;
      it.started = true;
      const raw = Math.min(1, (nowSec - it.start) / it.duration);
      it.update(it.ease(raw));
      if (raw >= 1) done.push(it);
    }
    if (done.length) {
      this.items = this.items.filter((i) => !done.includes(i));
      for (const d of done) d.resolve();
    }
  }

  /** Drop all running tweens (their promises resolve immediately, without final updates). */
  clear(): void {
    const items = this.items;
    this.items = [];
    for (const it of items) it.resolve();
  }

  get busy(): boolean {
    return this.items.length > 0;
  }
}
