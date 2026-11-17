import { localDay } from '@legion/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defaultJarvisConfig, jarvisConfigSchema } from '../config.js';
import { rebuildFromLedger } from '../xp-service.js';
import { advanceStreak, displayedStreak, levelFor, progressBar, rankFor, scoreTrivia } from './xp.js';

const cfg = defaultJarvisConfig();
const score = (o: Partial<Parameters<typeof scoreTrivia>[0]>) =>
  scoreTrivia(
    {
      correct: true,
      expired: false,
      difficulty: 'normal',
      remainingMs: 0,
      limitMs: 20_000,
      earnedToday: 0,
      ...o,
    },
    cfg.trivia,
  );

describe('scoreTrivia', () => {
  it('gives 0 for wrong or expired answers', () => {
    expect(score({ correct: false, remainingMs: 20_000 }).xp).toBe(0);
    expect(score({ expired: true, remainingMs: 20_000 }).xp).toBe(0);
  });
  it('adds base by difficulty and a bounded speed bonus', () => {
    expect(score({ difficulty: 'facil' }).xp).toBe(10);
    expect(score({ difficulty: 'dificil', remainingMs: 20_000 }).xp).toBe(30);
    expect(score({ remainingMs: 10_000 }).xp).toBe(17);
    expect(score({ remainingMs: 3_999 }).xp).toBe(15);
    expect(score({ remainingMs: 99_999 }).xp).toBe(20); // clamped to the limit
    expect(score({ remainingMs: -5 }).xp).toBe(15);
  });
  it('clips at the daily cap and says so', () => {
    expect(score({ earnedToday: 290 })).toEqual({ xp: 10, raw: 15, capped: true });
    expect(score({ earnedToday: 300 })).toEqual({ xp: 0, raw: 15, capped: true });
    expect(score({ earnedToday: 0 }).capped).toBe(false);
  });
});

describe('levels and ranks', () => {
  it.each([
    [0, 1, 'recruta'],
    [49, 1, 'recruta'],
    [50, 2, 'recruta'],
    [199, 2, 'recruta'],
    [200, 3, 'recruta'],
    [499, 4, 'recruta'],
    [500, 4, 'agente'],
    [800, 5, 'agente'],
    [1999, 7, 'agente'],
    [2000, 7, 'veterano'],
    [4050, 10, 'veterano'],
  ] as const)('%i XP → level %i, %s', (xp, level, rank) => {
    expect(levelFor(xp, cfg.levels)).toBe(level);
    expect(rankFor(xp, cfg.ranks)).toBe(rank);
  });
  it('caps the level and treats negative XP as 0', () => {
    expect(levelFor(10_000_000, cfg.levels)).toBe(50);
    expect(levelFor(-30, cfg.levels)).toBe(1);
    expect(progressBar(50, cfg.levels)).toBe('▱▱▱▱▱▱▱▱▱▱');
    expect(progressBar(125, cfg.levels)).toBe('▰▰▰▰▰▱▱▱▱▱');
  });
  it('validates rank thresholds', () => {
    expect(() => jarvisConfigSchema.parse({ ranks: { recruta: 10 } })).toThrow();
    expect(() => jarvisConfigSchema.parse({ ranks: { agente: 3000, veterano: 2000 } })).toThrow();
    expect(() => jarvisConfigSchema.parse({ trivia: { cooldownSeconds: 0 } })).toThrow();
  });
});

describe('streaks', () => {
  const s0 = { currentStreak: 0, bestStreak: 0, lastActiveDay: null };
  it('counts consecutive days, resets after a gap, ignores the same day', () => {
    const d1 = advanceStreak(s0, '2026-11-16', cfg.streak);
    expect(d1).toEqual({ state: { currentStreak: 1, bestStreak: 1, lastActiveDay: '2026-11-16' }, bonus: 5 });
    const d2 = advanceStreak(d1?.state, '2026-11-17', cfg.streak);
    expect(d2?.state.currentStreak).toBe(2);
    expect(d2?.bonus).toBe(10);
    expect(advanceStreak(d2?.state, '2026-11-17', cfg.streak)).toBeNull();
    const gap = advanceStreak(d2?.state, '2026-11-19', cfg.streak);
    expect(gap?.state).toEqual({ currentStreak: 1, bestStreak: 2, lastActiveDay: '2026-11-19' });
  });
  it('caps the bonus', () => {
    expect(
      advanceStreak(
        { currentStreak: 20, bestStreak: 20, lastActiveDay: '2026-11-15' },
        '2026-11-16',
        cfg.streak,
      )?.bonus,
    ).toBe(35);
  });
  it('uses the local day: 23:59 and 00:00 in America/Sao_Paulo are different days', () => {
    const tz = 'America/Sao_Paulo';
    const late = localDay(new Date('2026-11-17T02:59:00.000Z'), tz); // 23:59 on the 16th (UTC-3)
    const midnight = localDay(new Date('2026-11-17T03:00:00.000Z'), tz); // 00:00 on the 17th
    expect([late, midnight]).toEqual(['2026-11-16', '2026-11-17']);
    const a = advanceStreak(s0, late, cfg.streak);
    if (!a) throw new Error('expected a streak');
    expect(advanceStreak(a.state, midnight, cfg.streak)?.state.currentStreak).toBe(2);
  });
  it('shows a lapsed streak as 0 without a nightly job', () => {
    const s = { currentStreak: 4, bestStreak: 4, lastActiveDay: '2026-11-15' };
    expect(displayedStreak(s, '2026-11-16')).toBe(4);
    expect(displayedStreak(s, '2026-11-17')).toBe(0);
  });
});

describe('ledger rebuild (property)', () => {
  it('progress rebuilt from the ledger equals the incremental value', () => {
    const entry = fc.record({
      amount: fc.integer({ min: -200, max: 400 }).filter((n) => n !== 0),
      reason: fc.constantFrom('trivia', 'grant', 'admin_adjust', 'streak_bonus'),
      dayOffset: fc.integer({ min: 0, max: 2 }),
    });
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 60 }), (entries) => {
        let day = 0;
        let inc = { xp: 0, currentStreak: 0, bestStreak: 0, lastActiveDay: null as string | null };
        const rows = entries.map((e) => {
          day += e.dayOffset;
          const d = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
          inc.xp += e.amount;
          if (e.amount > 0 && e.reason !== 'streak_bonus' && e.reason !== 'admin_adjust') {
            const n = advanceStreak(inc, d, cfg.streak);
            if (n) inc = { ...inc, ...n.state };
          }
          return { amount: e.amount, reason: e.reason, day: d };
        });
        const rebuilt = rebuildFromLedger(rows, cfg);
        expect(rebuilt.xp).toBe(inc.xp);
        expect(rebuilt.level).toBe(levelFor(inc.xp, cfg.levels));
        expect(rebuilt.rank).toBe(rankFor(inc.xp, cfg.ranks));
        expect([rebuilt.currentStreak, rebuilt.bestStreak, rebuilt.lastActiveDay]).toEqual([
          inc.currentStreak,
          inc.bestStreak,
          inc.lastActiveDay,
        ]);
      }),
    );
  });
});
