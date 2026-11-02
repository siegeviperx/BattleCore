import { describe, expect, it } from 'vitest';
import { ATTACKS, KNOCKOUTS } from '../fight/moves';
import { PACKS, PACK_LIST, PIECE_TYPES, armiesFor, army, getMatchup, loadPack, onMatchupChange, parseSlot, setMatchup, validMatchup } from './index';
import { lessonText } from '../core/lessons';

describe('piece packs', () => {
  it('starts with the original matchup', () => {
    expect(army('w').id).toBe('babies');
    expect(army('b').id).toBe('dinos');
  });

  for (const pack of Object.values(PACKS)) {
    describe(pack.id, () => {
      for (const t of PIECE_TYPES) {
        it(`${t}: fight moves exist in the move library`, () => {
          const p = pack.pieces[t];
          expect(Object.keys(ATTACKS)).toContain(p.attack.kind);
          expect(Object.keys(KNOCKOUTS)).toContain(p.knockout.kind);
        });
      }
    });
  }

  it('lists the original two armies first in the picker', () => {
    expect(PACK_LIST.slice(0, 2).map((p) => p.id)).toEqual(['babies', 'dinos']);
    expect(PACK_LIST.map((p) => p.id)).toContain('dragons');
    for (const p of PACK_LIST) expect(p.portrait).toBeTruthy();
  });

  it('falls back to the default armies for unknown or missing ids', () => {
    expect(validMatchup({ w: 'dragons', b: 'nope' })).toEqual({ w: 'dragons', b: 'dinos' });
    expect(validMatchup(null)).toEqual({ w: 'babies', b: 'dinos' });
  });

  it('a mirror match fields a darker Shadow army on the black side', () => {
    const a = armiesFor({ w: 'dragons', b: 'dragons' });
    expect(a.w.shadow).toBe(false);
    expect(a.b.shadow).toBe(true);
    expect(a.b.name).toBe('Shadow Dragon Clans');
    expect(a.b.key).not.toBe(a.w.key);
    expect(a.b.colors.primary).not.toBe(a.w.colors.primary);
    expect(armiesFor({ w: 'dragons', b: 'dinos' }).b.shadow).toBe(false);
  });

  it('switching armies notifies listeners and renames lesson pieces', () => {
    let calls = 0;
    onMatchupChange(() => calls++);
    setMatchup({ w: 'dragons', b: 'babies' });
    expect(getMatchup()).toEqual({ w: 'dragons', b: 'babies' });
    expect(army('w').id).toBe('dragons');
    expect(lessonText('{w.k} and the {b} vs the {w.army}')).toBe('Elder Wyrm and the Babies vs the Dragon Clans');
    setMatchup({ w: 'dragons', b: 'babies' }); // no change, no call
    expect(calls).toBe(1);
    setMatchup({ w: 'babies', b: 'dinos' });
  });

  it('names look slots', () => {
    expect(parseSlot('k')).toEqual({ type: 'k', look: 0 });
    expect(parseSlot('p3')).toEqual({ type: 'p', look: 2 });
    expect(parseSlot('x')).toBeNull();
    expect(parseSlot('k1')).toBeNull();
  });

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
    it('fight moves must exist', () => expect(load((f) => (f.pieces.k.attack.kind = 'laser'))).toThrow(/attack "laser"/));
    it('referenced files must exist', () =>
      expect(load((f) => ((f.pieces as Record<string, { looks: { model?: string }[] }>).k.looks[0].model = 'models/k.glb'))).toThrow(/not found/));
  });
});
