import { describe, expect, it } from 'vitest';
import { monthStartAtOrAfter, nextWarWindow, zonedMidnight } from './war-window.js';

const TZ = 'America/Sao_Paulo';

describe('war window', () => {
  it('reads a calendar midnight in the server timezone', () => {
    expect(zonedMidnight('2026-04-01', TZ).toISOString()).toBe('2026-04-01T03:00:00.000Z');
  });

  it('starts a month war on the next 1st, and the following one on the 1st it ends', () => {
    const mid = new Date('2026-03-15T15:00:00.000Z');
    const first = nextWarWindow({ length: 'month', timeZone: TZ, now: mid, previousEndsAt: null });
    expect(first.startsAt.toISOString()).toBe('2026-04-01T03:00:00.000Z');
    expect(first.endsAt.toISOString()).toBe('2026-05-01T03:00:00.000Z');
    const next = nextWarWindow({
      length: 'month',
      timeZone: TZ,
      now: new Date(first.endsAt.getTime() + 5_000),
      previousEndsAt: first.endsAt,
    });
    expect(next.startsAt.toISOString()).toBe('2026-05-01T03:00:00.000Z');
    expect(next.endsAt.toISOString()).toBe('2026-06-01T03:00:00.000Z');
  });

  it('keeps the 1st when the end job runs a minute late', () => {
    const late = new Date('2026-05-01T03:01:00.000Z');
    expect(monthStartAtOrAfter(late, TZ).toISOString()).toBe('2026-05-01T03:00:00.000Z');
  });

  it('a number of days starts now and the next war starts when that one ends', () => {
    const now = new Date('2026-03-15T15:00:00.000Z');
    const first = nextWarWindow({ length: 14, timeZone: TZ, now, previousEndsAt: null });
    expect(first.startsAt.toISOString()).toBe(now.toISOString());
    expect(first.endsAt.toISOString()).toBe('2026-03-29T15:00:00.000Z');
    const next = nextWarWindow({
      length: 14,
      timeZone: TZ,
      now: first.endsAt,
      previousEndsAt: first.endsAt,
    });
    expect(next.startsAt.toISOString()).toBe(first.endsAt.toISOString());
    expect(next.endsAt.getTime() - next.startsAt.getTime()).toBe(14 * 86_400_000);
  });
});
