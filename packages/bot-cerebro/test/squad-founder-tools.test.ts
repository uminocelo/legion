import { coreTables, type TestContext } from '@legion/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { CerebroRepo } from '../src/db/repo.js';
import { cerebroTables } from '../src/db/tables.js';
import { CerebroFlow } from '../src/flow.js';
import { cerebro } from '../src/index.js';
import { CH, events, register, setupCerebro, USER } from './helpers.js';

const STAFF = '400000000000000099';
const OTHER = '400000000000000002';
const THIRD = '400000000000000003';
const MOD = '300000000000000090';
const SQUAD_CH = '300000000000000091';

let t: TestContext;
afterEach(async () => t?.close());

const reply = (id: string) => t.gateway.lastReply(id)?.content ?? '';
const council = () => t.gateway.roleByName('Conselho da Legião')?.id ?? '';
const repo = () => new CerebroRepo(t.db, t.gateway.guildId, t.clock, t.runtime.newId);
const tables = () => cerebroTables(t.db);
const squads = () => new CerebroFlow(t.ctxOf(cerebro)).squads;
const cmd = (userId: string, commandName: string, subcommand: string, options: Record<string, string> = {}) =>
  t.interact({ kind: 'command', userId, commandName, subcommand, options });
const criar = (userId: string, nome: string, base = 'avengers') =>
  cmd(userId, 'esquadrao', 'criar', { nome, base });
const entrar = (userId: string, codigo: string) => cmd(userId, 'esquadrao', 'entrar', { codigo });
const move = (who: string, to: string) =>
  cmd(STAFF, 'cerebro', 'equipe mover', { membro: who, equipe: to, motivo: 'Pedido em #suporte' });

async function world(squadsCfg: Record<string, unknown> = {}) {
  t = await setupCerebro({
    squads: { enabled: true, founderRole: 'staff_council', ...squadsCfg },
    channels: { welcome: CH.welcome, rules: CH.rules, registry: CH.registry, modQueue: MOD },
  });
  t.gateway.addChannel({ id: MOD, name: 'mod-queue' });
  t.gateway.addChannel({ id: SQUAD_CH, name: 'esquadroes' });
  for (const f of t.ctxOf(cerebro).config.factions) {
    if (f.key !== 'independent') f.squadChannelId = SQUAD_CH;
  }
  t.gateway.addMember({ userId: USER, roleIds: [council()] });
  t.gateway.addMember({ userId: STAFF, roleIds: [council()] });
  await register(t, USER);
  return t;
}

async function rowNamed(name: string) {
  const s = tables().cerebroSquads;
  const [row] = await t.db.orm.select().from(s).where(eq(s.name, name));
  if (!row) throw new Error(`missing squad ${name}`);
  return row;
}

async function seats(squadId: string) {
  const m = tables().cerebroSquadMembers;
  return t.db.orm.select().from(m).where(eq(m.squadId, squadId));
}

async function approve(name: string, base = 'avengers') {
  await criar(USER, name, base);
  const row = await rowNamed(name);
  const id = await cmd(STAFF, 'cerebro', 'esquadrao aprovar', { esquadrao: row.id });
  expect(reply(id)).toContain('aprovado');
  return rowNamed(name);
}

async function memberOnSquad(discordUserId: string, codinome: string, code: string) {
  await register(t, discordUserId, { fields: { codinome } });
  const id = await entrar(discordUserId, code);
  expect(reply(id)).toContain('entrou');
  const member = await repo().memberByDiscordId(discordUserId);
  if (!member) throw new Error(`missing member ${discordUserId}`);
  return member;
}

async function audits(action: string) {
  const rows = await t.db.orm.select().from(coreTables(t.db).coreAuditLog);
  return rows.filter((r) => r.action === action);
}

describe('rename', () => {
  it('renames the squad and Discord role for the leader', async () => {
    await world();
    const row = await approve('Noite');
    const out = await squads().rename({ discordUserId: USER, name: 'Aurora' });
    expect(out).toMatchObject({ ok: true, key: 'renamed', vars: { name: 'Aurora' } });
    const saved = await rowNamed('Aurora');
    expect(saved.nameKey).toBe('aurora');
    expect(saved.id).toBe(row.id);
    expect(t.gateway.callsOf('editRole')).toEqual([[row.roleId, { name: 'Aurora' }]]);
    expect(t.gateway.roles.get(row.roleId ?? '')?.name).toBe('Aurora');
    const [audit] = await audits('cerebro/squad-rename');
    expect(audit).toMatchObject({
      source: 'command',
      actorDiscordId: USER,
      target: row.id,
    });
    expect(JSON.parse(audit.details)).toMatchObject({ ok: true, name: 'Aurora', from: 'Noite' });
  });

  it('lets the co-leader rename and refuses a regular member', async () => {
    await world();
    const row = await approve('Noite');
    const other = await memberOnSquad(OTHER, 'Luz Norte', row.code ?? '');
    await squads().setCoLeader({ discordUserId: USER, targetDiscordUserId: OTHER });
    expect(await squads().rename({ discordUserId: OTHER, name: 'Aurora' })).toMatchObject({
      ok: true,
      key: 'renamed',
    });
    expect((await rowNamed('Aurora')).coLeaderMemberId).toBe(other.id);

    await memberOnSquad(THIRD, 'Vento Sul', (await rowNamed('Aurora')).code ?? '');
    expect(await squads().rename({ discordUserId: THIRD, name: 'Orvalho' })).toMatchObject({
      ok: false,
      key: 'not_leader',
    });
  });

  it('refuses length, canon and taken names', async () => {
    await world({ maxPerFounder: 2 });
    await approve('Noite');
    await approve('Aurora');
    expect(await squads().rename({ discordUserId: USER, name: 'ab' })).toMatchObject({
      ok: false,
      key: 'name_length',
    });
    expect(await squads().rename({ discordUserId: USER, name: 'Wolverine' })).toMatchObject({
      ok: false,
      key: 'canon_name',
    });
    expect(await squads().rename({ discordUserId: USER, name: 'AURORA' })).toMatchObject({
      ok: false,
      key: 'name_taken',
    });
    expect((await rowNamed('Noite')).name).toBe('Noite');
    expect(t.gateway.callsOf('editRole')).toEqual([]);
  });

  it('restores the previous name when editRole fails', async () => {
    await world();
    const row = await approve('Noite');
    t.gateway.failNext('editRole');
    const out = await squads().rename({ discordUserId: USER, name: 'Aurora' });
    expect(out).toMatchObject({ ok: false, key: 'discord_failed' });
    const saved = await rowNamed('Noite');
    expect(saved.nameKey).toBe('noite');
    expect(t.gateway.roles.get(row.roleId ?? '')?.name).toBe('Noite');
    expect(await audits('cerebro/squad-rename')).toHaveLength(0);
  });

  it('refuses when squads are off or the actor is not in a squad', async () => {
    await world();
    await approve('Noite');
    t.ctxOf(cerebro).config.squads.enabled = false;
    expect(await squads().rename({ discordUserId: USER, name: 'Aurora' })).toMatchObject({
      ok: false,
      key: 'squads_disabled',
    });
    t.ctxOf(cerebro).config.squads.enabled = true;
    expect(await squads().rename({ discordUserId: OTHER, name: 'Aurora' })).toMatchObject({
      ok: false,
      key: 'not_in_squad',
    });
  });
});

describe('setCoLeader', () => {
  it('sets, replaces and clears the co-leader', async () => {
    await world();
    const row = await approve('Noite');
    const other = await memberOnSquad(OTHER, 'Luz Norte', row.code ?? '');
    const third = await memberOnSquad(THIRD, 'Vento Sul', row.code ?? '');

    expect(await squads().setCoLeader({ discordUserId: USER, targetDiscordUserId: OTHER })).toMatchObject({
      ok: true,
      key: 'coleader_set',
    });
    expect((await rowNamed('Noite')).coLeaderMemberId).toBe(other.id);

    expect(await squads().setCoLeader({ discordUserId: USER, targetDiscordUserId: THIRD })).toMatchObject({
      ok: true,
      key: 'coleader_set',
    });
    expect((await rowNamed('Noite')).coLeaderMemberId).toBe(third.id);

    expect(await squads().setCoLeader({ discordUserId: USER, targetDiscordUserId: null })).toMatchObject({
      ok: true,
      key: 'coleader_cleared',
    });
    expect((await rowNamed('Noite')).coLeaderMemberId).toBeNull();

    const coleaderAudits = await audits('cerebro/squad-coleader');
    expect(coleaderAudits).toHaveLength(3);
    expect(coleaderAudits.map((a) => JSON.parse(a.details).coLeaderMemberId)).toEqual([
      other.id,
      third.id,
      null,
    ]);
  });

  it('refuses not_leader, not_member and is_leader', async () => {
    await world();
    const row = await approve('Noite');
    const other = await memberOnSquad(OTHER, 'Luz Norte', row.code ?? '');
    await squads().setCoLeader({ discordUserId: USER, targetDiscordUserId: OTHER });

    expect(await squads().setCoLeader({ discordUserId: OTHER, targetDiscordUserId: null })).toMatchObject({
      ok: false,
      key: 'not_leader',
    });
    expect(await squads().setCoLeader({ discordUserId: USER, targetDiscordUserId: STAFF })).toMatchObject({
      ok: false,
      key: 'not_member',
    });
    expect(await squads().setCoLeader({ discordUserId: USER, targetDiscordUserId: USER })).toMatchObject({
      ok: false,
      key: 'is_leader',
    });
    expect((await rowNamed('Noite')).coLeaderMemberId).toBe(other.id);
  });
});

describe('archiveOwn', () => {
  it('lets the leader archive with a reason and keeps the team', async () => {
    await world();
    const row = await approve('Noite');
    const before = await rowNamed('Noite');
    const out = await squads().archiveOwn({ discordUserId: USER, reason: 'fim de temporada' });
    expect(out).toMatchObject({ ok: true, key: 'archived', vars: { name: 'Noite' } });
    const after = await rowNamed('Noite');
    expect(after.status).toBe('archived');
    expect(after.refuseReason).toBe('fim de temporada');
    expect(t.gateway.roles.get(before.roleId ?? '')).toBeUndefined();
    expect(t.gateway.channels.get(before.threadId ?? '')).toBeUndefined();
    expect(t.gateway.invites.has(before.inviteCode ?? '')).toBe(false);
    expect((await repo().memberByDiscordId(USER))?.faction).toBe('independent');
    expect(await seats(row.id)).toHaveLength(0);
    const [audit] = await audits('cerebro/squad-archive');
    expect(audit).toMatchObject({ actorDiscordId: USER, target: row.id, source: 'command' });
    expect(JSON.parse(audit.details)).toMatchObject({
      name: 'Noite',
      reason: 'fim de temporada',
    });
  });

  it('lets the co-leader archive', async () => {
    await world();
    const row = await approve('Noite');
    await memberOnSquad(OTHER, 'Luz Norte', row.code ?? '');
    await squads().setCoLeader({ discordUserId: USER, targetDiscordUserId: OTHER });
    expect(await squads().archiveOwn({ discordUserId: OTHER, reason: 'decisão do grupo' })).toMatchObject({
      ok: true,
      key: 'archived',
    });
    expect((await rowNamed('Noite')).status).toBe('archived');
  });

  it('refuses archiveOwn for a regular member', async () => {
    await world();
    const row = await approve('Aurora');
    await memberOnSquad(OTHER, 'Luz Norte', row.code ?? '');
    expect(await squads().archiveOwn({ discordUserId: OTHER, reason: 'sem poder' })).toMatchObject({
      ok: false,
      key: 'not_leader',
    });
    expect((await rowNamed('Aurora')).status).toBe('active');
  });

  it('refuses a short reason and leaves staff archive working', async () => {
    await world();
    const row = await approve('Noite');
    expect(await squads().archiveOwn({ discordUserId: USER, reason: '   ' })).toMatchObject({
      ok: false,
      key: 'reason_length',
    });
    const id = await cmd(STAFF, 'cerebro', 'esquadrao arquivar', {
      esquadrao: row.id,
      motivo: 'staff fecha',
    });
    expect(reply(id)).toContain('arquivado');
    expect((await rowNamed('Noite')).status).toBe('archived');
  });

  it('second archive loses the race with not_active', async () => {
    await world();
    await approve('Noite');
    expect(await squads().archiveOwn({ discordUserId: USER, reason: 'primeiro' })).toMatchObject({
      ok: true,
      key: 'archived',
    });
    expect(await squads().archiveOwn({ discordUserId: USER, reason: 'segundo' })).toMatchObject({
      ok: false,
      key: 'not_in_squad',
    });
  });
});

describe('leave transfer', () => {
  it('transfers to the co-leader then lets the old leader leave', async () => {
    await world();
    const row = await approve('Noite');
    const leader = await repo().memberByDiscordId(USER);
    expect(leader).toBeTruthy();
    const other = await memberOnSquad(OTHER, 'Luz Norte', row.code ?? '');
    await squads().setCoLeader({ discordUserId: USER, targetDiscordUserId: OTHER });

    const left = await cmd(USER, 'esquadrao', 'sair');
    expect(reply(left)).toBe('Você saiu de **Noite**. Sua equipe continua a mesma.');
    const saved = await rowNamed('Noite');
    expect(saved.status).toBe('active');
    expect(saved.founderMemberId).toBe(other.id);
    expect(saved.coLeaderMemberId).toBeNull();
    expect(await seats(row.id)).toHaveLength(1);
    expect(t.gateway.memberRoleNames(USER)).not.toContain('Noite');
    expect(await events(t, 'squad.left')).toEqual([{ squadId: row.id, discordUserId: USER, reason: 'left' }]);
    const [transfer] = await audits('cerebro/squad-transfer');
    expect(JSON.parse(transfer.details)).toMatchObject({
      fromMemberId: leader?.id,
      toMemberId: other.id,
      reason: 'left',
    });

    const blocked = await cmd(OTHER, 'esquadrao', 'sair');
    expect(reply(blocked)).toContain('não pode sair');
  });

  it('still refuses leader leave without a co-leader', async () => {
    await world();
    await approve('Noite');
    const blocked = await cmd(USER, 'esquadrao', 'sair');
    expect(reply(blocked)).toContain('não pode sair');
  });

  it('clears the co-leader column when the co-leader leaves', async () => {
    await world();
    const row = await approve('Noite');
    const other = await memberOnSquad(OTHER, 'Luz Norte', row.code ?? '');
    await squads().setCoLeader({ discordUserId: USER, targetDiscordUserId: OTHER });
    const left = await cmd(OTHER, 'esquadrao', 'sair');
    expect(reply(left)).toContain('saiu');
    expect((await rowNamed('Noite')).coLeaderMemberId).toBeNull();
    expect((await rowNamed('Noite')).founderMemberId).toBe((await repo().memberByDiscordId(USER))?.id);
    expect(await seats(row.id)).toHaveLength(1);
    expect(other.id).toBeTruthy();
  });
});

describe('server-left and team-switch transfer', () => {
  it('promotes the co-leader when the leader leaves the server', async () => {
    await world();
    const row = await approve('Noite');
    const other = await memberOnSquad(OTHER, 'Luz Norte', row.code ?? '');
    await squads().setCoLeader({ discordUserId: USER, targetDiscordUserId: OTHER });
    await t.runtime.guildEvents.memberRemoved(USER);
    await t.runtime.bus.drain();

    const saved = await rowNamed('Noite');
    expect(saved.status).toBe('active');
    expect(saved.founderMemberId).toBe(other.id);
    expect(saved.coLeaderMemberId).toBeNull();
    expect(await seats(row.id)).toHaveLength(1);
    expect(t.gateway.roles.has(row.roleId ?? '')).toBe(true);
    const post = t.gateway.messages.find((m) => m.msg.embeds?.[0]?.title === 'Liderança transferida');
    expect(post?.channelId).toBe(MOD);
    expect(post?.msg.embeds?.[0]?.description).toContain('**Noite**');
    expect(await events(t, 'squad.left')).toEqual([
      { squadId: row.id, discordUserId: USER, reason: 'left_server' },
    ]);
    const [transfer] = await audits('cerebro/squad-transfer');
    expect(JSON.parse(transfer.details)).toMatchObject({
      toMemberId: other.id,
      reason: 'left_server',
    });
  });

  it('still archives when the leader leaves the server without a co-leader', async () => {
    await world();
    const row = await approve('Noite');
    await memberOnSquad(OTHER, 'Luz Norte', row.code ?? '');
    await t.runtime.guildEvents.memberRemoved(USER);
    await t.runtime.bus.drain();
    expect((await rowNamed('Noite')).status).toBe('archived');
    expect(await seats(row.id)).toHaveLength(0);
    const post = t.gateway.messages.find((m) => m.msg.embeds?.[0]?.title === 'Líder saiu');
    expect(post?.channelId).toBe(MOD);
  });

  it('clears the co-leader on team switch and transfers when the leader switches', async () => {
    await world();
    const row = await approve('Noite');
    await memberOnSquad(OTHER, 'Luz Norte', row.code ?? '');
    await squads().setCoLeader({ discordUserId: USER, targetDiscordUserId: OTHER });

    await move(OTHER, 'xmen');
    expect((await rowNamed('Noite')).coLeaderMemberId).toBeNull();
    expect((await rowNamed('Noite')).founderMemberId).toBe((await repo().memberByDiscordId(USER))?.id);
    expect(await events(t, 'squad.left')).toEqual([
      { squadId: row.id, discordUserId: OTHER, reason: 'team_switch' },
    ]);

    const third = await memberOnSquad(THIRD, 'Vento Sul', row.code ?? '');
    await squads().setCoLeader({ discordUserId: USER, targetDiscordUserId: THIRD });
    await move(USER, 'xmen');
    const saved = await rowNamed('Noite');
    expect(saved.status).toBe('active');
    expect(saved.founderMemberId).toBe(third.id);
    expect(saved.coLeaderMemberId).toBeNull();
    expect(await seats(row.id)).toHaveLength(1);
    const transfers = await audits('cerebro/squad-transfer');
    expect(transfers.some((a) => JSON.parse(a.details).reason === 'team_switch')).toBe(true);
  });
});

describe('founder-tool commands', () => {
  it('registers renomear, coleader and arquivar on /esquadrao', async () => {
    await world();
    const defs = cerebro.commands?.(t.ctxOf(cerebro)) ?? [];
    const opts = (
      defs.find((d) => d.name === 'esquadrao')?.json.options as { name: string }[] | undefined
    )?.map((o) => o.name);
    expect(opts).toEqual(
      expect.arrayContaining([
        'criar',
        'entrar',
        'sair',
        'ver',
        'renomear',
        'coleader',
        'arquivar',
        'conteudo',
      ]),
    );
  });

  it('renomear renames through the slash command', async () => {
    await world();
    await approve('Noite');
    const id = await cmd(USER, 'esquadrao', 'renomear', { nome: 'Aurora' });
    expect(reply(id)).toBe('Esquadrão renomeado para **Aurora**.');
    expect((await rowNamed('Aurora')).name).toBe('Aurora');
  });

  it('coleader sets and clears through the slash command', async () => {
    await world();
    const row = await approve('Noite');
    const other = await memberOnSquad(OTHER, 'Luz Norte', row.code ?? '');
    const set = await cmd(USER, 'esquadrao', 'coleader', { membro: OTHER });
    expect(reply(set)).toBe('Co-líder de **Noite** atualizado.');
    expect((await rowNamed('Noite')).coLeaderMemberId).toBe(other.id);
    const cleared = await cmd(USER, 'esquadrao', 'coleader');
    expect(reply(cleared)).toBe('Co-líder de **Noite** removido.');
    expect((await rowNamed('Noite')).coLeaderMemberId).toBeNull();
  });

  it('arquivar archives through the player slash command', async () => {
    await world();
    const row = await approve('Noite');
    const id = await cmd(USER, 'esquadrao', 'arquivar', { motivo: 'fim de temporada' });
    expect(reply(id)).toBe('Esquadrão **Noite** arquivado. Os membros continuam na equipe.');
    expect((await rowNamed('Noite')).status).toBe('archived');
    expect(await seats(row.id)).toHaveLength(0);
  });
});

describe('co-leader surfaces', () => {
  it('shows co-leader on /esquadrao ver and lets the co-leader see the invite', async () => {
    await world();
    const row = await approve('Noite');
    await memberOnSquad(OTHER, 'Luz Norte', row.code ?? '');
    const empty = await cmd(USER, 'esquadrao', 'ver');
    expect(t.gateway.lastReply(empty)?.embeds?.[0]?.description ?? '').toContain('Co-líder: —');

    await squads().setCoLeader({ discordUserId: USER, targetDiscordUserId: OTHER });
    const filled = await cmd(USER, 'esquadrao', 'ver');
    const filledText = t.gateway.lastReply(filled)?.embeds?.[0]?.description ?? '';
    expect(filledText).toContain('Co-líder: Luz Norte');
    expect(filledText).toContain(row.code ?? 'missing');

    const asCo = await cmd(OTHER, 'esquadrao', 'ver');
    const coText = t.gateway.lastReply(asCo)?.embeds?.[0]?.description ?? '';
    expect(coText).toContain(`https://discord.gg/${row.inviteCode}`);
    expect(coText).toContain(row.code ?? 'missing');
  });

  it('adds a co-leader column on the cerebro/squads dashboard panel', async () => {
    await world();
    const row = await approve('Noite');
    await memberOnSquad(OTHER, 'Luz Norte', row.code ?? '');
    const before = await t.runtime.dashboard.get('cerebro', 'squads')?.render();
    expect(before?.kind).toBe('table');
    if (before?.kind === 'table') {
      expect(before.columns).toContain('Co-líder');
      const night = before.rows.find((r) => r[0] === 'Noite');
      expect(night?.[3]).toBe('—');
    }

    await squads().setCoLeader({ discordUserId: USER, targetDiscordUserId: OTHER });
    const after = await t.runtime.dashboard.get('cerebro', 'squads')?.render();
    expect(after?.kind).toBe('table');
    if (after?.kind === 'table') {
      const night = after.rows.find((r) => r[0] === 'Noite');
      expect(night?.[3]).toBe('Luz Norte');
    }
  });
});
