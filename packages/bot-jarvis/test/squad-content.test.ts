import { cerebro, cerebroTables } from '@legion/bot-cerebro';
import { coreTables, createTestContext, type TestContext } from '@legion/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { jarvis } from '../src/index.js';
import { servicesOf } from './helpers.js';

const USER = '400000000000000001';
const STAFF = '400000000000000099';
const OTHER = '400000000000000002';
const MOD = '300000000000000090';
const SQUAD_CH = '300000000000000091';
const WELCOME = '300000000000000001';
const RULES = '300000000000000002';
const REGISTRY = '300000000000000003';
const CDN = 'https://cdn.discordapp.com/attachments/1/2/';

const MISSION_YAML = `
id: noite-patrol
kind: daily
title: Patrulha Noite
summary: Missão do esquadrão.
squad: Noite
start: a
scenes:
  a:
    text: Início
    choices:
      - { label: Sim, next: b }
      - { label: Não, next: c }
  b: { text: Fim bom, end: success }
  c: { text: Fim ruim, end: failure }
`;

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const reply = (id: string) => t!.gateway.lastReply(id)?.content ?? '';
const council = () => t!.gateway.roleByName('Conselho da Legião')?.id ?? '';

async function world() {
  t = await createTestContext({
    bots: [cerebro, jarvis],
    config: {
      squads: { enabled: true, founderRole: 'staff_council' },
      channels: { welcome: WELCOME, rules: RULES, registry: REGISTRY, modQueue: MOD },
    },
  });
  for (const [name, id] of Object.entries({
    welcome: WELCOME,
    rules: RULES,
    registry: REGISTRY,
    general: '300000000000000004',
  }))
    t.gateway.addChannel({ id, name });
  t.gateway.addChannel({ id: MOD, name: 'mod-queue' });
  t.gateway.addChannel({ id: SQUAD_CH, name: 'esquadroes' });
  for (const f of t.ctxOf(cerebro).config.factions) {
    if (f.key !== 'independent') f.squadChannelId = SQUAD_CH;
  }
  await t.runtime.ready({ startPolling: false });
  t.gateway.addMember({ userId: USER, roleIds: [council()] });
  t.gateway.addMember({ userId: STAFF, roleIds: [council()] });
  await register(USER);
  return t;
}

async function register(userId: string, fields: { codinome?: string } = {}) {
  const member = t!.gateway.members.get(userId) ?? t!.gateway.addMember({ userId });
  await t!.runtime.guildEvents.memberAdded(member);
  await t!.runtime.bus.drain();
  await t!.interact({ kind: 'component', userId, customId: 'cerebro:v1:start' });
  await t!.interact({ kind: 'component', userId, customId: 'cerebro:v1:rules' });
  const originId = await t!.interact({
    kind: 'component',
    userId,
    customId: 'cerebro:v1:origin',
    values: ['mutante'],
  });
  const offered = t!.gateway.lastReply(originId)?.components?.flat() ?? [];
  if (offered.some((b) => 'customId' in b && b.customId?.includes('squad-skip')))
    await t!.interact({ kind: 'component', userId, customId: 'cerebro:v1:squad-skip' });
  await t!.interact({ kind: 'component', userId, customId: 'cerebro:v1:archetype', values: ['Elemental'] });
  await t!.interact({
    kind: 'modal',
    userId,
    customId: 'cerebro:v1:mutant',
    fields: {
      codinome: fields.codinome ?? (userId === USER ? 'Faísca Rubra' : `Hero${userId.slice(-4)}`),
      poder: 'Cria faíscas',
      origem: 'Tempestade.',
    },
  });
}

function upload(text: string, name = 'missao.yaml') {
  const url = `${CDN}${name}`;
  t!.gateway.cdn.set(url, text);
  return { url, name, size: Buffer.byteLength(text), contentType: 'text/yaml' };
}

const enviar = (userId: string, att?: ReturnType<typeof upload>) =>
  t!.interact({
    kind: 'command',
    userId,
    commandName: 'esquadrao',
    subcommand: 'conteudo enviar',
    ...(att ? { attachments: { arquivo: att } } : {}),
  });

async function approveSquad(name: string) {
  const criarId = await t!.interact({
    kind: 'command',
    userId: USER,
    commandName: 'esquadrao',
    subcommand: 'criar',
    options: { nome: name, base: 'avengers' },
  });
  const s = cerebroTables(t!.db).cerebroSquads;
  const [row] = await t!.db.orm.select().from(s).where(eq(s.name, name));
  if (!row) throw new Error(`missing squad (${reply(criarId)})`);
  await t!.interact({
    kind: 'component',
    userId: STAFF,
    customId: `cerebro:v1:squad-approve:${row.id}`,
  });
  return row;
}

describe('/esquadrao conteudo enviar', () => {
  it('refuses a non-founder', async () => {
    await world();
    await approveSquad('Noite');
    t!.gateway.addMember({ userId: OTHER, roleIds: [council()] });
    await register(OTHER, { codinome: 'Luz Norte' });
    const id = await enviar(OTHER, upload(MISSION_YAML));
    expect(reply(id)).toMatch(/Só o líder/);
  });

  it('founder submit → staff approve → mission is squad-scoped', async () => {
    await world();
    const squad = await approveSquad('Noite');
    const id = await enviar(USER, upload(MISSION_YAML));
    expect(reply(id)).toMatch(/enviado à staff/);
    const post = t!.gateway
      .callsOf('sendMessage')
      .map((c) => c[1] as { embeds?: { title?: string }[]; components?: { customId: string }[][] })
      .find((m) => m.embeds?.[0]?.title === 'Conteúdo de esquadrão');
    expect(post).toBeTruthy();
    const approve = post?.components?.[0]?.find((b) =>
      b.customId.includes('squad-content:approve:'),
    )?.customId;
    expect(approve).toBeTruthy();
    const decided = await t!.interact({ kind: 'component', userId: STAFF, customId: approve ?? '' });
    expect(reply(decided)).toMatch(/publicado/);

    const s = servicesOf(t!);
    const row = await s.repo.mission('noite-patrol');
    expect(row).toMatchObject({ squadId: squad.id, origin: 'staff', importedBy: STAFF, active: 1 });

    t!.gateway.addMember({ userId: OTHER });
    await register(OTHER, { codinome: 'Fora Squad' });
    const startIn = await t!.interact({
      kind: 'command',
      userId: USER,
      commandName: 'missao',
      subcommand: 'iniciar',
      options: { missao: 'noite-patrol' },
    });
    expect(t!.gateway.lastReply(startIn)?.content).toMatch(/Missão iniciada|Grupo aberto/);
    const startOut = await t!.interact({
      kind: 'command',
      userId: OTHER,
      commandName: 'missao',
      subcommand: 'iniciar',
      options: { missao: 'noite-patrol' },
    });
    expect(t!.gateway.lastReply(startOut)?.content).toMatch(/Não encontrei essa missão/);

    const audits = await t!.db.orm
      .select()
      .from(coreTables(t!.db).coreAuditLog)
      .where(eq(coreTables(t!.db).coreAuditLog.action, 'cerebro/squad-content-approve'));
    expect(audits).toHaveLength(1);
  });

  it('refuse leaves no mission row', async () => {
    await world();
    await approveSquad('Noite');
    await enviar(USER, upload(MISSION_YAML));
    const post = t!.gateway
      .callsOf('sendMessage')
      .map((c) => c[1] as { embeds?: { title?: string }[]; components?: { customId: string }[][] })
      .find((m) => m.embeds?.[0]?.title === 'Conteúdo de esquadrão');
    const refuse = post?.components?.[0]?.find((b) => b.customId.includes('squad-content:refuse:'))?.customId;
    const decided = await t!.interact({ kind: 'component', userId: STAFF, customId: refuse ?? '' });
    expect(reply(decided)).toMatch(/recusado/);
    expect(await servicesOf(t!).repo.mission('noite-patrol')).toBeNull();
  });

  it('bad YAML returns errors and stages nothing', async () => {
    await world();
    await approveSquad('Noite');
    const before = t!.gateway.callsOf('sendMessage').length;
    const id = await enviar(USER, upload('not: valid: yaml: [[['));
    expect(reply(id)).toMatch(/erros e nada foi enviado/);
    const contentPosts = t!.gateway
      .callsOf('sendMessage')
      .slice(before)
      .filter(
        (c) => (c[1] as { embeds?: { title?: string }[] }).embeds?.[0]?.title === 'Conteúdo de esquadrão',
      );
    expect(contentPosts).toHaveLength(0);
  });

  it('refuses when jarvis provider is missing', async () => {
    t = await createTestContext({
      bots: [cerebro],
      config: {
        squads: { enabled: true, founderRole: 'staff_council' },
        channels: { welcome: WELCOME, rules: RULES, registry: REGISTRY, modQueue: MOD },
      },
    });
    for (const [name, id] of Object.entries({ welcome: WELCOME, rules: RULES, registry: REGISTRY }))
      t.gateway.addChannel({ id, name });
    t.gateway.addChannel({ id: MOD, name: 'mod-queue' });
    t.gateway.addChannel({ id: SQUAD_CH, name: 'esquadroes' });
    for (const f of t.ctxOf(cerebro).config.factions) {
      if (f.key !== 'independent') f.squadChannelId = SQUAD_CH;
    }
    await t.runtime.ready({ startPolling: false });
    t.gateway.addMember({ userId: USER, roleIds: [council()] });
    t.gateway.addMember({ userId: STAFF, roleIds: [council()] });
    await register(USER);
    await approveSquad('Noite');
    const id = await enviar(USER, upload(MISSION_YAML));
    expect(reply(id)).toMatch(/J\.A\.R\.V\.I\.S/);
  });
});
