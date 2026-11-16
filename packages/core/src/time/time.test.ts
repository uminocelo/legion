import { describe, expect, it } from 'vitest';
import { FakeClock } from './clock.js';
import { addDays, isValidTimeZone, localDay } from './local-day.js';

const TZ = 'America/Sao_Paulo';

describe('localDay', () => {
  it('uses the server timezone around midnight', () => {
    // 02:59Z is 23:59 of the previous day in São Paulo (UTC-3).
    expect(localDay(new Date('2026-11-17T02:59:00.000Z'), TZ)).toBe('2026-11-16');
    expect(localDay(new Date('2026-11-17T03:00:00.000Z'), TZ)).toBe('2026-11-17');
  });

  it('adds days across months', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('validates timezones', () => {
    expect(isValidTimeZone(TZ)).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('FakeClock', () => {
  it('can be set and advanced', () => {
    const c = new FakeClock('2026-01-01T00:00:00.000Z');
    c.advance(60_000);
    expect(c.now().toISOString()).toBe('2026-01-01T00:01:00.000Z');
  });
});
