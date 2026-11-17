import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defaultUltronConfig } from '../config.js';
import type { EnemyTemplate } from '../content.js';
import { adaptiveMultiplier, buildEnemies, composition, scaleStats } from './scaling.js';

const cfg = defaultUltronConfig().scaling;
const t = (id: string, tier: EnemyTemplate['tier'], minLevel = 1): EnemyTemplate => ({
  id,
  name: id,
  tier,
  minLevel,
  base: { hp: 60, atk: 8, def: 5, spd: 9, foc: 6 },
  powerCooldownMax: 3,
  tauntKeys: [],
});
const templates = [
  t('m-a', 'minion'),
  t('m-b', 'minion'),
  t('m-late', 'minion', 7),
  t('e-a', 'elite', 5),
  t('b', 'boss'),
];
const input = {
  encounterId: 'enc',
  partyLevel: 5,
  partySize: 2,
  difficulty: 'normal' as const,
  templates,
  seed: 99,
};

describe('scaling', () => {
  it('applies the stat formula and difficulty multipliers', () => {
    const base = { hp: 60, atk: 8, def: 5, spd: 9, foc: 6 };
    expect(scaleStats(base, 1, 'normal', cfg)).toEqual(base);
    expect(scaleStats(base, 6, 'normal', cfg)).toEqual({ hp: 90, atk: 12, def: 7, spd: 13, foc: 9 });
    expect(scaleStats(base, 1, 'facil', cfg).hp).toBe(48);
    expect(scaleStats(base, 1, 'dificil', cfg).hp).toBe(75);
    expect(scaleStats(base, 1, 'normal', cfg, 1.1).hp).toBe(66);
    expect(scaleStats({ ...base, hp: 0 }, 1, 'facil', cfg).hp).toBe(1);
  });

  it('follows the composition rules', () => {
    expect(composition(1, 1, 'normal')).toEqual({ minions: 1, elites: 0 });
    expect(composition(4, 3, 'dificil')).toEqual({ minions: 4, elites: 0 });
    expect(composition(5, 2, 'normal')).toEqual({ minions: 2, elites: 1 });
    expect(composition(9, 4, 'facil')).toEqual({ minions: 4, elites: 0 });
    expect(composition(5, 4, 'dificil')).toEqual({ minions: 5, elites: 1 });
  });

  it('only picks templates at or below the party level, minions first then the elite, with stable ids', () => {
    const es = buildEnemies(input, cfg);
    expect(es.map((e) => e.id)).toEqual(['enemy:enc:0', 'enemy:enc:1', 'enemy:enc:2']);
    expect(es.slice(0, 2).every((e) => ['m-a', 'm-b'].includes(e.refId))).toBe(true);
    expect(es[2]?.refId).toBe('e-a');
    expect(es.every((e) => e.level === 5 && e.side === 'enemies' && e.kind === 'enemy')).toBe(true);
    const low = buildEnemies({ ...input, partyLevel: 1, seed: 1 }, cfg);
    expect(low.some((e) => e.refId === 'm-late' || e.refId === 'e-a' || e.refId === 'b')).toBe(false);
  });

  it('same inputs give the same enemies', () => {
    expect(buildEnemies(input, cfg)).toEqual(
      buildEnemies({ ...input, templates: [...templates].reverse() }, cfg),
    );
    const picks = new Set(
      Array.from({ length: 20 }, (_, s) => buildEnemies({ ...input, seed: s }, cfg)[0]?.refId),
    );
    expect(picks.size).toBe(2);
  });

  it('stats are positive integers and never shrink as the level grows (property)', () => {
    const statsArb = fc.record({
      hp: fc.integer({ min: 0, max: 500 }),
      atk: fc.integer({ min: 1, max: 100 }),
      def: fc.integer({ min: 1, max: 100 }),
      spd: fc.integer({ min: 1, max: 100 }),
      foc: fc.integer({ min: 1, max: 100 }),
    });
    fc.assert(
      fc.property(
        statsArb,
        fc.integer({ min: 1, max: 99 }),
        fc.constantFrom('facil' as const, 'normal' as const, 'dificil' as const),
        fc.double({ min: 0.85, max: 1.15, noNaN: true }),
        (base, L, d, a) => {
          const lo = scaleStats(base, L, d, cfg, a);
          const hi = scaleStats(base, L + 1, d, cfg, a);
          for (const k of ['hp', 'atk', 'def', 'spd', 'foc'] as const) {
            expect(Number.isInteger(lo[k]) && lo[k] >= 1).toBe(true);
            expect(hi[k]).toBeGreaterThanOrEqual(lo[k]);
          }
        },
      ),
    );
  });
});

describe('adaptive multiplier', () => {
  const a = { minSample: 10, target: 0.65, maxAdjust: 0.15 };
  it('is 1 below the minimum sample', () => {
    expect(adaptiveMultiplier(Array(9).fill('players'), a)).toBe(1);
    expect(adaptiveMultiplier([], a)).toBe(1);
  });
  it('is clamped to ±maxAdjust and counts draws as half', () => {
    expect(adaptiveMultiplier(Array(10).fill('players'), a)).toBe(1.15);
    expect(adaptiveMultiplier(Array(10).fill('enemies'), a)).toBe(0.85);
    // 6 wins + 2 draws of 10 = 0.7 → 1 + (0.7 - 0.65) * 0.5 = 1.025
    expect(adaptiveMultiplier([...Array(6).fill('players'), 'draw', 'draw', 'enemies', 'enemies'], a)).toBe(
      1.025,
    );
  });
});
