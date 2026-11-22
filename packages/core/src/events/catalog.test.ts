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
    expect(
      validatePayload('player.faction_changed', {
        ...changed,
        reason: 'squad',
        sourceKey: 'squad:s1:m1',
      }),
    ).toMatchObject({ reason: 'squad' });
    const created = {
      squadId: 's1',
      name: 'Noite',
      baseFaction: 'xmen',
      founderDiscordId: '111',
    };
    expect(validatePayload('squad.created', created)).toEqual(created);
    expect(
      validatePayload('squad.joined', { squadId: 's1', discordUserId: '222', via: 'code' }),
    ).toMatchObject({
      via: 'code',
    });
    expect(
      validatePayload('squad.left', { squadId: 's1', discordUserId: '222', reason: 'team_switch' }),
    ).toMatchObject({ reason: 'team_switch' });
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

describe('season.ended (US-22)', () => {
  const payload = {
    seasonId: 's1',
    winners: [
      { memberId: 'm1', place: 1, xp: 120 },
      { memberId: 'm2', place: 2, xp: 90 },
    ],
    endsAt: '2026-04-01T03:00:00.000Z',
  };

  it('accepts top places and an empty winners list', () => {
    expect(validatePayload('season.ended', payload)).toEqual(payload);
    expect(validatePayload('season.ended', { ...payload, winners: [] })).toMatchObject({ winners: [] });
  });

  it('rejects a zero place or missing endsAt', () => {
    expect(() =>
      validatePayload('season.ended', {
        ...payload,
        winners: [{ memberId: 'm1', place: 0, xp: 1 }],
      }),
    ).toThrow(/Invalid payload/);
    const { endsAt: _drop, ...noEnd } = payload;
    expect(() => validatePayload('season.ended', noEnd)).toThrow(/Invalid payload/);
  });
});
