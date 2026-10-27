// Placeholder music: a toy-box march (snare, kick, glockenspiel, bass) sequenced from synth layers.
// 'menu' is the full tune; 'battle' drops the melody so it sits under the game.
import type { Layer } from './cues';

export type Track = 'menu' | 'battle';

const BPM = 112;
/** One sixteenth note, in seconds. */
export const STEP = 60 / BPM / 4;
const BARS = 4;
export const LOOP_STEPS = BARS * 16;

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

// Melody in eighth notes (8 per bar), MIDI numbers; 0 = rest.
const MELODY = [
  [67, 72, 72, 76, 79, 0, 76, 72],
  [74, 0, 71, 0, 67, 0, 0, 0],
  [69, 72, 77, 0, 76, 74, 72, 0],
  [74, 0, 67, 0, 72, 0, 0, 0],
].flat();
// Bass in quarter notes (4 per bar).
const BASS = [
  [48, 43, 48, 43],
  [43, 50, 43, 50],
  [41, 48, 41, 48],
  [43, 50, 48, 48],
].flat();

const kick: Layer[] = [{ wave: 'sine', f: [120, 45], d: 0.15, v: 0.6 }];
const snare = (v: number): Layer[] => [
  { wave: 'noise', f: [1500], d: 0.12, v, filter: 'highpass' },
  { wave: 'triangle', f: [190], d: 0.05, v: v * 0.5 },
];
const glock = (f: number): Layer[] => [
  { wave: 'sine', f: [f], d: 0.5, v: 0.16 },
  { wave: 'sine', f: [f * 4], d: 0.08, v: 0.05 },
];
const bass = (f: number): Layer[] => [{ wave: 'triangle', f: [f], d: STEP * 3.5, v: 0.28, a: 0.01 }];

/** The layers to start on sixteenth `step` (0..LOOP_STEPS-1) of `track`. */
export function stepLayers(track: Track, step: number): Layer[] {
  const out: Layer[] = [];
  const inBar = step % 16;
  const lastBar = step >= LOOP_STEPS - 16;
  if (inBar === 0 || inBar === 8) out.push(...kick);
  if (inBar === 4 || inBar === 12) out.push(...snare(0.3));
  // March roll into the top of the loop.
  if (lastBar && inBar >= 13) out.push(...snare(0.14));
  if (inBar % 4 === 0) out.push(...bass(hz(BASS[step / 4])));
  if (track === 'menu' && step % 2 === 0) {
    const note = MELODY[step / 2];
    if (note) out.push(...glock(hz(note)));
  }
  return out;
}
