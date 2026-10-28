import { describe, expect, it } from 'vitest';
import { ATTACKS, KNOCKOUTS } from '../fight/moves';
import { PACKS, PIECE_TYPES, army, loadPack } from './index';

describe('piece packs', () => {
  it('ships the original matchup', () => {
    expect(army('w').id).toBe('babies');
    expect(army('b').id).toBe('dinos');
  });

  for (const pack of Object.values(PACKS)) {
    describe(pack.id, () => {
      for (const t of PIECE_TYPES) {
        it(`${t}: known fight moves, art for every look`, () => {
          const p = pack.pieces[t];
          expect(Object.keys(ATTACKS)).toContain(p.attack.kind);
          expect(Object.keys(KNOCKOUTS)).toContain(p.knockout.kind);
          for (const look of p.looks) expect(look.art).toBeTruthy();
        });
      }
    });
  }

  describe('loadPack refuses broken packs', () => {
    const good = () => ({
      id: 'demo',
      version: 1,
      name: 'Demo Army',
      short: 'Demo',
      colors: { primary: '#112233', secondary: '#445566', base: '#778899', emblem: 'star' },
      credits: [],
      pieces: Object.fromEntries(
        PIECE_TYPES.map((t) => [t, { name: t, icon: '?', attack: { kind: 'burst' }, knockout: { kind: 'topple' }, looks: [{ art: `pieces/${t}.png` }] }]),
      ),
    });
    const urls = Object.fromEntries(PIECE_TYPES.map((t) => [`./demo/pieces/${t}.png`, `/x/${t}.png`]));
    const load = (mutate: (f: ReturnType<typeof good>) => void) => {
      const f = good();
      mutate(f);
      return () => loadPack('demo', f as any, urls);
    };

    it('accepts a complete pack and resolves its files', () => {
      expect(load(() => {})().pieces.k.looks[0]).toEqual({ art: '/x/k.png', model: null, tuning: {} });
    });
    it('id must match the folder', () => expect(load((f) => (f.id = 'other'))).toThrow(/match its folder/));
    it('every piece is required', () => expect(load((f) => delete (f.pieces as Record<string, unknown>).q)).toThrow(/missing piece "q"/));
    it('colors must be hex', () => expect(load((f) => (f.colors.base = 'red'))).toThrow(/colors.base/));
    it('referenced files must exist', () =>
      expect(load((f) => ((f.pieces as Record<string, { looks: { model?: string }[] }>).k.looks[0].model = 'models/k.glb'))).toThrow(/not found/));
  });
});
