import { coreTables, type TestContext } from '@legion/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { CerebroRepo } from '../src/db/repo.js';
import { cerebroTables } from '../src/db/tables.js';
import { cerebro } from '../src/index.js';
import { CH, events, register, setupCerebro, USER } from './helpers.js';

const STAFF = '400000000000000099';
const OTHER = '400000000000000002';
const MOD = '300000000000000090';
const SQUAD_CH = '300000000000000091';

let t: TestContext;
afterEach(async () => t?.close());

const reply = (id: string) => t.gateway.lastReply(id)?.content ?? '';
const council = () => t.gateway.roleByName('Conselho da Legião')?.id ?? '';
const repo = () => new CerebroRepo(t.db, t.gateway.guildId, t.clock, t.runtime.newId);
const tables = () => cerebroTables(t.db);

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

const cmd = (userId: string, commandName: string, subcommand: string, options: Record<string, string> = {}) =>
  t.interact({ kind: 'command', userId, commandName, subcommand, options });

const criar = (userId: string, nome: string, base = 'avengers') =>
  cmd(userId, 'esquadrao', 'criar', { nome, base });

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

describe('/esquadrao criar', () => {
  it('refuses when squads are off', async () => {
    t = await setupCerebro();
    t.gateway.addMember({ userId: USER });
    await register(t, USER);
    const id = await criar(USER, 'Noite', 'avengers');
    expect(reply(id)).toBe('Esquadrões estão desligados neste servidor.');
  });

  it('refuses a visitor, a short name, a canon name and Independente', async () => {
    await world();
    const stranger = await criar(STAFF, 'Noite');
    expect(reply(stranger)).toBe('Você ainda não é um herói registrado.');
    expect(reply(await criar(USER, 'ab'))).toBe('O nome precisa ter entre 3 e 32 caracteres.');
    expect(reply(await criar(USER, 'Wolverine'))).toBe(
      'Esse nome parece um personagem ou equipe da Marvel. Escolha um nome original.',
    );
    expect(reply(await criar(USER, 'Noite', 'independent'))).toBe(
      'Escolha uma equipe ativa que não seja Independente.',
    );
  });

  it('refuses someone without the founder role, and lets staff through', async () => {
    await world();
    await register(t, OTHER, { fields: { codinome: 'Luz Norte' } });
    expect(reply(await criar(OTHER, 'Noite'))).toBe(
      'Só quem tem o cargo de fundador (ou a staff) pode criar um esquadrão.',
    );
    t.ctxOf(cerebro).config.squads.founderRole = '999000000000000001';
    expect(reply(await criar(STAFF, 'Noite'))).toBe('Você ainda não é um herói registrado.');
    await register(t, STAFF, { fields: { codinome: 'Voz Alta' } });
    expect(reply(await criar(STAFF, 'Noite'))).toContain('Pedido enviado');
  });

  it('refuses an origin the base team does not allow', async () => {
    await world();
    t.gateway.addMember({ userId: OTHER, roleIds: [council()] });
    await register(t, OTHER, { origin: 'tecnologia', fields: { codinome: 'Luz Norte' } });
    expect(reply(await criar(OTHER, 'Luz', 'brotherhood'))).toBe('Sua origem não pode entrar nessa equipe.');
  });

  it('refuses a taken name, a second pending request and the server cap', async () => {
    await world({ maxPerFounder: 2, maxSquads: 2 });
    expect(reply(await criar(USER, 'Noite'))).toBe(
      'Pedido enviado. A staff vai aprovar ou recusar **Noite**.',
    );
    t.gateway.addMember({ userId: OTHER, roleIds: [council()] });
    await register(t, OTHER, { fields: { codinome: 'Luz Norte' } });
    expect(reply(await criar(OTHER, 'NOITE'))).toBe('Já existe um esquadrão chamado **NOITE**.');
    expect(reply(await criar(USER, 'Aurora'))).toBe('Você já tem o máximo de esquadrões (2).');
    t.ctxOf(cerebro).config.squads.maxSquads = 1;
    expect(reply(await criar(OTHER, 'Aurora'))).toBe('O servidor chegou ao limite de 1 esquadrões.');
  });

  it('posts the request to the mod queue and emits squad.created', async () => {
    await world();
    await criar(USER, 'Noite');
    const post = t.gateway.callsOf('sendMessage').find((c) => c[0] === MOD)?.[1] as {
      embeds?: { title?: string; description?: string }[];
      components?: { customId: string; label: string }[][];
    };
    expect(post.embeds?.[0]).toMatchObject({
      title: 'Novo esquadrão',
      description: '**Noite** quer fundar um esquadrão em 🟡 Vingadores.',
    });
    expect(post.components?.[0]?.map((b) => b.label)).toEqual(['Aprovar', 'Recusar']);
    const row = await rowNamed('Noite');
    expect(post.components?.[0]?.[0]?.customId).toBe(`cerebro:v1:squad-approve:${row?.id}`);
    expect(await events(t, 'squad.created')).toEqual([
      {
        squadId: row?.id,
        name: 'Noite',
        baseFaction: 'avengers',
        founderDiscordId: USER,
      },
    ]);
    expect(row?.status).toBe('requested');
    expect(row?.roleId).toBeNull();
  });
});

describe('staff decisions', () => {
  async function pending(name = 'Noite') {
    await world();
    await criar(USER, name);
    return rowNamed(name);
  }

  it('refuses a non-staff button and a staff click approves', async () => {
    const row = await pending();
    const denied = await t.interact({
      kind: 'component',
      userId: OTHER,
      customId: `cerebro:v1:squad-approve:${row.id}`,
    });
    expect(reply(denied)).toBe('Apenas a staff (Professor X ou Conselho) pode usar este comando.');
    expect((await rowNamed('Noite'))?.status).toBe('requested');
    const id = await cmd(STAFF, 'cerebro', 'esquadrao aprovar', { esquadrao: row.id });
    expect(reply(id)).toMatch(/^Esquadrão \*\*Noite\*\* aprovado\. Código: `[A-HJ-NP-Z2-8]{6}`\.$/);
    const saved = await rowNamed('Noite');
    expect(saved?.status).toBe('active');
    expect(saved?.code).toMatch(/^[A-HJ-NP-Z2-8]{6}$/);
    expect(t.gateway.roles.get(saved?.roleId ?? '')?.name).toBe('Noite');
    const created = t.gateway.callsOf('createRole').map((c) => c[0] as { name: string });
    expect(created.find((r) => r.name === 'Noite')).toMatchObject({
      name: 'Noite',
      color: 0x5865f2,
      hoist: false,
      mentionable: false,
    });
    expect(t.gateway.callsOf('createPrivateThread').some((c) => c[0] === SQUAD_CH)).toBe(true);
    expect(t.gateway.invites.get(saved?.inviteCode ?? '')?.channelId).toBe(CH.welcome);
    expect(t.gateway.memberRoleNames(USER)).toContain('Noite');
    expect([...(t.gateway.threadMembers.get(saved?.threadId ?? '') ?? [])]).toEqual([USER]);
    expect(await seats(row.id)).toMatchObject([
      { memberId: (await repo().memberByDiscordId(USER))?.id, via: 'founder' },
    ]);
    expect(await events(t, 'squad.joined')).toEqual([
      { squadId: row.id, discordUserId: USER, via: 'founder' },
    ]);
    const dm = t.gateway.messages.find((m) => m.dm);
    expect(dm?.msg.content).toBe(`Seu esquadrão **Noite** foi aprovado. Código: \`${saved?.code}\`.`);
    const audits = await t.db.orm.select().from(coreTables(t.db).coreAuditLog);
    expect(audits).toMatchObject([
      { source: 'command', action: 'cerebro/squad-approve', actorDiscordId: STAFF, target: row.id },
    ]);
  });

  it('a second approve is not pending, and a parallel approve keeps one squad', async () => {
    const row = await pending();
    const [a, b] = await Promise.all([
      cmd(STAFF, 'cerebro', 'esquadrao aprovar', { esquadrao: row.id }),
      cmd(STAFF, 'cerebro', 'esquadrao aprovar', { esquadrao: 'Noite' }),
    ]);
    const texts = [reply(a), reply(b)].sort();
    expect(texts.filter((x) => x.startsWith('Esquadrão **Noite** aprovado'))).toHaveLength(1);
    expect(texts).toContain('Esse esquadrão não está mais aguardando decisão.');
    expect((await rowNamed('Noite'))?.status).toBe('active');
    expect(await seats(row.id)).toHaveLength(1);
    expect([...t.gateway.roles.values()].filter((r) => r.name === 'Noite')).toHaveLength(1);
  });

  it('keeps the request when Discord fails, then reuses the saved role', async () => {
    const row = await pending();
    t.gateway.failNext('createRole');
    const failed = await cmd(STAFF, 'cerebro', 'esquadrao aprovar', { esquadrao: row.id });
    expect(reply(failed)).toContain('Missing Permissions');
    expect(reply(failed)).toContain('Gerenciar cargos');
    expect((await rowNamed('Noite'))?.status).toBe('requested');
    expect((await rowNamed('Noite'))?.roleId).toBeNull();

    t.gateway.failNext('createPrivateThread');
    const again = await cmd(STAFF, 'cerebro', 'esquadrao aprovar', { esquadrao: row.id });
    expect(reply(again)).toContain('Missing Permissions');
    const halfway = await rowNamed('Noite');
    expect(halfway?.status).toBe('requested');
    expect(halfway?.roleId).toBeTruthy();

    const ok = await cmd(STAFF, 'cerebro', 'esquadrao aprovar', { esquadrao: row.id });
    expect(reply(ok)).toContain('aprovado');
    const noiteRoles = t.gateway
      .callsOf('createRole')
      .filter((c) => (c[0] as { name: string }).name === 'Noite');
    expect(noiteRoles).toHaveLength(2);
    expect((await rowNamed('Noite'))?.roleId).toBe(halfway?.roleId);
  });

  it('names the missing squad channel and the missing welcome channel', async () => {
    const row = await pending();
    const faction = t.ctxOf(cerebro).config.factions.find((f) => f.key === 'avengers');
    if (faction) faction.squadChannelId = undefined;
    const missing = await cmd(STAFF, 'cerebro', 'esquadrao aprovar', { esquadrao: row.id });
    expect(reply(missing)).toContain('squadChannelId');
    expect(reply(missing)).toContain('Vingadores');
    expect((await rowNamed('Noite'))?.roleId).toBeNull();
    if (faction) faction.squadChannelId = SQUAD_CH;
    t.ctxOf(cerebro).config.channels.welcome = '';
    const welcome = await cmd(STAFF, 'cerebro', 'esquadrao aprovar', { esquadrao: row.id });
    expect(reply(welcome)).toContain('channels.welcome');
    expect((await rowNamed('Noite'))?.status).toBe('requested');
  });

  it('refuses from the button modal and still finishes when the founder closed DMs', async () => {
    const row = await pending();
    t.gateway.closedDms.add(USER);
    const open = await t.interact({
      kind: 'component',
      userId: STAFF,
      customId: `cerebro:v1:squad-refuse:${row.id}`,
    });
    expect(t.gateway.repliesTo(open).at(-1)?.kind).toBe('showModal');
    const done = await t.interact({
      kind: 'modal',
      userId: STAFF,
      customId: `cerebro:v1:squad-refuse-modal:${row.id}`,
      fields: { motivo: 'nome fora do tom' },
    });
    expect(reply(done)).toBe('Esquadrão **Noite** recusado.');
    expect((await rowNamed('Noite'))?.status).toBe('refused');
    expect(t.gateway.messages.filter((m) => m.dm)).toHaveLength(0);
    expect(reply(await criar(USER, 'Noite'))).toBe('Já existe um esquadrão chamado **Noite**.');
  });

  it('dashboard refuse says the same thing as the slash command', async () => {
    await world({ maxSquads: 5 });
    t.gateway.addMember({ userId: OTHER, roleIds: [council()] });
    await register(t, OTHER, { fields: { codinome: 'Luz Norte' } });
    await criar(USER, 'Alpha');
    await criar(OTHER, 'Beta');
    const alpha = await rowNamed('Alpha');
    const beta = await rowNamed('Beta');
    const slash = await cmd(STAFF, 'cerebro', 'esquadrao recusar', {
      esquadrao: alpha?.id ?? '',
      motivo: 'fora do tom',
    });
    const action = t.runtime.dashboard.getAction('cerebro', 'squad-refuse');
    const dash = await action?.run(
      { squad: beta?.id ?? '', reason: 'fora do tom' },
      { discordUserId: STAFF, name: 'Staff' },
    );
    expect(dash?.message).toBe(reply(slash).replace('Alpha', 'Beta'));
    expect(dash?.ok).toBe(true);
    const audits = await t.db.orm.select().from(coreTables(t.db).coreAuditLog);
    expect(audits.map((a) => a.source).sort()).toEqual(['command', 'dashboard']);
    const panel = await t.runtime.dashboard.get('cerebro', 'squads')?.render();
    expect(panel?.kind).toBe('table');
    if (panel?.kind === 'table') expect(panel.rows.map((r) => r[0]).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('rejects an empty reason and a squad that is not active', async () => {
    const row = await pending();
    const empty = await cmd(STAFF, 'cerebro', 'esquadrao arquivar', { esquadrao: row.id, motivo: '   ' });
    expect(reply(empty)).toBe('O motivo precisa ter entre 1 e 200 caracteres.');
    const idle = await cmd(STAFF, 'cerebro', 'esquadrao arquivar', { esquadrao: row.id, motivo: 'fim' });
    expect(reply(idle)).toBe('Esse esquadrão não está ativo.');
  });
});

describe('leave and archive', () => {
  it('the leader cannot leave; another member can, and keeps the team', async () => {
    await world();
    await criar(USER, 'Noite');
    const row = await rowNamed('Noite');
    await cmd(STAFF, 'cerebro', 'esquadrao aprovar', { esquadrao: row.id });
    const blocked = await cmd(USER, 'esquadrao', 'sair');
    expect(reply(blocked)).toBe(
      'O líder de **Noite** não pode sair. Nomeie um co-líder com `/esquadrao coleader`, ou arquive com `/esquadrao arquivar`.',
    );
    await register(t, OTHER, { fields: { codinome: 'Luz Norte' } });
    const other = await repo().memberByDiscordId(OTHER);
    await t.db.orm.insert(tables().cerebroSquadMembers).values({
      memberId: other?.id ?? '',
      squadId: row.id,
      joinedAt: '2026-11-16T15:00:00.000Z',
      via: 'code',
    });
    const saved = await rowNamed('Noite');
    const member = t.gateway.members.get(OTHER);
    if (member && saved?.roleId) member.roleIds.push(saved.roleId);
    t.gateway.threadMembers.get(saved?.threadId ?? '')?.add(OTHER);
    const left = await cmd(OTHER, 'esquadrao', 'sair');
    expect(reply(left)).toBe('Você saiu de **Noite**. Sua equipe continua a mesma.');
    expect((await repo().memberByDiscordId(OTHER))?.faction).toBe('independent');
    expect(t.gateway.memberRoleNames(OTHER)).not.toContain('Noite');
    expect(await seats(row.id)).toHaveLength(1);
    expect(await events(t, 'squad.left')).toEqual([
      { squadId: row.id, discordUserId: OTHER, reason: 'left' },
    ]);
  });

  it('archive removes the role, thread and invite and keeps the team', async () => {
    await world();
    await criar(USER, 'Noite');
    const row = await rowNamed('Noite');
    await cmd(STAFF, 'cerebro', 'esquadrao aprovar', { esquadrao: row.id });
    const before = await rowNamed('Noite');
    const id = await cmd(STAFF, 'cerebro', 'esquadrao arquivar', {
      esquadrao: row.id,
      motivo: 'temporada encerrada',
    });
    expect(reply(id)).toBe('Esquadrão **Noite** arquivado. Os membros continuam na equipe.');
    const after = await rowNamed('Noite');
    expect(after?.status).toBe('archived');
    expect(after?.refuseReason).toBe('temporada encerrada');
    expect(t.gateway.roles.get(before?.roleId ?? '')).toBeUndefined();
    expect(t.gateway.channels.get(before?.threadId ?? '')).toBeUndefined();
    expect(t.gateway.invites.has(before?.inviteCode ?? '')).toBe(false);
    expect((await repo().memberByDiscordId(USER))?.faction).toBe('independent');
    expect(await seats(row.id)).toHaveLength(0);
    expect(await events(t, 'squad.left')).toEqual([
      { squadId: row.id, discordUserId: USER, reason: 'archived' },
    ]);
    await register(t, OTHER, { fields: { codinome: 'Luz Norte' } });
    const shown = await cmd(OTHER, 'esquadrao', 'ver', { nome: 'Noite' });
    const embed = t.gateway.lastReply(shown)?.embeds?.[0]?.description ?? '';
    expect(embed).toContain('Líder: Faísca Rubra');
    expect(embed).not.toContain('Convite:');
  });

  it('shows the invite only to the leader, co-leader and staff', async () => {
    await world();
    await criar(USER, 'Noite');
    const row = await rowNamed('Noite');
    await cmd(STAFF, 'cerebro', 'esquadrao aprovar', { esquadrao: row.id });
    const saved = await rowNamed('Noite');
    const leader = await cmd(USER, 'esquadrao', 'ver');
    const leaderText = t.gateway.lastReply(leader)?.embeds?.[0]?.description ?? '';
    expect(leaderText).toContain(`https://discord.gg/${saved?.inviteCode}`);
    expect(leaderText).toContain(saved?.code ?? 'missing');
    expect(leaderText).toContain('Co-líder: —');
    await register(t, OTHER, { fields: { codinome: 'Luz Norte' } });
    const hidden = await cmd(OTHER, 'esquadrao', 'ver', { nome: 'Noite' });
    expect(t.gateway.lastReply(hidden)?.embeds?.[0]?.description ?? '').not.toContain('Código:');
    const staff = await cmd(STAFF, 'esquadrao', 'ver', { nome: row.id });
    expect(t.gateway.lastReply(staff)?.embeds?.[0]?.description ?? '').toContain(saved?.code ?? 'missing');
  });
});
