import { describe, expect, it } from 'vitest';
import { BOARDS, activeBoard, hazardAt, loadBoard, type BoardDef } from './index';

const base = (): BoardDef => ({
  id: 'demo',
  name: 'Demo',
  theme: { squares: ['#eeeeee', '#222222'], frame: '#333333', rim: '#444444', trim: '#555555' },
  grid: ['........', '........', '...##...', '..f..f..', '..f..f..', '...##...', '........', '........'],
  hazards: { '#': 'wall', f: 'fire' },
});

describe('boards', () => {
  it('ships the classic board with no hazards', () => {
    expect(activeBoard().id).toBe('classic');
    expect(Object.keys(BOARDS)).toContain('classic');
    expect(activeBoard().grid.every((r) => r === '........')).toBe(true);
  });

  it('reads hazards by square', () => {
    const b = loadBoard('demo', base());
    expect(hazardAt(b, 'd6')).toBe('wall');
    expect(hazardAt(b, 'c5')).toBe('fire');
    expect(hazardAt(b, 'e4')).toBeNull();
    expect(hazardAt(b, 'a1')).toBeNull();
  });

  const broken = (mutate: (b: BoardDef) => void) => {
    const b = base();
    mutate(b);
    return () => loadBoard('demo', b);
  };
  it('refuses a hazard on a starting rank', () => expect(broken((b) => (b.grid[1] = '#.......'))).toThrow(/rank 7 must be clear/));
  it('refuses a lopsided layout', () => expect(broken((b) => (b.grid[2] = '#.......'))).toThrow(/mirror/));
  it('refuses unknown hazards', () => expect(broken((b) => (b.hazards.f = 'lava' as never))).toThrow(/unknown hazard/));
  it('refuses grid characters with no hazard', () => expect(broken((b) => (b.grid[3] = b.grid[4] = '..x..x..'))).toThrow(/isn't in hazards/));
  it('refuses a wrong-sized grid', () => expect(broken((b) => b.grid.pop())).toThrow(/8 rows/));
});
