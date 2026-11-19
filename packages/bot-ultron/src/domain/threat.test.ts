import { describe, expect, it } from 'vitest';
import { invasionSize, nextWaveHp, threatBand, tickThreat } from './threat.js';

const cfg = { idleRise: 10, activeFall: 5, activeActions: 3 };

describe('threat domain', () => {
  it('maps the level to bands and invasion sizes at 34 and 67', () => {
    expect([0, 33, 34, 66, 67, 100].map(threatBand)).toEqual([
      'low',
      'low',
      'medium',
      'medium',
      'high',
      'high',
    ]);
    expect(invasionSize(33)).toEqual({ waves: 1, difficulty: 'normal' });
    expect(invasionSize(34)).toEqual({ waves: 2, difficulty: 'normal' });
    expect(invasionSize(66)).toEqual({ waves: 2, difficulty: 'normal' });
    expect(invasionSize(67)).toEqual({ waves: 3, difficulty: 'dificil' });
  });

  it('rises on quiet days, falls on active ones and stays within 0–100', () => {
    expect(tickThreat(20, 2, cfg)).toBe(30);
    expect(tickThreat(20, 3, cfg)).toBe(15);
    expect(tickThreat(95, 0, cfg)).toBe(100);
    expect(tickThreat(3, 10, cfg)).toBe(0);
  });

  it('grows each wave from the previous one', () => {
    expect(nextWaveHp(2400, 0.25)).toBe(3000);
    expect(nextWaveHp(3000, 0.25)).toBe(3750);
    expect(nextWaveHp(10, 0)).toBe(10);
  });
});
