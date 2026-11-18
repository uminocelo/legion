import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CerebroRepo } from '../src/db/repo.js';
import { events, register, setupCerebro, USER } from './helpers.js';

let t: TestContext;
afterEach(async () => t?.close());

const DAY = 86_400_000;
const repoOf = (tc: TestContext) => new CerebroRepo(tc.db, tc.gateway.guildId, tc.clock, tc.runtime.newId);
const memberId = async (tc: TestContext) => (await repoOf(tc).memberByDiscordId(USER))?.id ?? '';

/** What J.A.R.V.I.S. emits at the end of a recruitment arc. */
async function request(tc: TestContext, faction: string, sourceKey = 'arc:run1:m') {
  const id = await memberId(tc);
  const key = sourceKey.replace(/:m$/, `:${id}`);
  await tc.runtime.bus.transaction((tx) =>
    tc.runtime.bus.emit(tx, 'faction.join_requested', { memberId: id, faction, sourceKey: key }),
  );
  await tc.settle();
  return { id, key };
}

async function setup(o: { origin?: string; config?: Record<string, unknown> } = {}) {
  t = await setupCerebro(o.config ?? {});
  await register(t, USER, o.origin ? { origin: o.origin } : {});
  return t;
}

describe('cerebro.faction-join', () => {
  it('a first join applies at once: audit row, date, role swap and player.faction_changed', async () => {
    await setup();
    const { id, key } = await request(t, 'avengers');
    const member = await repoOf(t).memberById(id);
    expect(member?.faction).toBe('avengers');
    expect(member?.factionChangedAt).toBe(t.clock.now().toISOString());
    expect(t.gateway.memberRoleNames(USER)).toContain('Vingadores');
    expect(t.gateway.memberRoleNames(USER)).not.toContain('Independente');
    const rows = await repoOf(t).factionChanges(id);
    expect(rows.map((r) => [r.reason, r.fromFaction, r.toFaction, r.sourceKey, r.byDiscordUserId])).toEqual([
      ['onboarding', null, 'independent', `onboarding:${id}`, null],
      ['arc', 'independent', 'avengers', key, null],
    ]);
    expect(await events(t, 'player.faction_changed')).toEqual([
      {
        memberId: id,
        discordUserId: USER,
        from: 'independent',
        to: 'avengers',
        reason: 'arc',
        sourceKey: key,
      },
    ]);
    expect(await events(t, 'player.faction_change_refused')).toEqual([]);
  });

  it('a repeated request (same sourceKey) is a no-op', async () => {
    await setup();
    const { id } = await request(t, 'avengers', 'arc:run1:m');
    await request(t, 'avengers', 'arc:run1:m');
    expect((await repoOf(t).factionChanges(id)).length).toBe(2);
    expect((await events(t, 'player.faction_changed')).length).toBe(1);
    expect(await events(t, 'player.faction_change_refused')).toEqual([]);
  });

  it('refuses a switch before switchCooldownDays and gives the date; applies it after', async () => {
    await setup();
    const { id } = await request(t, 'avengers', 'arc:run1:m');
    const joinedAt = t.clock.now().getTime();
    t.clock.advance(10 * DAY);
    const second = await request(t, 'shield', 'arc:run2:m');
    expect(await events(t, 'player.faction_change_refused')).toEqual([
      {
        memberId: id,
        faction: 'shield',
        sourceKey: second.key,
        code: 'cooldown',
        availableAt: new Date(joinedAt + 30 * DAY).toISOString(),
      },
    ]);
    expect((await repoOf(t).memberById(id))?.faction).toBe('avengers');
    t.clock.advance(20 * DAY);
    await request(t, 'shield', 'arc:run3:m');
    expect((await repoOf(t).memberById(id))?.faction).toBe('shield');
    expect(t.gateway.memberRoleNames(USER)).toContain('S.H.I.E.L.D.');
    expect(t.gateway.memberRoleNames(USER)).not.toContain('Vingadores');
  });

  it('a cooldown of 0 turns the wait off', async () => {
    await setup({ config: { cerebro: { teams: { switchCooldownDays: 0 } } } });
    const { id } = await request(t, 'avengers', 'arc:run1:m');
    await request(t, 'shield', 'arc:run2:m');
    expect((await repoOf(t).memberById(id))?.faction).toBe('shield');
  });

  it('refuses a team that does not take the origin, a disabled team, and the same team', async () => {
    await setup({ origin: 'tecnologia' });
    const codes = async () => (await events(t, 'player.faction_change_refused')).map((e) => e.code);
    await request(t, 'brotherhood', 'arc:r1:m');
    expect(await codes()).toEqual(['origin']);
    await request(t, 'nao_existe', 'arc:r2:m');
    expect(await codes()).toEqual(['origin', 'disabled']);
    await request(t, 'independent', 'arc:r3:m');
    expect(await codes()).toEqual(['origin', 'disabled', 'same']);
    const id = await memberId(t);
    expect((await repoOf(t).memberById(id))?.faction).toBe('independent');
    expect((await repoOf(t).factionChanges(id)).length).toBe(1);
    expect(await events(t, 'player.faction_changed')).toEqual([]);
  });

  it('a team turned off in config is refused as disabled', async () => {
    await setup({
      config: {
        factions: [
          { key: 'independent', roleKey: 'faction_independent', emoji: '🟢' },
          { key: 'xmen', roleKey: 'faction_xmen', emoji: '🔵' },
        ],
      },
    });
    await request(t, 'avengers');
    expect((await events(t, 'player.faction_change_refused')).map((e) => e.code)).toEqual(['disabled']);
  });

  it('ignores a member who left the server: no change, no event', async () => {
    await setup();
    const id = await memberId(t);
    await repoOf(t).updateMember(id, { leftAt: t.clock.now().toISOString() });
    await request(t, 'avengers');
    expect((await repoOf(t).memberById(id))?.faction).toBe('independent');
    expect(await events(t, 'player.faction_changed')).toEqual([]);
    expect(await events(t, 'player.faction_change_refused')).toEqual([]);
  });

  it('still records the join when Discord refuses the role change, and retries the roles later', async () => {
    await setup();
    const add = vi.spyOn(t.gateway, 'addMemberRole').mockRejectedValue(new Error('Missing Permissions'));
    const { id } = await request(t, 'avengers');
    expect((await repoOf(t).memberById(id))?.faction).toBe('avengers');
    expect((await events(t, 'player.faction_changed')).length).toBe(1);
    expect(t.gateway.memberRoleNames(USER)).not.toContain('Vingadores');
    add.mockRestore();
    t.clock.advance(10_000);
    await t.settle();
    expect(t.gateway.memberRoleNames(USER)).toContain('Vingadores');
  });
});
