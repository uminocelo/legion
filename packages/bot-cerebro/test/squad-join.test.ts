import { coreTables, type TestContext } from '@legion/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { CerebroRepo } from '../src/db/repo.js';
import { cerebroTables } from '../src/db/tables.js';
import { cerebro } from '../src/index.js';
import { CH, events, FIELDS, join, register, setupCerebro, USER } from './helpers.js';

const STAFF = '400000000000000099';
const OTHER = '400000000000000002';
const THIRD = '400000000000000003';
const MOD = '300000000000000090';
const SQUAD_CH = '300000000000000091';
const BOT_ROLE = '900000000000000099';
const SQUAD_PERMS = ['ManageGuild', 'CreateInstantInvite', 'CreatePrivateThreads', 'ManageThreads'];

let t: TestContext;
afterEach(async () => t?.close());

const reply = (id: string) => t.gateway.lastReply(id)?.content ?? '';
const council = () => t.gateway.roleByName('Conselho da Legião')?.id ?? '';
const repo = () => new CerebroRepo(t.db, t.gateway.guildId, t.clock, t.runtime.newId);
const tables = () => cerebroTables(t.db);
const cmd = (userId: string, commandName: string, subcommand: string, options: Record<string, string> = {}) =>
  t.interact({ kind: 'command', userId, commandName, subcommand, options });
const criar = (userId: string, nome: string, base = 'avengers') =>
  cmd(userId, 'esquadrao', 'criar', { nome, base });
const entrar = (userId: string, codigo: string) => cmd(userId, 'esquadrao', 'entrar', { codigo });
const labelsOf = (id: string) =>
  (t.gateway.lastReply(id)?.components ?? [])
    .flat()
    .map((c) => ('label' in c ? c.label : ''))
    .filter(Boolean);

async function world(squads: Record<string, unknown> = {}) {
  t = await setupCerebro({
    squads: { enabled: true, founderRole: 'staff_council', ...squads },
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

/** Walks to the squad offer, which replaces the archetype screen when squads are on. */
async function toOrigin(userId: string, origin = 'mutante') {
  await join(t, userId);
  await t.interact({ kind: 'component', userId, customId: 'cerebro:v1:start' });
  await t.interact({ kind: 'component', userId, customId: 'cerebro:v1:rules' });
  return t.interact({
    kind: 'component',
    userId,
    customId: 'cerebro:v1:origin',
    values: [origin],
  });
}

async function finish(userId: string, codinome: string) {
  await t.interact({ kind: 'component', userId, customId: 'cerebro:v1:archetype', values: ['Elemental'] });
  return t.interact({
    kind: 'modal',
    userId,
    customId: 'cerebro:v1:mutant',
    fields: { ...FIELDS, codinome },
  });
}

const move = (who: string, to: string) =>
  cmd(STAFF, 'cerebro', 'equipe mover', { membro: who, equipe: to, motivo: 'Pedido em #suporte' });

describe('invite link', () => {
  it('hints the one squad whose invite grew, then joins that team', async () => {
    await world();
    const row = await approve('Noite');
    t.gateway.noteInviteUse(row.inviteCode ?? '');
    const offered = await toOrigin(OTHER);
    expect(t.gateway.lastReply(offered)?.embeds?.[0]?.description).toBe(
      'Você chegou pelo convite do esquadrão **Noite** (🟡 Vingadores). Entrar?',
    );
    expect(labelsOf(offered)).toContain('Entrar');
    const joined = await t.interact({ kind: 'component', userId: OTHER, customId: 'cerebro:v1:squad-join' });
    expect(reply(joined)).toBe('Você entrou em **Noite** (Vingadores).');
    const member = await repo().memberByDiscordId(OTHER);
    expect(member?.faction).toBe('avengers');
    expect(member?.pendingSquadId).toBeNull();
    expect(await seats(row.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ memberId: member?.id, via: 'link' })]),
    );
    expect(await events(t, 'squad.joined')).toEqual(
      expect.arrayContaining([{ squadId: row.id, discordUserId: OTHER, via: 'link' }]),
    );
    expect(t.gateway.memberRoleNames(OTHER)).toContain('Noite');
    await finish(OTHER, 'Luz Norte');
    const changes = await repo().factionChanges(member?.id ?? '');
    expect(changes.map((c) => c.reason)).toEqual(['squad']);
    expect(changes[0]).toMatchObject({ fromFaction: null, toFaction: 'avengers' });
    expect(t.gateway.memberRoleNames(OTHER)).toEqual(expect.arrayContaining(['Noite', 'Vingadores']));
  });

  it('sets no hint when zero invites grew or two invites grew', async () => {
    await world({ maxPerFounder: 2 });
    const noite = await approve('Noite');
    const aurora = await approve('Aurora');
    t.gateway.noteInviteUse(noite.inviteCode ?? '');
    t.gateway.noteInviteUse(aurora.inviteCode ?? '');
    await join(t, OTHER);
    expect((await repo().memberByDiscordId(OTHER))?.pendingSquadId).toBeNull();

    const first = t;
    await world();
    await first.close();
    await approve('Noite');
    await join(t, OTHER);
    expect((await repo().memberByDiscordId(OTHER))?.pendingSquadId).toBeNull();
  });

  it('keeps a hint when a later join is ambiguous, and ignores a forgotten code', async () => {
    await world();
    const row = await approve('Noite');
    t.gateway.noteInviteUse(row.inviteCode ?? '');
    await join(t, OTHER);
    expect((await repo().memberByDiscordId(OTHER))?.pendingSquadId).toBe(row.id);

    await t.runtime.guildEvents.memberRemoved(OTHER);
    await join(t, OTHER);
    expect((await repo().memberByDiscordId(OTHER))?.pendingSquadId).toBe(row.id);

    await join(t, THIRD);
    expect((await repo().memberByDiscordId(THIRD))?.pendingSquadId).toBeNull();
    expect((await repo().memberByDiscordId(OTHER))?.pendingSquadId).toBe(row.id);

    await t.runtime.guildEvents.inviteDeleted(row.inviteCode ?? '');
    t.gateway.noteInviteUse(row.inviteCode ?? '');
    const fourth = '400000000000000004';
    await join(t, fourth);
    expect((await repo().memberByDiscordId(fourth))?.pendingSquadId).toBeNull();
    expect((await repo().memberByDiscordId(OTHER))?.pendingSquadId).toBe(row.id);
  });

  it('skip clears the hint and continues registration', async () => {
    await world();
    const row = await approve('Noite');
    t.gateway.noteInviteUse(row.inviteCode ?? '');
    await toOrigin(OTHER);
    const skipped = await t.interact({ kind: 'component', userId: OTHER, customId: 'cerebro:v1:squad-skip' });
    const screen = t.gateway.lastReply(skipped);
    expect((screen?.components?.[0]?.[0] as { customId?: string } | undefined)?.customId).toContain('pmain');
    expect((await repo().memberByDiscordId(OTHER))?.pendingSquadId).toBeNull();
    expect(await seats(row.id)).toHaveLength(1);
  });
});

describe('joining by code', () => {
  it('accepts the modal and /esquadrao entrar', async () => {
    await world();
    const row = await approve('Noite');
    const offered = await toOrigin(OTHER);
    expect(labelsOf(offered)).toContain('Tenho um código de esquadrão');
    const open = await t.interact({ kind: 'component', userId: OTHER, customId: 'cerebro:v1:squad-code' });
    expect(t.gateway.repliesTo(open).at(-1)?.kind).toBe('showModal');
    const modal = await t.interact({
      kind: 'modal',
      userId: OTHER,
      customId: 'cerebro:v1:squad-code-modal',
      fields: { codigo: (row.code ?? '').toLowerCase() },
    });
    expect(reply(modal)).toBe('Você entrou em **Noite** (Vingadores).');
    const member = await repo().memberByDiscordId(OTHER);
    expect(await seats(row.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ memberId: member?.id, via: 'code' })]),
    );

    await register(t, THIRD, { fields: { codinome: 'Sul Vivo' } });
    const byCommand = await entrar(THIRD, row.code ?? '');
    expect(reply(byCommand)).toBe('Você entrou em **Noite** (Vingadores).');
    const third = await repo().memberByDiscordId(THIRD);
    expect(await seats(row.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ memberId: third?.id, via: 'code' })]),
    );
  });

  it('refuses a bad origin and a hero who is already on another team', async () => {
    await world();
    const row = await approve('Luz', 'brotherhood');
    t.gateway.noteInviteUse(row.inviteCode ?? '');
    await toOrigin(OTHER, 'tecnologia');
    const refused = await t.interact({ kind: 'component', userId: OTHER, customId: 'cerebro:v1:squad-join' });
    expect(reply(refused)).toMatch(/Irmandade/);
    expect(reply(refused)).toMatch(/não aceita essa origem/);
    expect(
      (t.gateway.lastReply(refused)?.components?.[0]?.[0] as { customId?: string } | undefined)?.customId,
    ).toContain('pmain');
    expect((await repo().memberByDiscordId(OTHER))?.pendingSquadId).toBeNull();
    expect(await seats(row.id)).toHaveLength(1);

    await register(t, THIRD, { fields: { codinome: 'Sul Vivo' } });
    await move(THIRD, 'xmen');
    const otherTeam = await entrar(THIRD, row.code ?? '');
    expect(reply(otherTeam)).toContain('Troque de equipe primeiro');
    expect((await repo().memberByDiscordId(THIRD))?.faction).toBe('xmen');
  });

  it('refuses a hero who is already in a squad', async () => {
    await world({ maxPerFounder: 2 });
    const noite = await approve('Noite');
    const aurora = await approve('Aurora');
    await register(t, OTHER, { fields: { codinome: 'Luz Norte' } });
    expect(reply(await entrar(OTHER, noite.code ?? ''))).toBe('Você entrou em **Noite** (Vingadores).');
    const again = await entrar(OTHER, aurora.code ?? '');
    expect(reply(again)).toBe('Você já está em um esquadrão.');
    expect((await repo().memberByDiscordId(OTHER))?.faction).toBe('avengers');
    expect(await seats(aurora.id)).toHaveLength(0);
    expect(await seats(noite.id)).toHaveLength(2);
  });

  it('gives the last seat to one of two joins', async () => {
    await world({ maxMembers: 2 });
    const row = await approve('Noite');
    await register(t, OTHER, { fields: { codinome: 'Luz Norte' } });
    await register(t, THIRD, { fields: { codinome: 'Sul Vivo' } });
    const [a, b] = await Promise.all([entrar(OTHER, row.code ?? ''), entrar(THIRD, row.code ?? '')]);
    const texts = [reply(a), reply(b)].sort();
    expect(texts).toContain('Você entrou em **Noite** (Vingadores).');
    expect(texts).toContain('Esse esquadrão está cheio (2 membros).');
    expect(await seats(row.id)).toHaveLength(2);
  });

  it('limits unknown codes and ignores inactive ones', async () => {
    await world({ maxPerFounder: 2 });
    const noite = await approve('Noite');
    const aurora = await approve('Aurora');
    await register(t, OTHER, { fields: { codinome: 'Luz Norte' } });
    for (let n = 0; n < 5; n++) expect(reply(await entrar(OTHER, 'ZZZZZZ'))).toBe('Código inválido.');
    const limited = await entrar(OTHER, noite.code ?? '');
    expect(reply(limited)).toBe('Muitas tentativas com código errado. Espere 10 min e tente de novo.');
    expect(reply(limited)).not.toContain('Calma');
    expect(await seats(noite.id)).toHaveLength(1);

    t.clock.advance(10 * 60 * 1000);
    expect(reply(await entrar(OTHER, noite.code ?? ''))).toBe('Você entrou em **Noite** (Vingadores).');

    await register(t, THIRD, { fields: { codinome: 'Sul Vivo' } });
    await cmd(STAFF, 'cerebro', 'esquadrao arquivar', { esquadrao: aurora.id, motivo: 'fim do arco' });
    for (let n = 0; n < 5; n++)
      expect(reply(await entrar(THIRD, aurora.code ?? ''))).toBe('Esse esquadrão não está ativo.');
    expect(reply(await entrar(THIRD, 'YYYYYY'))).toBe('Código inválido.');
  });

  it('recreates the thread once when the member cannot be added', async () => {
    await world();
    const row = await approve('Noite');
    await register(t, OTHER, { fields: { codinome: 'Luz Norte' } });
    t.gateway.failNext('addThreadMember');
    const id = await entrar(OTHER, row.code ?? '');
    expect(reply(id)).toBe('Você entrou em **Noite** (Vingadores).');
    const saved = await rowNamed('Noite');
    expect(saved.threadId).not.toBe(row.threadId);
    expect([...(t.gateway.threadMembers.get(saved.threadId ?? '') ?? [])]).toContain(OTHER);
    expect(await seats(row.id)).toHaveLength(2);
  });

  it('replaces a deleted invite when the leader opens /esquadrao ver', async () => {
    await world();
    const row = await approve('Noite');
    const old = row.inviteCode ?? '';
    await t.gateway.deleteInvite(old);
    const id = await cmd(USER, 'esquadrao', 'ver');
    const saved = await rowNamed('Noite');
    expect(saved.inviteCode).not.toBe(old);
    expect(t.gateway.lastReply(id)?.embeds?.[0]?.description).toContain(saved.inviteCode ?? '');
    expect(t.gateway.invites.has(saved.inviteCode ?? '')).toBe(true);

    await t.gateway.deleteInvite(saved.inviteCode ?? '');
    t.gateway.failNext('createInvite');
    const again = await cmd(USER, 'esquadrao', 'ver');
    expect(t.gateway.lastReply(again)?.embeds?.[0]?.description).toContain(saved.inviteCode ?? '');
    expect((await rowNamed('Noite')).inviteCode).toBe(saved.inviteCode);
  });
});

describe('leaving a squad because of the team or the server', () => {
  it('drops the seat on a team switch, including the leader, and the squad stays', async () => {
    await world();
    const row = await approve('Noite');
    await register(t, OTHER, { fields: { codinome: 'Luz Norte' } });
    await entrar(OTHER, row.code ?? '');
    await move(OTHER, 'xmen');
    expect(await events(t, 'squad.left')).toEqual([
      { squadId: row.id, discordUserId: OTHER, reason: 'team_switch' },
    ]);
    expect(t.gateway.memberRoleNames(OTHER)).not.toContain('Noite');
    expect([...(t.gateway.threadMembers.get(row.threadId ?? '') ?? [])]).not.toContain(OTHER);
    expect((await rowNamed('Noite')).status).toBe('active');

    const founderId = (await repo().memberByDiscordId(USER))?.id;
    await move(USER, 'xmen');
    const saved = await rowNamed('Noite');
    expect(saved.status).toBe('active');
    expect(saved.founderMemberId).toBe(founderId);
    expect(await seats(row.id)).toHaveLength(0);
    expect(await events(t, 'squad.left')).toEqual([
      { squadId: row.id, discordUserId: OTHER, reason: 'team_switch' },
      { squadId: row.id, discordUserId: USER, reason: 'team_switch' },
    ]);
  });

  it('does nothing when squads are turned off', async () => {
    await world();
    const row = await approve('Noite');
    t.ctxOf(cerebro).config.squads.enabled = false;
    await move(USER, 'xmen');
    expect(await seats(row.id)).toHaveLength(1);
    expect(await events(t, 'squad.left')).toEqual([]);
    expect((await rowNamed('Noite')).status).toBe('active');
  });

  it('removes a member who left the server and does not restore them', async () => {
    await world();
    const row = await approve('Noite');
    await register(t, OTHER, { fields: { codinome: 'Luz Norte' } });
    await entrar(OTHER, row.code ?? '');
    await t.runtime.guildEvents.memberRemoved(OTHER);
    await t.runtime.bus.drain();
    expect(await seats(row.id)).toHaveLength(1);
    expect(await events(t, 'squad.left')).toEqual([
      { squadId: row.id, discordUserId: OTHER, reason: 'left_server' },
    ]);
    expect((await rowNamed('Noite')).status).toBe('active');
    t.gateway.noteInviteUse(row.inviteCode ?? '');
    await join(t, OTHER);
    await t.runtime.bus.drain();
    expect((await repo().memberByDiscordId(OTHER))?.pendingSquadId).toBeNull();
    expect(await seats(row.id)).toHaveLength(1);
  });

  it('archives when the leader leaves the server and tells the mod queue', async () => {
    await world();
    const row = await approve('Noite');
    await register(t, OTHER, { fields: { codinome: 'Luz Norte' } });
    await entrar(OTHER, row.code ?? '');
    await t.runtime.guildEvents.memberRemoved(USER);
    await t.runtime.bus.drain();
    const saved = await rowNamed('Noite');
    expect(saved.status).toBe('archived');
    expect(saved.decidedBy).toBe(USER);
    expect(saved.refuseReason).toBe('left_server');
    expect(await seats(row.id)).toHaveLength(0);
    expect(t.gateway.roles.has(row.roleId ?? '')).toBe(false);
    const post = t.gateway.messages.find((m) => m.msg.embeds?.[0]?.title === 'Líder saiu');
    expect(post?.channelId).toBe(MOD);
    expect(post?.msg.embeds?.[0]?.description).toContain('**Noite**');
    const reasons = (await events(t, 'squad.left')).map((e) => e.reason);
    expect(reasons.sort()).toEqual(['left_server', 'left_server']);
    const audits = await t.db.orm.select().from(coreTables(t.db).coreAuditLog);
    expect(audits.map((a) => a.action)).toEqual(['cerebro/squad-approve']);
  });

  it('leaves the squad active when Discord refuses the cleanup', async () => {
    await world();
    const row = await approve('Noite');
    t.gateway.failNext('deleteRole');
    await t.runtime.guildEvents.memberRemoved(USER);
    await t.runtime.bus.drain();
    expect((await rowNamed('Noite')).status).toBe('active');
    expect(await seats(row.id)).toHaveLength(1);
  });
});

describe('legion doctor: squads', () => {
  const doctor = async () =>
    (await cerebro
      .doctorChecks?.(t.ctxOf(cerebro))
      .find((c) => c.id === 'cerebro.squads')
      ?.run()) ?? null;

  function grant(perms: string[] | undefined) {
    const role = t.gateway.roles.get(BOT_ROLE);
    if (!role) throw new Error('missing bot role');
    role.permissions = perms;
  }

  it('is ok while squads are off', async () => {
    t = await setupCerebro();
    expect(await doctor()).toMatchObject({
      status: 'ok',
      message: 'Desligado (squads.enabled: false)',
    });
  });

  it('fails for each missing permission, warns when it cannot read them, and warns on a deleted invite', async () => {
    await world();
    const labels: Record<string, string> = {
      ManageGuild: 'Gerenciar servidor',
      CreateInstantInvite: 'Criar convite',
      CreatePrivateThreads: 'Criar tópicos privados',
      ManageThreads: 'Gerenciar tópicos',
    };
    for (const drop of SQUAD_PERMS) {
      grant(SQUAD_PERMS.filter((p) => p !== drop));
      const res = await doctor();
      expect(res?.status, drop).toBe('fail');
      expect(res?.message, drop).toContain(labels[drop]);
    }
    grant(SQUAD_PERMS);
    expect(await doctor()).toMatchObject({
      status: 'ok',
      message: 'Permissões e canais de esquadrão ok',
    });
    grant(undefined);
    expect((await doctor())?.status).toBe('warn');
    expect((await doctor())?.message).toContain('Não consegui ler as permissões do bot.');

    grant(SQUAD_PERMS);
    const row = await approve('Noite');
    await t.gateway.deleteInvite(row.inviteCode ?? '');
    const lost = await doctor();
    expect(lost?.status).toBe('warn');
    expect(lost?.message).toContain('Convite apagado: Noite');
  });
});
