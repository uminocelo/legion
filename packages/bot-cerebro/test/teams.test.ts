import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { CerebroRepo } from '../src/db/repo.js';
import { cerebro } from '../src/index.js';
import { events, register, setupCerebro, USER } from './helpers.js';

let t: TestContext;
afterEach(async () => t?.close());

const STAFF = '400000000000000099';
const OTHER = '400000000000000002';
const staffRoleId = (tc: TestContext) => tc.gateway.roleByName('Conselho da Legião')?.id ?? '';
const repoOf = (tc: TestContext) => new CerebroRepo(tc.db, tc.gateway.guildId, tc.clock, tc.runtime.newId);
const reply = (tc: TestContext, id: string) => tc.gateway.lastReply(id)?.content ?? '';
const doctor = async (tc: TestContext) =>
  (await cerebro
    .doctorChecks?.(tc.ctxOf(cerebro))
    .find((c) => c.id === 'cerebro.teams')
    ?.run()) ?? null;

const move = (tc: TestContext, opts: { by?: string; who?: string; to: string; reason?: string }) =>
  tc.interact({
    kind: 'command',
    userId: opts.by ?? STAFF,
    commandName: 'cerebro',
    subcommand: 'equipe mover',
    options: { membro: opts.who ?? USER, equipe: opts.to, motivo: opts.reason ?? 'Pedido em #suporte' },
  });

async function withStaff(config: Record<string, unknown> = {}) {
  t = await setupCerebro(config);
  t.gateway.addMember({ userId: STAFF, roleIds: [staffRoleId(t)] });
  return t;
}

describe('default teams', () => {
  it('a new server gets the nine team roles', async () => {
    t = await setupCerebro();
    for (const name of [
      'Independente',
      'X-Men',
      'Irmandade',
      'Vingadores',
      'S.H.I.E.L.D.',
      'Guardiões',
      'Defensores',
      'Thunderbolts',
      'Filhos da Meia-Noite',
    ])
      expect(t.gateway.roleByName(name), name).toBeDefined();
  });

  it('new heroes start Independente, get its role and one onboarding audit row', async () => {
    t = await setupCerebro();
    await register(t);
    const repo = repoOf(t);
    const member = await repo.memberByDiscordId(USER);
    expect(member?.faction).toBe('independent');
    expect(member?.factionChangedAt).toBeNull(); // registration is not a switch
    expect(t.gateway.memberRoleNames(USER)).toContain('Independente');
    const rows = await repo.factionChanges(member?.id ?? '');
    expect(rows).toMatchObject([
      { fromFaction: null, toFaction: 'independent', reason: 'onboarding', byDiscordUserId: null },
    ]);
    expect(rows[0]?.sourceKey).toBe(`onboarding:${member?.id}`);
    expect(await events(t, 'player.faction_changed')).toEqual([]);
  });

  it('every team has a name and description in both languages', async () => {
    t = await setupCerebro();
    const { i18n } = t.ctxOf(cerebro);
    for (const f of t.ctxOf(cerebro).config.factions)
      for (const locale of ['pt-BR', 'en'] as const)
        for (const k of ['name', 'description']) {
          const key = `cerebro.faction.${f.key}.${k}`;
          expect(i18n.t(key, {}, locale), `${locale} ${key}`).not.toBe(key);
        }
  });
});

describe('legion doctor: teams', () => {
  it('is ok with the defaults', async () => {
    t = await setupCerebro();
    expect(await doctor(t)).toMatchObject({
      status: 'ok',
      message: '9 equipes; novos heróis entram em independent',
    });
  });

  it('lists the new teams missing from a custom factions list (ℹ️)', async () => {
    t = await setupCerebro({
      factions: [
        { key: 'independent', roleKey: 'faction_independent', emoji: '🟢' },
        { key: 'xmen', roleKey: 'faction_xmen', emoji: '🔵' },
      ],
    });
    const res = await doctor(t);
    expect(res?.status).toBe('info');
    expect(res?.message).toContain(
      'brotherhood, avengers, shield, guardians, defenders, thunderbolts, midnight_sons',
    );
  });

  it('fails when startFaction is not a configured team, and new heroes use the first team', async () => {
    t = await setupCerebro({ cerebro: { teams: { startFaction: 'wakanda' } } });
    const res = await doctor(t);
    expect(res?.status).toBe('fail');
    expect(res?.message).toContain('"wakanda"');
    await register(t);
    expect((await repoOf(t).memberByDiscordId(USER))?.faction).toBe('independent');
  });

  it('warns with a count when heroes are on a team that was turned off', async () => {
    t = await setupCerebro();
    await register(t);
    const repo = repoOf(t);
    const member = await repo.memberByDiscordId(USER);
    await repo.updateMember(member?.id ?? '', { faction: 'thunderbolts' });
    await register(t, OTHER);
    // The owner turns the Thunderbolts off.
    const cfg = t.ctxOf(cerebro).config;
    cfg.factions = cfg.factions.filter((f) => f.key !== 'thunderbolts');
    const res = await doctor(t);
    expect(res?.status).toBe('warn');
    expect(res?.message).toContain('thunderbolts (1)');
  });
});

describe('an unknown or disabled team shows as Independente', () => {
  it('on the profile, keeping the stored key', async () => {
    t = await setupCerebro();
    await register(t);
    const repo = repoOf(t);
    const member = await repo.memberByDiscordId(USER);
    await repo.updateMember(member?.id ?? '', { faction: 'old_team_from_a_rollback' });
    const id = await t.interact({ kind: 'command', userId: USER, commandName: 'perfil', options: {} });
    const fields = t.gateway.lastReply(id)?.embeds?.[0]?.fields ?? [];
    expect(fields.find((f) => f.name === 'Facção')?.value).toBe('🟢 Independente');
    expect((await repo.memberByDiscordId(USER))?.faction).toBe('old_team_from_a_rollback');
  });
});

describe('/cerebro equipe mover', () => {
  it('moves a hero, swaps the role, records who did it and emits the event', async () => {
    await withStaff();
    await register(t);
    const id = await move(t, { to: 'avengers', reason: 'Venceu o arco por fora do bot' });
    expect(reply(t, id)).toBe(
      '✅ **Faísca Rubra** agora está em **🟡 Vingadores** (antes: 🟢 Independente). Motivo registrado.',
    );
    const repo = repoOf(t);
    const member = await repo.memberByDiscordId(USER);
    expect(member?.faction).toBe('avengers');
    expect(member?.factionChangedAt).not.toBeNull();
    const roles = t.gateway.memberRoleNames(USER);
    expect(roles).toContain('Vingadores');
    expect(roles).not.toContain('Independente');
    const rows = await repo.factionChanges(member?.id ?? '');
    expect(rows.map((r) => [r.reason, r.fromFaction, r.toFaction, r.byDiscordUserId])).toEqual([
      ['onboarding', null, 'independent', null],
      ['staff', 'independent', 'avengers', STAFF],
    ]);
    expect(rows[1]?.sourceKey).toBe(`staff:${id}`);
    expect(await events(t, 'player.faction_changed')).toEqual([
      {
        memberId: member?.id,
        discordUserId: USER,
        from: 'independent',
        to: 'avengers',
        reason: 'staff',
        sourceKey: `staff:${id}`,
      },
    ]);
  });

  it('bypasses the origin rule and says so', async () => {
    await withStaff();
    await register(t, USER, { origin: 'tecnologia' });
    const id = await move(t, { to: 'brotherhood' });
    expect(reply(t, id)).toContain('agora está em **🔴 Irmandade**');
    expect(reply(t, id)).toContain('não é aceita por essa equipe');
    expect((await repoOf(t).memberByDiscordId(USER))?.faction).toBe('brotherhood');
  });

  it('bypasses the cooldown: two moves in a row both apply', async () => {
    await withStaff();
    await register(t);
    await move(t, { to: 'shield' });
    await move(t, { to: 'defenders' });
    expect((await repoOf(t).memberByDiscordId(USER))?.faction).toBe('defenders');
    expect(t.gateway.memberRoleNames(USER)).toContain('Defensores');
    expect(t.gateway.memberRoleNames(USER)).not.toContain('S.H.I.E.L.D.');
  });

  it('refuses a disabled team', async () => {
    await withStaff({
      factions: [
        { key: 'independent', roleKey: 'faction_independent', emoji: '🟢' },
        { key: 'xmen', roleKey: 'faction_xmen', emoji: '🔵' },
      ],
    });
    await register(t);
    const id = await move(t, { to: 'avengers' });
    expect(reply(t, id)).toBe('Essa equipe não existe ou está desligada neste servidor.');
    expect((await repoOf(t).memberByDiscordId(USER))?.faction).toBe('independent');
  });

  it('does nothing for the same team', async () => {
    await withStaff();
    await register(t);
    const id = await move(t, { to: 'independent' });
    expect(reply(t, id)).toBe('**Faísca Rubra** já está em **🟢 Independente**.');
    const member = await repoOf(t).memberByDiscordId(USER);
    expect(await repoOf(t).factionChanges(member?.id ?? '')).toHaveLength(1);
    expect(await events(t, 'player.faction_changed')).toEqual([]);
  });

  it('refuses a caller who is not staff', async () => {
    t = await setupCerebro();
    await register(t);
    await register(t, OTHER);
    const id = await move(t, { by: OTHER, to: 'avengers' });
    expect(reply(t, id)).toContain('Apenas a staff');
    expect((await repoOf(t).memberByDiscordId(USER))?.faction).toBe('independent');
  });

  it('refuses a member who is not a registered hero, and an empty reason', async () => {
    await withStaff();
    t.gateway.addMember({ userId: OTHER });
    expect(reply(t, await move(t, { who: OTHER, to: 'avengers' }))).toBe(
      'Esse membro ainda não é um herói registrado.',
    );
    await register(t);
    expect(reply(t, await move(t, { to: 'avengers', reason: '   ' }))).toBe(
      'Escreva o motivo em até 200 caracteres.',
    );
  });

  it('offers only enabled teams as choices', async () => {
    t = await setupCerebro({
      factions: [
        { key: 'independent', roleKey: 'faction_independent', emoji: '🟢' },
        { key: 'avengers', roleKey: 'faction_avengers', emoji: '🟡' },
      ],
    });
    const def = t.gateway.registeredCommands?.find((c) => (c as { name: string }).name === 'cerebro') as {
      options: {
        name: string;
        options?: {
          name: string;
          options?: { name: string; choices?: { value: string; name: string }[] }[];
        }[];
      }[];
    };
    const team = def.options
      .find((o) => o.name === 'equipe')
      ?.options?.[0]?.options?.find((o) => o.name === 'equipe');
    expect(team?.choices).toEqual([
      expect.objectContaining({ value: 'independent', name: '🟢 Independente' }),
      expect.objectContaining({ value: 'avengers', name: '🟡 Vingadores' }),
    ]);
  });
});
