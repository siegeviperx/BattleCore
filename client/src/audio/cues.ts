// Every sound in the game, by name. Each cue is a short recipe of synth layers (placeholders until real
// recordings land in client/public/assets/audio; a cue listed in FILES plays that file instead).

/** One synth voice: an oscillator or filtered noise with a pitch sweep and a quick attack / exponential decay. */
export interface Layer {
  /** Oscillator wave, or 'noise' for filtered white noise. */
  wave: OscillatorType | 'noise';
  /** Start and end frequency in Hz (oscillator pitch, or the noise filter's cutoff / center). */
  f: [number, number?];
  /** Duration in seconds. */
  d: number;
  /** Start offset in seconds. */
  t?: number;
  /** Peak volume, 0..1. */
  v?: number;
  /** Attack time in seconds. */
  a?: number;
  /** Noise filter type (default bandpass). */
  filter?: BiquadFilterType;
  q?: number;
  /** Optional lowpass on an oscillator, to take the buzz off saws and squares. */
  lp?: number;
}

export interface Cue {
  layers: Layer[];
  /** Random pitch spread (0.1 = ±10%) so repeated cues don't sound identical. */
  jitter?: number;
}

const tone = (wave: OscillatorType, f: [number, number?], d: number, o: Partial<Layer> = {}): Layer => ({ wave, f, d, ...o });
const noise = (f: [number, number?], d: number, o: Partial<Layer> = {}): Layer => ({ wave: 'noise', f, d, ...o });
const notes = (wave: OscillatorType, hz: number[], step: number, d: number, v: number): Layer[] =>
  hz.map((f, i) => tone(wave, [f], i === hz.length - 1 ? d * 2 : d, { t: i * step, v }));

const STAMP: Layer[] = [
  tone('sine', [130, 45], 0.22, { v: 0.9 }),
  noise([900, 300], 0.1, { filter: 'lowpass', v: 0.8 }),
  noise([4000], 0.03, { filter: 'highpass', v: 0.4 }),
];

export const CUES = {
  // --- UI ---
  click: { layers: [tone('square', [900, 600], 0.035, { v: 0.12, lp: 3000 })] },
  select: { layers: [tone('triangle', [520, 780], 0.07, { v: 0.3 })] },
  notify: { layers: notes('sine', [880, 1175], 0.11, 0.18, 0.3) },
  undo: { layers: [noise([2500, 700], 0.2, { q: 2, v: 0.35, a: 0.05 })] },

  // --- Board ---
  /** Paper flutter as a cutout leaves its square. */
  flutter: {
    jitter: 0.15,
    layers: [0, 0.045, 0.09].map((t, i) => noise([3200 - i * 500, 1600], 0.07, { t, q: 1.5, v: 0.22 })),
  },
  /** Paper cutout landing on its base. */
  land: { jitter: 0.1, layers: [tone('sine', [190, 90], 0.08, { v: 0.45 }), noise([1400], 0.05, { filter: 'lowpass', v: 0.4 })] },
  poof: { jitter: 0.1, layers: [noise([2600, 350], 0.38, { filter: 'lowpass', v: 0.55, a: 0.01 })] },
  promote: { layers: notes('sine', [660, 880, 1320, 1760], 0.06, 0.2, 0.25) },
  check: { layers: STAMP },
  mate: { layers: [...STAMP, ...[110, 138.6, 164.8].map((f) => tone('sawtooth', [f], 1.1, { t: 0.08, v: 0.22, a: 0.03, lp: 1100 }))] },
  draw: { layers: [tone('triangle', [440, 415], 0.35, { v: 0.35 }), tone('triangle', [392, 330], 0.6, { t: 0.36, v: 0.35 })] },
  victory: { layers: notes('square', [523, 659, 784, 1047], 0.13, 0.22, 0.16).map((l) => ({ ...l, lp: 2400 })) },
  defeat: { layers: [392, 370, 349, 262].map((f, i) => tone('sawtooth', [f, f * 0.98], i === 3 ? 0.9 : 0.3, { t: i * 0.32, v: 0.25, lp: 900, a: 0.03 })) },

  // --- Fights ---
  /** A cutout inflating into its 3D fighter. */
  pop: { jitter: 0.08, layers: [tone('sine', [280, 950], 0.09, { v: 0.45 }), noise([5000], 0.03, { filter: 'highpass', v: 0.2 })] },
  'shot.dart': { jitter: 0.12, layers: [noise([1800], 0.05, { q: 4, v: 0.7 }), tone('sine', [750, 300], 0.06, { v: 0.4 })] },
  'shot.bullet': { jitter: 0.1, layers: [tone('square', [1500, 280], 0.08, { v: 0.2, lp: 4000 }), noise([6000], 0.03, { filter: 'highpass', v: 0.25 })] },
  'shot.ball': { jitter: 0.08, layers: [tone('sine', [160, 45], 0.32, { v: 0.9 }), noise([700], 0.22, { filter: 'lowpass', v: 0.6 })] },
  'shot.boulder': { layers: [noise([450, 140], 0.4, { q: 1, v: 0.7, a: 0.04 }), tone('sine', [95, 50], 0.32, { v: 0.7 })] },
  'shot.missile': { layers: [tone('sine', [1700, 500], 0.5, { v: 0.16, a: 0.04 }), noise([800], 0.4, { filter: 'lowpass', v: 0.3 })] },
  'shot.bottle': { layers: [tone('sine', [200, 620], 0.14, { v: 0.5 }), tone('triangle', [620, 240], 0.22, { t: 0.11, v: 0.35 })] },
  boom: { jitter: 0.1, layers: [noise([1900, 140], 0.6, { filter: 'lowpass', v: 0.9 }), tone('sine', [115, 35], 0.5, { v: 0.85 })] },
  'hit.light': { jitter: 0.15, layers: [noise([2600], 0.04, { q: 3, v: 0.45 }), tone('triangle', [640, 420], 0.04, { v: 0.3 })] },
  /** Cartoon bonk. */
  'hit.heavy': { jitter: 0.08, layers: [tone('sine', [340, 110], 0.15, { v: 0.9 }), noise([2200], 0.07, { filter: 'lowpass', v: 0.6 })] },
  swoosh: { jitter: 0.12, layers: [noise([500, 2600], 0.26, { q: 1.2, v: 0.4, a: 0.1 })] },
  flame: { layers: [noise([900, 600], 0.75, { filter: 'lowpass', v: 0.5, a: 0.08 }), noise([1300], 0.7, { q: 0.8, v: 0.3, a: 0.1 })] },
  dizzy: { layers: [0, 0.14, 0.28].map((t) => tone('sine', [2100, 2700], 0.08, { t, v: 0.15 })) },
  aim: { layers: [tone('sine', [900, 1800], 0.55, { v: 0.08, a: 0.2 })] },
  thud: { jitter: 0.08, layers: [tone('sine', [120, 50], 0.25, { v: 0.8 }), noise([500], 0.15, { filter: 'lowpass', v: 0.5 })] },
  squish: { layers: [noise([1600, 200], 0.22, { filter: 'lowpass', v: 0.6 }), tone('sine', [220, 60], 0.2, { v: 0.6 })] },
  whee: { layers: [tone('sine', [420, 1250], 0.5, { v: 0.25, a: 0.03 })] },
  /** Dino voice (placeholder: a growl until recorded roars arrive). */
  roar: {
    jitter: 0.1,
    layers: [tone('sawtooth', [120, 70], 0.95, { v: 0.4, a: 0.12, lp: 700 }), noise([420, 260], 0.9, { q: 1.5, v: 0.5, a: 0.15 })],
  },
  /** Baby voice (placeholder: a run of blips until recorded giggles arrive). */
  giggle: { jitter: 0.12, layers: [0, 0.09, 0.18, 0.27, 0.36].map((t, i) => tone('triangle', [900 - i * 40, 1100 - i * 40], 0.06, { t, v: 0.22 - i * 0.03 })) },
  /** Baby battle cry ("Chaaarge!"). */
  cry: { layers: [tone('triangle', [600, 900], 0.2, { v: 0.3 }), tone('triangle', [900, 760], 0.45, { t: 0.18, v: 0.3 })] },

  // --- Intro ---
  stomp: { jitter: 0.06, layers: [tone('sine', [70, 32], 0.45, { v: 1 }), noise([300], 0.3, { filter: 'lowpass', v: 0.6 })] },
  rumble: { layers: [noise([180, 120], 1.2, { filter: 'lowpass', v: 0.6, a: 0.3 })] },
  /** Plastic toy hitting the table. */
  clatter: { jitter: 0.25, layers: [tone('triangle', [2300, 1800], 0.03, { v: 0.3 }), noise([3600], 0.035, { q: 3, v: 0.45 })] },
  sparkle: { jitter: 0.1, layers: notes('sine', [1568, 2093, 2637], 0.05, 0.15, 0.12) },
  squeak: { jitter: 0.1, layers: [tone('sine', [950, 1350], 0.09, { v: 0.18 })] },
  scratch: { layers: [noise([400, 1700], 0.12, { q: 2, v: 0.6 }), noise([1700, 300], 0.2, { t: 0.12, q: 2, v: 0.6 })] },
  /** Gear clicking on during the suit-up montage. */
  snap: { jitter: 0.1, layers: [noise([5000], 0.02, { filter: 'highpass', v: 0.5 }), tone('square', [1800], 0.02, { v: 0.15, lp: 5000 }), tone('triangle', [2600], 0.15, { t: 0.02, v: 0.15 })] },
  sweep: { layers: [noise([300, 3200], 1.6, { q: 1, v: 0.3, a: 0.8 }), tone('sine', [1200, 2400], 1.6, { v: 0.05, a: 0.8 })] },
  'sting.cute': { layers: notes('sine', [1047, 1319, 1568, 1319, 2093], 0.12, 0.18, 0.2) },
  'sting.standoff': {
    layers: [
      ...[98, 147, 196].map((f) => tone('sawtooth', [f], 1.3, { v: 0.2, a: 0.02, lp: 1200 })),
      ...[0, 0.07, 0.14, 0.21].map((t) => noise([3000], 0.07, { t, filter: 'highpass', v: 0.3 })),
    ],
  },
} satisfies Record<string, Cue>;

export type CueName = keyof typeof CUES;

/** Recorded takes for a cue: one is picked at random each time. */
export interface SoundFile {
  /** Paths under client/public. */
  files: string[];
  vol?: number;
  rate?: number;
  /** Cut the recording off after this many seconds, with a short fade. */
  maxDur?: number;
}

/** Kenney CC0 sounds (kenney.nl), by base name; `n` numbered takes, e.g. kenney('click_00', 1, 5). */
const kenney = (base: string, from: number, to: number, o: Omit<SoundFile, 'files'> = {}): SoundFile => ({
  files: Array.from({ length: to - from + 1 }, (_, i) => `assets/audio/kenney/${base}${from + i}.mp3`),
  ...o,
});
const kenneyNamed = (names: string[], o: Omit<SoundFile, 'files'> = {}): SoundFile => ({
  files: names.map((n) => `assets/audio/kenney/${n}.mp3`),
  ...o,
});

/** Recorded sounds that replace a synth cue, by cue name. Cues not listed here use their synth recipe. */
export const FILES: Partial<Record<CueName, SoundFile>> = {
  click: kenney('click_00', 1, 5, { vol: 0.6 }),
  select: kenney('select_00', 1, 4, { vol: 0.7 }),
  notify: kenney('confirmation_00', 1, 1),
  undo: kenney('back_00', 1, 4),
  flutter: kenney('bookFlip', 1, 3, { vol: 0.7 }),
  land: kenney('impactWood_light_00', 0, 4, { vol: 0.6 }),
  promote: kenney('maximize_00', 1, 1),
  check: kenney('bookPlace', 1, 3, { rate: 0.85 }),
  pop: kenney('pluck_00', 1, 2),
  'shot.dart': kenney('laserRetro_00', 0, 4, { vol: 0.5 }),
  'shot.bullet': kenney('laserSmall_00', 0, 4, { vol: 0.5 }),
  boom: kenney('explosionCrunch_00', 0, 4),
  'hit.light': kenney('impactPunch_medium_00', 0, 4),
  'hit.heavy': kenney('impactPunch_heavy_00', 0, 4),
  flame: kenney('thrusterFire_00', 0, 4, { maxDur: 0.9 }),
  thud: kenney('impactSoft_heavy_00', 0, 4),
  squish: kenney('slime_00', 0, 1),
  snap: kenneyNamed(['metalClick', 'metalLatch', 'beltHandle1', 'beltHandle2']),
  clatter: kenney('impactPlate_light_00', 0, 4, { rate: 1.3, vol: 0.6 }),
  stomp: kenney('impactWood_heavy_00', 0, 4, { rate: 0.6 }),
  scratch: kenney('scratch_00', 1, 5),
  sparkle: kenney('glass_00', 1, 6, { vol: 0.6 }),
};
