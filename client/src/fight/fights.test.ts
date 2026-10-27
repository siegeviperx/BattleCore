import { describe, expect, it } from 'vitest';
import choreo from '../data/fights.json';
import { ATTACKS, KNOCKOUTS } from './moves';

describe('fight choreography data', () => {
  for (const color of ['w', 'b'] as const) {
    for (const type of ['p', 'n', 'b', 'r', 'q', 'k'] as const) {
      it(`${color}${type} has a known attack and knockout`, () => {
        const spec = choreo.pieces[color][type];
        expect(Object.keys(ATTACKS)).toContain(spec.attack.kind);
        expect(Object.keys(KNOCKOUTS)).toContain(spec.knockout.kind);
      });
    }
  }
});
