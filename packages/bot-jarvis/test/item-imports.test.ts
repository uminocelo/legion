import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OutgoingMessage, TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { inventoryIds, itemDirs, itemImportIds } from '../src/index.js';
import { addMember, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
const tmp: string[] = [];
afterEach(async () => {
  await t?.close();
  t = undefined;
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

const STAFF = '999';
const CDN = 'https://cdn.discordapp.com/attachments/1/2/';
const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slot: 'acessorio',
  minLevel: 1,
  name: { 'pt-BR': `Peça ${id}`, en: `Piece ${id}` },
  bonus: { atk: 1 },
  ...over,
});

function upload(tc: TestContext, text: string, name = 'itens.yaml') {
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
  staff(tc, 'item importar', { attachments: { arquivo: upload(tc, text) } }, userId);
const reply = (tc: TestContext, id: string) => tc.gateway.lastReply(id) as OutgoingMessage;
const buttons = (m: OutgoingMessage) =>
  (m.components ?? []).flat().map((b) => ('customId' in b ? (b.customId ?? '') : ''));
const click = (tc: TestContext, customId: string, userId = STAFF) =>
  tc.interact({ kind: 'component', userId, isGuildOwner: userId === STAFF, customId });

async function setup(config: Record<string, unknown> = {}) {
  t = await setupJarvis(config);
  t.gateway.addMember({ userId: STAFF });
  const m = await addMember(t, '111', 'xmen', 'Faísca');
  return { tc: t, m, s: servicesOf(t) };
}

describe('/jarvis item importar', () => {
  it('previews new items, publishes them as staff items, and they work in the shop and inventory', async () => {
    const { tc, m, s } = await setup();
    const text = stringify([
      item('luva-de-faisca', { shop: { price: 30 } }),
      item('anel-do-cais', { slot: 'dispositivo' }),
    ]);
    const pre = reply(tc, await importCmd(tc, text));
    expect(pre.embeds?.[0]?.title).toBe('Prévia: itens.yaml');
    expect(pre.embeds?.[0]?.description).toMatch(/^🆕 2 novo\(s\) · ✏️ 0 alterado\(s\) · ＝ 0 igual\(is\)/);
    expect(pre.embeds?.[0]?.description).toContain(
      '🆕 `luva-de-faisca` · Peça luva-de-faisca · +1 ATQ · 30 créditos',
    );
    expect(await s.items.row('luva-de-faisca')).toBeNull();

    const pub = await click(tc, buttons(pre)[0] ?? '');
    expect(reply(tc, pub).content).toBe(
      '✅ Itens publicados: 2 novo(s), 0 alterado(s), 0 igual(is). Desequipados: 0.',
    );
    expect(await s.items.row('luva-de-faisca')).toMatchObject({
      origin: 'staff',
      importedBy: STAFF,
      active: 1,
      price: 30,
    });
    // The shop sells it and the inventory equips it.
    await tc.db.transaction((tx) =>
      s.wallet.credit(tx, { memberId: m, amount: 30, reason: 'staff', sourceKey: 'staff:seed' }),
    );
    expect(await s.inventory.buy(m, 'luva-de-faisca', 30)).toMatchObject({ ok: true });
    expect(await s.inventory.equip(m, 'luva-de-faisca', 'acessorio')).toEqual({ ok: true, replaced: null });
    // A file reload never touches staff items.
    await s.items.reload();
    expect(await s.items.row('luva-de-faisca')).toMatchObject({ origin: 'staff', active: 1 });
  });

  it('a changed item shows how many own it; active: false unequips; Cancelar and a used stage change nothing', async () => {
    const { tc, m, s } = await setup();
    await click(tc, buttons(reply(tc, await importCmd(tc, stringify([item('luva-de-faisca')]))))[0] ?? '');
    await s.inventory.grant({ memberId: m, itemId: 'luva-de-faisca', source: 'staff' });
    await s.inventory.equip(m, 'luva-de-faisca', 'acessorio');

    const changed = stringify([
      item('luva-de-faisca', { bonus: { atk: 2 } }),
      item('novo-anel', { slot: 'dispositivo' }),
    ]);
    const pre = reply(tc, await importCmd(tc, changed));
    expect(pre.embeds?.[0]?.description).toMatch(/^🆕 1 novo\(s\) · ✏️ 1 alterado\(s\) · ＝ 0/);
    expect(pre.embeds?.[0]?.description).toContain(
      '✏️ `luva-de-faisca` · Peça luva-de-faisca · +2 ATQ · 1 jogador(es) têm',
    );
    const [publish, cancel] = buttons(pre);
    expect(reply(tc, await click(tc, cancel ?? '')).content).toBe('Importação cancelada. Nada mudou.');
    expect(reply(tc, await click(tc, publish ?? '')).content).toBe(
      'Esta prévia expirou ou já foi usada. Importe de novo.',
    );
    expect(await s.items.row('novo-anel')).toBeNull();

    const off = stringify([item('luva-de-faisca', { active: false })]);
    const res = await click(tc, buttons(reply(tc, await importCmd(tc, off)))[0] ?? '');
    expect(reply(tc, res).content).toBe(
      '✅ Itens publicados: 0 novo(s), 1 alterado(s), 0 igual(is). Desequipados: 1.',
    );
    expect(await s.inventory.equipment(m)).toEqual(new Map());
    expect(await s.inventory.owned(m)).toHaveLength(1);
  });

  it('lists every error and changes nothing', async () => {
    const { tc, s } = await setup();
    const msg = async (text: string) => reply(tc, await importCmd(tc, text)).content ?? '';
    expect(await msg('- id: [quebrado')).toMatch(
      /^O arquivo tem erros e nada mudou:\n• itens\.yaml \(linha \d+\): YAML inválido/,
    );
    expect(await msg(stringify(Array.from({ length: 51 }, (_, n) => item(`item-${n}`))))).toContain(
      'itens.yaml: itens demais (máximo 50 por arquivo)',
    );
    const many = await msg(
      stringify([
        item('dupla'),
        item('dupla'),
        item('traje-de-treino'),
        item('homem-aranha', { name: { 'pt-BR': 'Teia do Homem-Aranha' } }),
        item('enfeite', { cosmetic: true }),
      ]),
    );
    expect(many).toContain('• itens.yaml → item 2 (dupla) → id: "dupla" repetido no mesmo arquivo');
    expect(many).toContain('• itens.yaml → traje-de-treino: id de um item dos arquivos');
    expect(many).toMatch(/• itens\.yaml → item 4 \(homem-aranha\) → name\.pt-BR: .*/);
    expect(many).toContain('• itens.yaml → item 5 (enfeite) → bonus: item cosmético não tem bônus');
    expect(await msg('')).toContain('itens.yaml: nenhum item no arquivo');
    expect((await s.items.all()).filter((r) => r.origin === 'staff')).toEqual([]);
  });

  it('is staff only, including the Publicar button', async () => {
    const { tc, s } = await setup();
    expect(reply(tc, await importCmd(tc, stringify([item('x-item')]), '111')).content).toBe(
      'Apenas a staff pode usar este comando.',
    );
    const pre = reply(tc, await importCmd(tc, stringify([item('x-item')])));
    const other = await click(tc, buttons(pre)[0] ?? '', '111');
    expect(reply(tc, other).content).toBe('Apenas a staff pode usar este comando.');
    expect(await s.items.row('x-item')).toBeNull();
    expect(itemImportIds.decide('a', 'publish')).toMatch(/item-import/);
  });
});

describe('/jarvis item exportar, desativar, ativar', () => {
  it('export then import changes nothing', async () => {
    const { tc } = await setup();
    const none = reply(tc, await staff(tc, 'item exportar'));
    expect(none.content).toBe('0 item(ns) da staff.');
    expect(none.files).toBeUndefined();
    const text = stringify([
      item('luva-de-faisca', { shop: { price: 30, order: 2 }, description: { 'pt-BR': 'Faísca no punho.' } }),
      item('capa-cinza', { slot: 'traje', cosmetic: true, bonus: {} }),
    ]);
    await click(tc, buttons(reply(tc, await importCmd(tc, text)))[0] ?? '');
    const exp = reply(tc, await staff(tc, 'item exportar'));
    expect(exp.content).toBe('2 item(ns) da staff.');
    expect(exp.files?.[0]?.name).toBe('itens-staff.yaml');
    const again = reply(tc, await importCmd(tc, String(exp.files?.[0]?.content)));
    expect(again.embeds?.[0]?.description).toMatch(/^🆕 0 novo\(s\) · ✏️ 0 alterado\(s\) · ＝ 2 igual\(is\)/);
  });

  it('desativar unequips owners and keeps ownership, survives reloads and re-import; ativar brings it back', async () => {
    const { tc, m, s } = await setup();
    const m2 = await addMember(tc, '222');
    for (const id of [m, m2]) {
      await s.inventory.grant({ memberId: id, itemId: 'traje-de-treino', source: 'staff' });
      await s.inventory.equip(id, 'traje-de-treino', 'traje');
    }
    const off = reply(tc, await staff(tc, 'item desativar', { options: { item: 'traje-de-treino' } }));
    expect(off.content).toBe(
      '⛔ **Traje de treino** desativado. 2 jogador(es) tiveram o item desequipado e continuam com ele no inventário.',
    );
    expect(await s.inventory.owned(m)).toHaveLength(1);
    expect(await s.inventory.equipment(m)).toEqual(new Map());
    expect(
      reply(tc, await staff(tc, 'item desativar', { options: { item: 'traje-de-treino' } })).content,
    ).toBe('**Traje de treino** já está desativado.');
    await s.items.reload();
    expect(await s.items.row('traje-de-treino')).toMatchObject({ active: 0, disabledBy: STAFF });

    const on = reply(tc, await staff(tc, 'item ativar', { options: { item: 'traje-de-treino' } }));
    expect(on.content).toBe('✅ **Traje de treino** ativado de novo. Quem tem precisa equipar outra vez.');
    expect(await s.items.row('traje-de-treino')).toMatchObject({ active: 1, disabledBy: null });
    expect(await s.inventory.equipment(m)).toEqual(new Map());
    expect(reply(tc, await staff(tc, 'item ativar', { options: { item: 'traje-de-treino' } })).content).toBe(
      '**Traje de treino** já está ativo.',
    );
    expect(reply(tc, await staff(tc, 'item ativar', { options: { item: 'nada' } })).content).toBe(
      'Não encontrei o item "nada".',
    );

    // A disabled staff item stays disabled when its file is imported again.
    await click(tc, buttons(reply(tc, await importCmd(tc, stringify([item('luva-de-faisca')]))))[0] ?? '');
    await staff(tc, 'item desativar', { options: { item: 'luva-de-faisca' } });
    await click(
      tc,
      buttons(
        reply(tc, await importCmd(tc, stringify([item('luva-de-faisca', { bonus: { atk: 2 } })]))),
      )[0] ?? '',
    );
    expect(await s.items.row('luva-de-faisca')).toMatchObject({ active: 0, disabledBy: STAFF });
    // The inventory menu does not let anyone equip it.
    await s.inventory.grant({ memberId: m, itemId: 'luva-de-faisca', source: 'staff' });
    const eq = await tc.interact({
      kind: 'component',
      userId: '111',
      customId: inventoryIds.equip('acessorio', '111'),
      values: ['luva-de-faisca'],
    });
    expect(reply(tc, eq).content).toMatch(/desativado/);
  });

  it('a file item with active: false cannot be enabled from Discord; English', async () => {
    const root = mkdtempSync(join(tmpdir(), 'items-'));
    tmp.push(root);
    const dir = join(root, 'items');
    mkdirSync(dir);
    writeFileSync(join(dir, 'srv.yaml'), stringify([item('peca-guardada', { active: false })]));
    const { tc, s } = await setup({ locale: 'en' });
    await s.items.reload([itemDirs('/none')[0] as string, dir]);
    expect(reply(tc, await staff(tc, 'item ativar', { options: { item: 'peca-guardada' } })).content).toBe(
      '**Piece peca-guardada** has `active: false` in its file. Change the file to enable it.',
    );
    const pre = reply(tc, await importCmd(tc, stringify([item('outra-peca')])));
    expect(pre.embeds?.[0]?.title).toBe('Preview: itens.yaml');
    expect(pre.embeds?.[0]?.description).toMatch(/^🆕 1 new · ✏️ 0 changed · ＝ 0 unchanged/);
  });
});
