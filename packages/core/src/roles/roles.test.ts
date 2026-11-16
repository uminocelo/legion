import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config/load.js';
import { FakeDiscordGateway } from '../discord/fake-gateway.js';
import { silentLogger } from '../silent-log.js';
import { RoleGuardError, RoleService } from './role-service.js';
import { hexToInt, isEmptyPlan, planRoleSync } from './sync-plan.js';

const config = parseConfig({});
const make = (guard: 'throw' | 'skip' = 'throw') => {
  const gw = new FakeDiscordGateway();
  return { gw, roles: new RoleService(gw, config.roles, silentLogger(), guard) };
};
const FACTIONS = ['faction_xmen', 'faction_brotherhood', 'faction_independent'];

describe('planRoleSync', () => {
  it('creates every missing role except the TikTok one, and is a no-op afterwards', async () => {
    const { gw, roles } = make();
    const plan = planRoleSync(await gw.fetchRoles(), config.roles);
    expect(plan.create.map((r) => r.key)).not.toContain('tiktok_sub');
    expect(plan.create).toHaveLength(config.roles.length - 1);
    const res = await roles.applySyncPlan(plan);
    expect(res.errors).toEqual([]);
    expect(isEmptyPlan(planRoleSync(await gw.fetchRoles(), config.roles))).toBe(true);
    expect(gw.callsOf('createRole').some(([r]) => (r as { name: string }).name === 'Assinante TikTok')).toBe(
      false,
    );
  });

  it('fixes colors only on Cérebro-managed roles and never plans deletes or renames', async () => {
    const { gw } = make();
    gw.addRole({ name: 'X-Men', color: 0x111111 }); // cerebro-managed, wrong color
    gw.addRole({ name: 'Professor X', color: 0x222222 }); // manual, wrong color
    gw.addRole({ name: 'Old role nobody configured' });
    const plan = planRoleSync(await gw.fetchRoles(), config.roles);
    expect(plan.updateColor).toEqual([
      expect.objectContaining({ key: 'faction_xmen', from: 0x111111, to: hexToInt('#3498DB') }),
    ]);
    expect(Object.keys(plan)).toEqual(['create', 'updateColor']);
  });

  it('never touches an existing TikTok integration role', async () => {
    const { gw } = make();
    gw.addRole({ name: 'Assinante TikTok', color: 0x123456, managed: true });
    const plan = planRoleSync(await gw.fetchRoles(), config.roles);
    expect(plan.create.find((r) => r.name === 'Assinante TikTok')).toBeUndefined();
    expect(plan.updateColor).toEqual([]);
  });
});

describe('RoleService TikTok guard', () => {
  it('refuses by key', async () => {
    const { roles } = make();
    await expect(roles.assign('1', 'tiktok_sub')).rejects.toBeInstanceOf(RoleGuardError);
    await expect(roles.remove('1', 'tiktok_sub')).rejects.toBeInstanceOf(RoleGuardError);
    await expect(roles.setExactlyOne('1', ['tiktok_sub'], null)).rejects.toBeInstanceOf(RoleGuardError);
  });

  it('refuses by name, even under another key', async () => {
    const gw = new FakeDiscordGateway();
    const custom = parseConfig({
      roles: [{ key: 'subs', name: 'Assinante TikTok', group: 'community', managedBy: 'cerebro' }],
      factions: [],
    });
    const roles = new RoleService(gw, custom.roles, silentLogger(), 'throw');
    gw.addRole({ name: 'Assinante TikTok' });
    await expect(roles.assign('1', 'subs')).rejects.toBeInstanceOf(RoleGuardError);
    await expect(roles.applySyncPlan({ create: custom.roles, updateColor: [] })).resolves.toMatchObject({
      created: [],
      errors: [{ key: 'subs' }],
    });
  });

  it('refuses by the integration (managed) flag', async () => {
    const gw = new FakeDiscordGateway();
    const custom = parseConfig({
      roles: [{ key: 'vip', name: 'VIP Twitch', group: 'community', managedBy: 'cerebro' }],
      factions: [],
    });
    gw.addRole({ name: 'VIP Twitch', managed: true });
    const roles = new RoleService(gw, custom.roles, silentLogger(), 'throw');
    gw.addMember({ userId: '1' });
    await expect(roles.assign('1', 'vip')).rejects.toBeInstanceOf(RoleGuardError);
    const role = gw.roleByName('VIP Twitch');
    await expect(
      roles.applySyncPlan({
        create: [],
        updateColor: [{ roleId: role?.id ?? '', key: 'vip', name: 'VIP Twitch', from: 0, to: 1 }],
      }),
    ).resolves.toMatchObject({ errors: [{ key: 'vip' }] });
  });

  it('logs and skips instead of throwing in production mode', async () => {
    const { gw, roles } = make('skip');
    expect(await roles.assign('1', 'tiktok_sub')).toBe(false);
    expect(gw.callsOf('addMemberRole')).toEqual([]);
  });
});

describe('RoleService operations', () => {
  it('setExactlyOne leaves exactly one faction after any sequence of picks', async () => {
    const { gw, roles } = make();
    await roles.applySyncPlan(planRoleSync(await gw.fetchRoles(), config.roles));
    gw.addMember({ userId: '1' });
    for (const pick of [
      'faction_xmen',
      'faction_brotherhood',
      'faction_brotherhood',
      'faction_independent',
      'faction_xmen',
    ]) {
      await roles.setExactlyOne('1', FACTIONS, pick);
      const names = gw.memberRoleNames('1');
      expect(names.filter((n) => ['X-Men', 'Irmandade', 'Independente'].includes(n))).toHaveLength(1);
    }
    expect(gw.memberRoleNames('1')).toEqual(['X-Men']);
    await roles.setExactlyOne('1', FACTIONS, null);
    expect(gw.memberRoleNames('1')).toEqual([]);
  });

  it('reconcileMember only changes what differs', async () => {
    const { gw, roles } = make();
    await roles.applySyncPlan(planRoleSync(await gw.fetchRoles(), config.roles));
    gw.addMember({ userId: '1' });
    await roles.assign('1', 'signal');
    const before = gw.calls.length;
    await roles.reconcileMember('1', ['registered', 'rank_recruta'], ['signal']);
    expect(gw.memberRoleNames('1')).toEqual(['Mutante Registrado', 'Recruta']);
    await roles.reconcileMember('1', ['registered', 'rank_recruta'], ['signal']);
    const writes = gw.calls
      .slice(before)
      .filter((c) => c.method === 'addMemberRole' || c.method === 'removeMemberRole');
    expect(writes).toHaveLength(3);
  });

  it('checkHierarchy lists roles at or above the bot top role', async () => {
    const { gw, roles } = make();
    gw.addRole({ name: 'X-Men', position: 150 });
    gw.addRole({ name: 'Irmandade', position: 5 });
    expect(await roles.checkHierarchy(FACTIONS)).toEqual([{ key: 'faction_xmen', name: 'X-Men' }]);
  });
});
