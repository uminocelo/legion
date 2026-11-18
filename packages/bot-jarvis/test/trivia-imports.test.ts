import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { TRIVIA_IMPORT_MAX } from '../src/index.js';
import { addMember, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const STAFF = '900';
const CDN = 'https://cdn.discordapp.com/attachments/1/2/';
const q = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  category: 'geral',
  difficulty: 'normal',
  question: `Pergunta de teste ${id}?`,
  choices: ['Alfa', 'Beta', 'Gama'],
  answer: 1,
  explanation: 'Porque sim.',
  source: 'Livro de regras (2026)',
  ...over,
});

function upload(tc: TestContext, text: string, name = 'perguntas.yaml') {
  const url = `${CDN}${name}`;
  tc.gateway.cdn.set(url, text);
  return { url, name, size: Buffer.byteLength(text), contentType: 'text/yaml' };
}
const importCmd = (tc: TestContext, text: string, userId = STAFF) =>
  tc.interact({
    kind: 'command',
    userId,
    isGuildOwner: userId === STAFF,
    commandName: 'jarvis',
    subcommand: 'trivia importar',
    attachments: { arquivo: upload(tc, text) },
  });
const reply = (tc: TestContext, id: string) => tc.gateway.lastReply(id);
const buttons = (tc: TestContext, id: string) =>
  (reply(tc, id)?.components?.[0] ?? []).map((b) => ('customId' in b ? (b.customId ?? '') : ''));
const click = (tc: TestContext, customId: string, userId = STAFF) =>
  tc.interact({ kind: 'component', userId, isGuildOwner: userId === STAFF, customId });

describe('/jarvis trivia importar', () => {
  it('previews, then publishes questions that are live at once', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const id = await importCmd(t, stringify([q('srv-0001'), q('srv-0002', { locale: 'en' })]));
    const preview = reply(t, id)?.embeds?.[0];
    expect(preview?.title).toBe('Prévia: perguntas.yaml');
    expect(preview?.description).toMatch(/🆕 2 nova\(s\) · ✏️ 0 alterada\(s\) · ＝ 0 igual\(is\)/);
    expect(preview?.description).toContain('`srv-0001` · Pergunta de teste srv-0001?');
    expect(await s.repo.question('srv-0001')).toBeNull();

    const [publish] = buttons(t, id);
    const done = await click(t, publish ?? '');
    expect(reply(t, done)?.content).toMatch(/Perguntas publicadas: 2 nova\(s\)/);
    expect(await s.repo.question('srv-0001')).toMatchObject({
      active: 1,
      origin: 'staff',
      review: 'approved',
      createdBy: STAFF,
      locale: 'pt-BR',
    });
    expect((await s.repo.question('srv-0002'))?.locale).toBe('en');
    expect(reply(t, await click(t, publish ?? ''))?.content).toMatch(/expirou ou já foi usada/);
  });

  it('round-trips with /jarvis trivia exportar: unchanged questions stay, edited ones update', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const first = await importCmd(t, stringify([q('srv-0001'), q('srv-0002')]));
    await click(t, buttons(t, first)[0] ?? '');

    const exp = await t.interact({
      kind: 'command',
      userId: STAFF,
      isGuildOwner: true,
      commandName: 'jarvis',
      subcommand: 'trivia exportar',
    });
    const file = reply(t, exp)?.files?.[0];
    expect(file?.name).toBe('trivia-staff.yaml');
    const exported = String(file?.content);

    const same = await importCmd(t, exported);
    expect(reply(t, same)?.embeds?.[0]?.description).toMatch(/🆕 0 .* ✏️ 0 .* ＝ 2/);

    const edited = exported.replace('Pergunta de teste srv-0002?', 'Pergunta revisada srv-0002?');
    const second = await importCmd(t, edited);
    expect(reply(t, second)?.embeds?.[0]?.description).toMatch(/✏️ 1 alterada\(s\) · ＝ 1/);
    await click(t, buttons(t, second)[0] ?? '');
    expect((await s.repo.question('srv-0002'))?.question).toBe('Pergunta revisada srv-0002?');
  });

  it('reports every error, imports nothing from a file with any error', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const bad = stringify([
      q('srv-0001'),
      q('srv-0002', { answer: 7 }),
      q('srv-0003', { category: 'culinaria' }),
      q('srv-0001'),
    ]);
    const id = await importCmd(t, bad);
    const text = reply(t, id)?.content ?? '';
    expect(text).toMatch(/O arquivo tem erros e nada mudou/);
    expect(text).toContain('item 2 (srv-0002) → answer');
    expect(text).toContain('item 3 (srv-0003) → category: "culinaria" não está em jarvis.trivia.categories');
    expect(text).toContain('item 4 (srv-0001) → id: "srv-0001" repetido');
    expect(reply(t, id)?.components ?? []).toEqual([]);
    expect(await s.repo.question('srv-0001')).toBeNull();

    const broken = await importCmd(t, '- id: [oops');
    expect(reply(t, broken)?.content).toMatch(/YAML inválido/);
    const many = await importCmd(
      t,
      stringify(Array.from({ length: TRIVIA_IMPORT_MAX + 1 }, (_, n) => q(`srv-${1000 + n}`))),
    );
    expect(reply(t, many)?.content).toMatch(/o máximo por arquivo é 50/);
  });

  it('refuses ids of questions from the content files', async () => {
    t = await setupJarvis();
    const id = await importCmd(t, stringify([q('quad-0001')]));
    expect(reply(t, id)?.content).toMatch(/quad-0001: id de uma pergunta dos arquivos de conteúdo/);
  });

  it('with review: second_staff, questions wait for another staff member', async () => {
    t = await setupJarvis({ jarvis: { trivia: { review: 'second_staff' } } });
    const s = servicesOf(t);
    const id = await importCmd(t, stringify([q('srv-0001')]));
    expect(reply(t, id)?.embeds?.[0]?.description).toMatch(/revisão ligada/);
    const before = t.gateway.messages.length;
    const done = await click(t, buttons(t, id)[0] ?? '');
    expect(reply(t, done)?.content).toMatch(/enviadas para revisão: 1 nova\(s\)/);
    expect(await s.repo.question('srv-0001')).toMatchObject({ active: 0, review: 'pending' });
    const posted = t.gateway.messages
      .slice(before)
      .find((m) => m.msg.embeds?.[0]?.title?.includes('srv-0001'));
    expect(posted).toBeTruthy();
  });

  it('is staff only', async () => {
    t = await setupJarvis();
    await addMember(t, '111');
    const id = await importCmd(t, stringify([q('srv-0001')]), '111');
    expect(reply(t, id)?.embeds ?? []).toEqual([]);
    expect(await servicesOf(t).repo.question('srv-0001')).toBeNull();
  });
});
