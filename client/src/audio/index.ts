// Sound effects and music on the Web Audio API. Anything in the game calls `sfx('name')`; the cue recipes live in
// cues.ts. Browsers keep audio locked until the first tap or key press, so sounds before that are dropped.
import { CUES, FILES, type CueName, type Layer } from './cues';
import { LOOP_STEPS, MUSIC_FILES, STEP, SYNTH_TRACKS, stepLayers, type Track } from './music';

export type { CueName } from './cues';
export type { Track } from './music';

/** What plays: music and effects, effects only, or nothing. */
export type SoundMode = 'all' | 'sfx' | 'off';

interface Settings {
  mode: SoundMode;
  /** Quick toggle from the HUD speaker button; overrides the mode without forgetting it. */
  muted: boolean;
}

const STORAGE_KEY = 'battlecore.audio.v1';
const SFX_LEVEL = 0.9;
const MUSIC_LEVEL = 0.45;
/** The synth march is louder than the mastered tracks, so it gets less of the music bus. */
const SYNTH_MUSIC_LEVEL = 0.6;
/** The same cue retriggered faster than this is skipped (a flock of landings shouldn't stack into a roar). */
const MIN_REPEAT_S = 0.03;
const LOOKAHEAD_S = 0.15;

export interface PlayOptions {
  /** Volume multiplier. */
  vol?: number;
  /** Pitch multiplier. */
  rate?: number;
  /** Start this many seconds from now. */
  delay?: number;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private settings = loadSettings();
  private lastPlayed = new Map<CueName, number>();
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private listeners: (() => void)[] = [];
  /** Dev switch (sound board): false plays every cue's synth recipe even when a recording exists. */
  useFiles = true;

  private track: Track | null = null;
  /** The streaming element for the current track (null while the synth march or silence plays). */
  private current: { el: HTMLAudioElement; gain: GainNode } | null = null;
  private elements = new Map<Track, { el: HTMLAudioElement; gain: GainNode }>();
  private step = 0;
  private nextStepAt = 0;

  constructor() {
    if (typeof window === 'undefined') return; // unit tests run without a browser
    const unlock = (): void => {
      this.unlock();
      if (this.ctx?.state === 'running') {
        for (const e of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(e, unlock, true);
      }
    };
    for (const e of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(e, unlock, true);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) {
        void this.ctx.suspend();
        this.current?.el.pause();
      } else {
        void this.ctx.resume();
        if (this.current && !this.current.el.ended) void this.current.el.play().catch(() => {});
      }
    });
  }

  get mode(): SoundMode {
    return this.settings.mode;
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  setMode(mode: SoundMode): void {
    this.settings.mode = mode;
    this.changed();
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    this.changed();
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  play(name: CueName, o: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.settings.muted || this.settings.mode === 'off') return;
    const at = ctx.currentTime + (o.delay ?? 0);
    const last = this.lastPlayed.get(name);
    if (last !== undefined && Math.abs(at - last) < MIN_REPEAT_S) return;
    this.lastPlayed.set(name, at);
    const cue = CUES[name] as { layers: Layer[]; jitter?: number };
    const rate = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (cue.jitter ?? 0));
    const vol = o.vol ?? 1;
    const file = this.useFiles ? FILES[name] : undefined;
    if (file) {
      const path = file.files[Math.floor(Math.random() * file.files.length)];
      void this.load(`${import.meta.env.BASE_URL}${path}`).then((buf) => {
        if (buf) this.playBuffer(buf, at, rate * (file.rate ?? 1), vol * (file.vol ?? 1), file.maxDur);
        else this.playLayers(cue.layers, at, this.sfxBus, rate, vol);
      });
      return;
    }
    this.playLayers(cue.layers, at, this.sfxBus, rate, vol);
  }

  /** Play any sound file by URL (dev sound board, for auditioning). */
  playUrl(url: string): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    void this.load(url).then((buf) => buf && this.playBuffer(buf, ctx.currentTime, 1, 1));
  }

  /** Switch the background music (null = silence), fading the old track out over `fade` seconds. */
  music(track: Track | null, fade = 0.5): void {
    if (track === this.track) return;
    this.track = track;
    if (this.ctx?.state === 'running') this.startTrack(fade);
  }

  private startTrack(fade: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const old = this.current;
    if (old) {
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + fade);
      window.setTimeout(() => this.current !== old && old.el.pause(), fade * 1000 + 50);
    }
    this.current = null;
    this.step = 0;
    this.nextStepAt = t + 0.05;
    if (!this.track || !this.useFiles) return;
    const next = this.element(this.track);
    next.el.currentTime = 0;
    next.gain.gain.cancelScheduledValues(t);
    next.gain.gain.setValueAtTime(0, t);
    next.gain.gain.linearRampToValueAtTime(1, t + 0.3);
    this.current = next;
    if (!document.hidden) void next.el.play().catch((err) => console.warn('Music failed to play:', err));
  }

  private element(track: Track): { el: HTMLAudioElement; gain: GainNode } {
    let e = this.elements.get(track);
    if (!e) {
      const { file, loop } = MUSIC_FILES[track];
      const el = new Audio(`${import.meta.env.BASE_URL}${file}`);
      el.loop = loop;
      el.preload = 'auto';
      const gain = this.ctx!.createGain();
      this.ctx!.createMediaElementSource(el).connect(gain).connect(this.musicBus);
      e = { el, gain };
      this.elements.set(track, e);
    }
    return e;
  }

  private unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.connect(comp);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.connect(this.master);
      this.noise = whiteNoise(ctx);
      this.applyLevels();
      window.setInterval(() => this.scheduleMusic(), 40);
    }
    if (this.ctx.state === 'suspended' && !document.hidden) {
      void this.ctx.resume().then(() => {
        if (this.ctx && !this.current) this.startTrack(0);
      });
    }
  }

  private changed(): void {
    saveSettings(this.settings);
    this.applyLevels();
    for (const cb of this.listeners) cb();
  }

  private applyLevels(): void {
    if (!this.ctx) return;
    const { mode, muted } = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(muted ? 0 : 1, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(mode === 'off' ? 0 : SFX_LEVEL, t, 0.03);
    this.musicBus.gain.setTargetAtTime(mode === 'all' ? MUSIC_LEVEL : 0, t, 0.03);
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.track || this.current || !SYNTH_TRACKS.has(this.track)) return;
    // Silent music keeps its place in the loop without scheduling notes.
    const audible = this.settings.mode === 'all' && !this.settings.muted;
    if (this.nextStepAt < ctx.currentTime) this.nextStepAt = ctx.currentTime + 0.02;
    while (this.nextStepAt < ctx.currentTime + LOOKAHEAD_S) {
      if (audible) this.playLayers(stepLayers(this.track, this.step), this.nextStepAt, this.musicBus, 1, SYNTH_MUSIC_LEVEL);
      this.nextStepAt += STEP;
      this.step = (this.step + 1) % LOOP_STEPS;
    }
  }

  private playLayers(layers: Layer[], at: number, out: AudioNode, rate: number, vol: number): void {
    for (const l of layers) this.voice(l, at, out, rate, vol);
  }

  private voice(l: Layer, at: number, out: AudioNode, rate: number, vol: number): void {
    const ctx = this.ctx!;
    const t0 = at + (l.t ?? 0);
    const end = t0 + l.d;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, (l.v ?? 0.5) * vol), t0 + Math.min(l.a ?? 0.004, l.d * 0.5));
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(out);

    let src: AudioScheduledSourceNode;
    let freq: AudioParam;
    if (l.wave === 'noise') {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      n.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = l.filter ?? 'bandpass';
      filter.Q.value = l.q ?? 1;
      n.connect(filter).connect(env);
      freq = filter.frequency;
      src = n;
      n.start(t0, Math.random() * this.noise.duration);
    } else {
      const osc = ctx.createOscillator();
      osc.type = l.wave;
      if (l.lp) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = l.lp;
        osc.connect(lp).connect(env);
      } else {
        osc.connect(env);
      }
      freq = osc.frequency;
      src = osc;
      osc.start(t0);
    }
    const f0 = l.f[0] * rate;
    const f1 = (l.f[1] ?? l.f[0]) * rate;
    freq.setValueAtTime(f0, t0);
    if (f1 !== f0) freq.exponentialRampToValueAtTime(f1, end);
    src.stop(end + 0.02);
    src.onended = () => env.disconnect();
  }

  private playBuffer(buf: AudioBuffer, at: number, rate: number, vol: number, maxDur?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.sfxBus);
    const start = Math.max(at, ctx.currentTime);
    src.start(start);
    if (maxDur !== undefined && maxDur < buf.duration / rate) {
      const fade = Math.min(0.15, maxDur / 2);
      g.gain.setValueAtTime(vol, start + maxDur - fade);
      g.gain.linearRampToValueAtTime(0, start + maxDur);
      src.stop(start + maxDur);
    }
    src.onended = () => g.disconnect();
  }

  private load(url: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${url}`))))
        .then((data) => this.ctx!.decodeAudioData(data))
        .catch((err) => {
          console.warn('Sound failed to load, using the synth version:', err);
          return null;
        });
      this.buffers.set(url, p);
    }
    return p;
  }
}

function whiteNoise(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function loadSettings(): Settings {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>;
    return {
      mode: p.mode === 'sfx' || p.mode === 'off' ? p.mode : 'all',
      muted: p.muted === true,
    };
  } catch {
    return { mode: 'all', muted: false };
  }
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}

export const audio = new AudioEngine();

/** Play a sound effect by name. */
export const sfx = (name: CueName, o?: PlayOptions): void => audio.play(name, o);
