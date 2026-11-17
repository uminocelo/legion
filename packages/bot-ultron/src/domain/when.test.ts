import { describe, expect, it } from 'vitest';
import { hpBar, median, parseWhen } from './when.js';

const now = new Date('2026-11-16T15:00:00.000Z');
describe('parseWhen', () => {
  it('reads wall time in the server timezone and relative offsets', () => {
    expect(parseWhen('2026-11-21 20:00', now, 'America/Sao_Paulo')?.toISOString()).toBe(
      '2026-11-21T23:00:00.000Z',
    );
    expect(parseWhen('2026-07-01 09:05', now, 'Europe/Lisbon')?.toISOString()).toBe(
      '2026-07-01T08:05:00.000Z',
    );
    expect(parseWhen('+30m', now, 'UTC')?.toISOString()).toBe('2026-11-16T15:30:00.000Z');
    expect(parseWhen('+2h', now, 'UTC')?.toISOString()).toBe('2026-11-16T17:00:00.000Z');
    expect(parseWhen('+1d', now, 'UTC')?.toISOString()).toBe('2026-11-17T15:00:00.000Z');
  });
  it('rejects garbage, bad dates and wall times that do not exist', () => {
    for (const bad of ['amanhã', '2026-13-01 10:00', '2026-02-30 10:00', '25:00', '+', ''])
      expect(parseWhen(bad, now, 'America/Sao_Paulo')).toBeNull();
    expect(parseWhen('2026-03-29 01:30', now, 'Europe/Lisbon')).toBeNull(); // DST gap
  });
  it('draws HP bars and medians', () => {
    expect(hpBar(50, 100, 10)).toBe('█████░░░░░ 50%');
    expect(hpBar(0, 100, 4)).toBe('░░░░ 0%');
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
  });
});
