import { describe, expect, it } from 'vitest';
import { validatePayload } from './catalog.js';

describe('team events (v0.9)', () => {
  const request = { memberId: 'm1', faction: 'avengers', sourceKey: 'arc:r1:m1' };
  const refused = { ...request, code: 'cooldown' as const, availableAt: '2026-12-18T12:00:00.000Z' };
  const changed = {
    memberId: 'm1',
    discordUserId: '111',
    from: 'independent',
    to: 'avengers',
    reason: 'arc' as const,
    sourceKey: 'arc:r1:m1',
  };

  it('accepts the payloads from the tech spec', () => {
    expect(validatePayload('faction.join_requested', request)).toEqual(request);
    expect(validatePayload('player.faction_change_refused', refused)).toEqual(refused);
    for (const code of ['origin', 'disabled', 'same'] as const)
      expect(validatePayload('player.faction_change_refused', { ...request, code })).toMatchObject({ code });
    expect(validatePayload('player.faction_changed', changed)).toEqual(changed);
    expect(
      validatePayload('player.faction_changed', { ...changed, from: null, reason: 'staff' }),
    ).toBeTruthy();
  });

  it('rejects missing fields, unknown codes and reasons, and a bad date', () => {
    const { sourceKey: _drop, ...noKey } = request;
    expect(() => validatePayload('faction.join_requested', noKey)).toThrow(/Invalid payload/);
    expect(() => validatePayload('faction.join_requested', { ...request, faction: '' })).toThrow(
      /Invalid payload/,
    );
    expect(() => validatePayload('player.faction_change_refused', { ...request, code: 'full' })).toThrow(
      /Invalid payload/,
    );
    expect(() => validatePayload('player.faction_change_refused', request)).toThrow(/Invalid payload/);
    expect(() =>
      validatePayload('player.faction_change_refused', { ...refused, availableAt: 'next month' }),
    ).toThrow(/Invalid payload/);
    expect(() => validatePayload('player.faction_changed', { ...changed, reason: 'war' })).toThrow(
      /Invalid payload/,
    );
  });
});
