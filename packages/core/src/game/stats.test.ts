import { describe, expect, it } from 'vitest';
import { ProviderRegistry } from '../registries/read-models.js';
import { ARCHETYPES, BASE_STATS, computePlayerStats, playerStats } from './stats.js';

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

describe('playerStats (gear)', () => {
  it('without a bonus equals computePlayerStats', () => {
    for (const a of ARCHETYPES) expect(playerStats(a, 4)).toEqual(computePlayerStats(a, 4));
    expect(playerStats('Tanque', 3, {}, 2)).toEqual(computePlayerStats('Tanque', 3));
  });

  it('adds the bonus and caps the total per stat (hp at cap × 8)', () => {
    const base = computePlayerStats('Elemental', 2);
    expect(playerStats('Elemental', 2, { atk: 1, hp: 8 })).toEqual({
      ...base,
      atk: base.atk + 1,
      hp: base.hp + 8,
    });
    expect(playerStats('Elemental', 2, { hp: 40, atk: 5, def: 2, spd: 3, foc: 6 }, 2)).toEqual({
      hp: base.hp + 16,
      atk: base.atk + 2,
      def: base.def + 2,
      spd: base.spd + 2,
      foc: base.foc + 2,
    });
    expect(playerStats('Elemental', 2, { atk: 5 }, 3).atk).toBe(base.atk + 3);
  });

  it('cap 0 makes gear cosmetic; negatives and fractions count as 0', () => {
    const base = computePlayerStats('Velocista', 5);
    expect(playerStats('Velocista', 5, { hp: 16, atk: 2 }, 0)).toEqual(base);
    expect(playerStats('Velocista', 5, { atk: -4, def: 1.9 }, 2)).toEqual({ ...base, def: base.def + 1 });
    expect(playerStats('Velocista', 5, { atk: 2 }, -1)).toEqual(base);
  });
});

describe('gear read model', () => {
  it('without a provider: zero bonus, nothing equipped, default cap', async () => {
    const read = new ProviderRegistry().readModels();
    expect(await read.gear.bonusOf('m1')).toEqual({ hp: 0, atk: 0, def: 0, spd: 0, foc: 0 });
    expect(await read.gear.equippedOf('m1')).toEqual([]);
    expect(read.gear.statCap()).toBe(2);
  });

  it('delegates to the provider registered later', async () => {
    const reg = new ProviderRegistry();
    const read = reg.readModels();
    reg.provide(
      'gear',
      {
        bonusOf: async () => ({ hp: 8, atk: 1, def: 0, spd: 0, foc: 0 }),
        equippedOf: async () => [
          { slot: 'traje', itemId: 'traje-tatico', name: { 'pt-BR': 'Traje tático' } },
        ],
        statCap: () => 0,
      },
      'jarvis',
    );
    expect((await read.gear.bonusOf('m1')).hp).toBe(8);
    expect(await read.gear.equippedOf('m1')).toHaveLength(1);
    expect(read.gear.statCap()).toBe(0);
  });
});
