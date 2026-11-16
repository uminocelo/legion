import { describe, expect, it } from 'vitest';
import { ARCHETYPES, BASE_STATS, computePlayerStats } from './stats.js';

describe('computePlayerStats', () => {
  it('level 1 equals the base table', () => {
    for (const a of ARCHETYPES) expect(computePlayerStats(a, 1)).toEqual(BASE_STATS[a]);
  });

  it('applies per-level growth', () => {
    expect(computePlayerStats('Tanque', 3)).toEqual({ hp: 146, atk: 10, def: 15, spd: 7, foc: 8 });
    expect(computePlayerStats('Velocista', 2).spd).toBe(15);
    expect(computePlayerStats('Velocista', 3).spd).toBe(16);
  });

  it('rejects invalid levels', () => {
    expect(() => computePlayerStats('Tanque', 0)).toThrow(RangeError);
    expect(() => computePlayerStats('Tanque', 1.5)).toThrow(RangeError);
  });
});
