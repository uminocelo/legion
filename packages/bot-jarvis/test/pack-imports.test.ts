import type { OutgoingMessage, TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { PACK_ORIGIN, packImportIds } from '../src/index.js';
import { addMember, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const STAFF = '999';
const CDN = 'https://cdn.discordapp.com/attachments/1/2/';

const trivia = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  category: 'geral',
  difficulty: 'facil',
  question: `Pergunta ${id}?`,
  choices: ['a', 'b'],
  answer: 0,
  explanation: 'porque sim',
  source: `https://example.com/${id}`,
  ...over,
});

const mission = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'daily',
  title: { 'pt-BR': `Missão ${id}` },
  summary: { 'pt-BR': `Resumo da missão ${id}.` },
  start: 'a',
  scenes: {
    a: {
      text: { 'pt-BR': 'Início.' },
      choices: [
        { label: { 'pt-BR': 'Sim' }, next: 'b' },
        { label: { 'pt-BR': 'Não' }, next: 'c' },
      ],
    },
    b: { text: { 'pt-BR': 'Fim bom.' }, end: 'success' },
    c: { text: { 'pt-BR': 'Fim ruim.' }, end: 'failure' },
  },
  ...over,
});

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slot: 'acessorio',
  name: { 'pt-BR': `Peça ${id}` },
  bonus: { atk: 1 },
  ...over,
});

const packDoc = (over: Record<string, unknown> = {}) => ({
  id: 'meu-pack',
  name: { 'pt-BR': 'Meu pacote', en: 'My pack' },
  version: '1.0.0',
  author: 'Staff',
  trivia: [trivia('pack-q1')],
  missions: [mission('pack-m1')],
  items: [item('pack-item-1')],
  ...over,
});

function upload(tc: TestContext, text: string, name = 'pack.yaml') {
  const url = `${CDN}${name}`;
  tc.gateway.cdn.set(url, text);
  return { url, name, size: Buffer.byteLength(text), contentType: 'text/yaml' };
}
const staff = (tc: TestContext, subcommand: string, extra: Record<string, unknown> = {}, userId = STAFF) =>
  tc.interact({
    kind: 'command',
    userId,
    isGuildOwner: userId === STAFF,
    commandName: 'jarvis',
    subcommand,
    ...extra,
  });
const importCmd = (tc: TestContext, text: string, userId = STAFF) =>
  staff(tc, 'pack importar', { attachments: { arquivo: upload(tc, text) } }, userId);
const reply = (tc: TestContext, id: string) => tc.gateway.lastReply(id) as OutgoingMessage;
const buttons = (m: OutgoingMessage) =>
  (m.components ?? []).flat().map((b) => ('customId' in b ? (b.customId ?? '') : ''));
const click = (tc: TestContext, customId: string, userId = STAFF) =>
  tc.interact({ kind: 'component', userId, isGuildOwner: userId === STAFF, customId });

async function setup(config: Record<string, unknown> = {}) {
  t = await setupJarvis(config);
  t.gateway.addMember({ userId: STAFF });
  await addMember(t, '111', 'xmen', 'Faísca');
  return { tc: t, s: servicesOf(t) };
}

describe('/jarvis pack importar', () => {
  it('previews then publishes a pack; Cancelar and a used stage change nothing', async () => {
    const { tc, s } = await setup();
    const text = stringify(packDoc());
    const pre = reply(tc, await importCmd(tc, text));
    expect(pre.embeds?.[0]?.title).toBe('Prévia: pack.yaml');
    expect(pre.embeds?.[0]?.description).toContain('`meu-pack` · **Meu pacote** · v1.0.0 · Staff');
    expect(pre.embeds?.[0]?.description).toContain('Trivia: 🆕 1 · ✏️ 0 · ＝ 0');
    expect(pre.embeds?.[0]?.description).toContain('Missões: 🆕 1 · ✏️ 0 · ＝ 0');
    expect(pre.embeds?.[0]?.description).toContain('Itens: 🆕 1 · ✏️ 0 · ＝ 0');
    expect(await s.repo.question('pack-q1')).toBeNull();

    const [publish, cancel] = buttons(pre);
    expect(reply(tc, await click(tc, cancel ?? '')).content).toBe('Importação cancelada. Nada mudou.');
    expect(reply(tc, await click(tc, publish ?? '')).content).toBe(
      'Esta prévia expirou ou já foi usada. Importe de novo.',
    );
    expect(await s.repo.question('pack-q1')).toBeNull();

    const again = reply(tc, await importCmd(tc, text));
    const pub = reply(tc, await click(tc, buttons(again)[0] ?? ''));
    expect(pub.content).toBe(
      '✅ Pacote `meu-pack` v1.0.0 instalado: 3 novo(s), 0 alterado(s), 0 igual(is). Desativados: 0. Desequipados: 0.',
    );
    expect(await s.repo.question('pack-q1')).toMatchObject({ origin: PACK_ORIGIN, active: 1 });
    expect(await s.repo.mission('pack-m1')).toMatchObject({ origin: PACK_ORIGIN, active: 1 });
    expect(await s.items.row('pack-item-1')).toMatchObject({ origin: PACK_ORIGIN, active: 1 });
  });

  it('lists every error and changes nothing', async () => {
    const { tc, s } = await setup();
    const msg = async (text: string) => reply(tc, await importCmd(tc, text)).content ?? '';
    expect(await msg('- id: [quebrado')).toMatch(
      /^O arquivo tem erros e nada mudou:\n• pack\.yaml \(linha \d+\): YAML inválido/,
    );
    expect(await msg(stringify(packDoc({ version: 'nope' })))).toContain('version');
    expect(await msg(stringify(packDoc({ trivia: [], missions: [], items: [] })))).toContain('pacote vazio');
    expect(await s.repo.question('pack-q1')).toBeNull();
    expect(await s.packs.list()).toEqual([]);
  });

  it('is staff only, including the Publicar button', async () => {
    const { tc, s } = await setup();
    expect(reply(tc, await importCmd(tc, stringify(packDoc()), '111')).content).toBe(
      'Apenas a staff pode usar este comando.',
    );
    const pre = reply(tc, await importCmd(tc, stringify(packDoc())));
    const other = await click(tc, buttons(pre)[0] ?? '', '111');
    expect(reply(tc, other).content).toBe('Apenas a staff pode usar este comando.');
    expect(await s.repo.question('pack-q1')).toBeNull();
    expect(packImportIds.decide('a', 'publish')).toMatch(/pack-import/);
  });

  it('refuses an already-installed same version and English strings', async () => {
    const { tc, s } = await setup({ locale: 'en' });
    await click(tc, buttons(reply(tc, await importCmd(tc, stringify(packDoc()))))[0] ?? '');
    const same = reply(tc, await importCmd(tc, stringify(packDoc())));
    expect(same.content).toMatch(/já está instalada|already installed/i);
    expect(same.content).toContain('1.0.0');
    expect(await s.packs.list()).toHaveLength(1);

    const pre = reply(tc, await importCmd(tc, stringify(packDoc({ version: '1.1.0', trivia: [trivia('pack-q2')] }))));
    expect(pre.embeds?.[0]?.title).toBe('Preview: pack.yaml');
    expect(pre.embeds?.[0]?.description).toMatch(/Upgrades installed version 1\.0\.0/);
    expect(pre.embeds?.[0]?.description).toContain('Trivia: 🆕 1 · ✏️ 0 · ＝ 0');
  });
});

describe('/jarvis pack lista and remover', () => {
  it('lists installed packs and removes by id', async () => {
    const { tc, s } = await setup();
    expect(reply(tc, await staff(tc, 'pack lista')).content).toBe('Nenhum pacote instalado.');
    await click(tc, buttons(reply(tc, await importCmd(tc, stringify(packDoc()))))[0] ?? '');

    const list = reply(tc, await staff(tc, 'pack lista'));
    expect(list.content).toContain('Pacotes instalados (1):');
    expect(list.content).toContain('• `meu-pack` · Meu pacote · v1.0.0 · Staff');

    expect(reply(tc, await staff(tc, 'pack remover', { options: { id: 'nao-existe' } })).content).toContain(
      'pacote desconhecido',
    );
    expect(reply(tc, await staff(tc, 'pack remover', { options: { id: 'meu-pack' } })).content).toBe(
      '🗑️ Pacote `meu-pack` removido. O conteúdo dele foi desativado.',
    );
    expect(await s.packs.list()).toEqual([]);
    expect(await s.repo.question('pack-q1')).toMatchObject({ active: 0 });
    expect(await s.items.row('pack-item-1')).toMatchObject({ active: 0 });
    expect(reply(tc, await staff(tc, 'pack lista')).content).toBe('Nenhum pacote instalado.');
  });
});
