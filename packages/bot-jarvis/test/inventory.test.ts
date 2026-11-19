import { CerebroFlow, cerebro } from '@legion/bot-cerebro';
import type { ActionRow, OutgoingMessage, TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { inventoryIds } from '../src/index.js';
import { addMember, award, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const STAFF = { userId: '999', isGuildOwner: true };
const inventario = (tc: TestContext, userId = '111') =>
  tc.interact({ kind: 'command', userId, commandName: 'inventario' });
const give = (tc: TestContext, item: string, membro = '111', motivo?: string) =>
  tc.interact({
    kind: 'command',
    ...STAFF,
    commandName: 'jarvis',
    subcommand: 'item dar',
    options: { membro, item, ...(motivo ? { motivo } : {}) },
  });
const reply = (tc: TestContext, id: string) => tc.gateway.lastReply(id) as OutgoingMessage;
const selects = (m: OutgoingMessage) =>
  (m.components ?? [])
    .flat()
    .filter((c): c is Extract<ActionRow[number], { type: 'select' }> => c.type === 'select');
const buttons = (m: OutgoingMessage) => (m.components ?? []).flat().filter((c) => c.type === 'button');

async function setup(config: Record<string, unknown> = {}) {
  t = await setupJarvis(config);
  t.gateway.addMember({ userId: '999' });
  const m = await addMember(t, '111', 'xmen', 'Faísca');
  return { tc: t, m, s: servicesOf(t) };
}

describe('/jarvis item dar', () => {
  it('is staff only, gives once, refuses unknown items and members, records who gave it', async () => {
    const { tc, m, s } = await setup();
    const no = await tc.interact({
      kind: 'command',
      userId: '111',
      commandName: 'jarvis',
      subcommand: 'item dar',
      options: { membro: '111', item: 'traje-de-treino' },
    });
    expect(reply(tc, no).content).toBe('Apenas a staff pode usar este comando.');
    expect(reply(tc, await give(tc, 'traje-de-treino', '111', 'evento de sábado')).content).toBe(
      '🎁 **Traje de treino** entregue a <@111>.',
    );
    expect(reply(tc, await give(tc, 'traje-de-treino')).content).toBe('<@111> já tem **Traje de treino**.');
    expect(reply(tc, await give(tc, 'nada')).content).toBe('Não encontrei o item "nada".');
    expect(reply(tc, await give(tc, 'traje-de-treino', '555')).content).toBe(
      'Esse membro ainda não é um herói registrado.',
    );
    expect(await s.inventory.owned(m)).toMatchObject([
      { itemId: 'traje-de-treino', source: 'staff', grantedBy: '999', note: 'evento de sábado' },
    ]);
  });

  it('autocompletes items by name or id for staff', async () => {
    const { tc } = await setup();
    const id = await tc.interact({
      kind: 'autocomplete',
      ...STAFF,
      commandName: 'jarvis',
      subcommand: 'item dar',
      focused: { name: 'item', value: 'visor' },
    });
    expect(tc.gateway.callsOf('respondAutocomplete').at(-1)?.[1]).toEqual([
      { name: 'Visor de mira (visor-de-mira)', value: 'visor-de-mira' },
    ]);
    expect(id).toBeTruthy();
  });
});

describe('/inventario', () => {
  it('shows an empty inventory, needs registration', async () => {
    const { tc } = await setup();
    const empty = reply(tc, await inventario(tc));
    expect(empty.ephemeral).toBe(true);
    expect(empty.embeds?.[0]?.description).toBe(
      'Você ainda não tem itens. A staff pode entregar itens em eventos.',
    );
    expect(empty.components).toEqual([]);
    tc.gateway.addMember({ userId: '222' });
    expect(reply(tc, await inventario(tc, '222')).content).toMatch(/^Você ainda não é um herói registrado/);
  });

  it('equips by select, swaps, unequips by button; markers for level and disabled items', async () => {
    const { tc, m, s } = await setup();
    for (const it of [
      'traje-de-treino',
      'capa-de-gala',
      'traje-tatico',
      'luvas-de-impacto',
      'botas-de-salto',
    ])
      await give(tc, it);
    const first = reply(tc, await inventario(tc));
    // Level 1: traje-tatico (3), luvas (2) and botas (4) are listed but cannot be picked.
    expect(first.embeds?.[0]?.description).toContain('**Traje tático** (+8 VIDA, +1 DEF) · _nível 3_');
    expect(selects(first).map((x) => [x.customId, x.options.map((o) => o.value)])).toEqual([
      [inventoryIds.equip('traje', '111'), ['capa-de-gala', 'traje-de-treino']],
    ]);

    const eq = await tc.interact({
      kind: 'component',
      userId: '111',
      customId: inventoryIds.equip('traje', '111'),
      values: ['traje-de-treino'],
    });
    const after = reply(tc, eq);
    expect(after.content).toBe('✅ **Traje de treino** equipado. Vale a partir da próxima luta.');
    expect(after.embeds?.[0]?.fields?.[0]).toMatchObject({
      name: '🥋 Traje',
      value: '**Traje de treino**\n+8 VIDA',
    });
    expect(after.embeds?.[0]?.footer?.text).toBe('Bônus nas lutas: +8 VIDA');
    expect(buttons(after).map((b) => b.label)).toEqual(['Desequipar Traje']);

    await award(tc, m, 800, 'lvl'); // level 5
    for (const [slot, item] of [
      ['traje', 'traje-tatico'],
      ['acessorio', 'botas-de-salto'],
    ] as const)
      await tc.interact({
        kind: 'component',
        userId: '111',
        customId: inventoryIds.equip(slot, '111'),
        values: [item],
      });
    expect(await s.inventory.equipment(m)).toEqual(
      new Map([
        ['traje', 'traje-tatico'],
        ['acessorio', 'botas-de-salto'],
      ]),
    );

    await s.inventory.deactivate('botas-de-salto');
    const view = reply(tc, await inventario(tc));
    expect(view.embeds?.[0]?.description).toContain('**Botas de salto** (+2 VEL) · _desativado_');
    expect(view.embeds?.[0]?.fields?.[1]?.value).toBe('_vazio_');
    expect(
      selects(view)
        .find((x) => x.customId === inventoryIds.equip('acessorio', '111'))
        ?.options.map((o) => o.value),
    ).toEqual(['luvas-de-impacto']);

    const un = await tc.interact({
      kind: 'component',
      userId: '111',
      customId: inventoryIds.unequip('traje', '111'),
    });
    expect(reply(tc, un).content).toBe('Espaço Traje vazio.');
    expect(await s.inventory.equipment(m)).toEqual(new Map());
  });

  it("refuses another user's click and a stale menu", async () => {
    const { tc, m, s } = await setup();
    await addMember(tc, '222');
    await give(tc, 'traje-de-treino');
    const other = await tc.interact({
      kind: 'component',
      userId: '222',
      customId: inventoryIds.equip('traje', '111'),
      values: ['traje-de-treino'],
    });
    expect(reply(tc, other).content).toBe('Este menu não é seu. Use /inventario para o seu.');
    expect(await s.inventory.equipment(m)).toEqual(new Map());

    // The item was turned off after the menu was opened.
    await s.inventory.deactivate('traje-de-treino');
    const stale = await tc.interact({
      kind: 'component',
      userId: '111',
      customId: inventoryIds.equip('traje', '111'),
      values: ['traje-de-treino'],
    });
    expect(reply(tc, stale).content).toBe('**Traje de treino** está desativado e não pode ser equipado.');
    const notOwned = await tc.interact({
      kind: 'component',
      userId: '111',
      customId: inventoryIds.equip('traje', '111'),
      values: ['capa-de-gala'],
    });
    expect(reply(tc, notOwned).content).toBe('Você não tem **Capa de gala**.');
    const empty = await tc.interact({
      kind: 'component',
      userId: '111',
      customId: inventoryIds.unequip('traje', '111'),
    });
    expect(reply(tc, empty).content).toBe('Este menu está desatualizado. Veja o inventário de novo abaixo.');
  });

  it('shows "limite atingido" above the cap and "sem efeito" with statCap 0', async () => {
    const { tc, m } = await setup();
    await award(tc, m, 3200, 'lvl'); // level 9
    for (const it of ['traje-tatico', 'jaqueta-refletiva', 'gerador-de-escudo', 'luvas-de-impacto'])
      await give(tc, it);
    for (const [slot, item] of [
      ['traje', 'traje-tatico'],
      ['dispositivo', 'gerador-de-escudo'],
      ['acessorio', 'luvas-de-impacto'],
    ] as const)
      await tc.interact({
        kind: 'component',
        userId: '111',
        customId: inventoryIds.equip(slot, '111'),
        values: [item],
      });
    // def 1 + 1 = 2 (at the cap), hp 8 + 16 = 24 → 16.
    expect(reply(tc, await inventario(tc)).embeds?.[0]?.footer?.text).toBe(
      'Bônus nas lutas: +16 VIDA, +1 ATQ, +2 DEF · limite atingido (+2 por atributo, +16 de vida)',
    );
    await tc.close();
    const off = await setup({ jarvis: { economy: { gear: { statCap: 0 } } } });
    await give(off.tc, 'traje-de-treino');
    await off.tc.interact({
      kind: 'component',
      userId: '111',
      customId: inventoryIds.equip('traje', '111'),
      values: ['traje-de-treino'],
    });
    expect(reply(off.tc, await inventario(off.tc)).embeds?.[0]?.footer?.text).toBe(
      'Equipamento sem efeito neste servidor: é só visual.',
    );
  });

  it('speaks English', async () => {
    const { tc } = await setup({ locale: 'en' });
    await give(tc, 'traje-de-treino');
    const eq = await tc.interact({
      kind: 'component',
      userId: '111',
      customId: inventoryIds.equip('traje', '111'),
      values: ['traje-de-treino'],
    });
    const m = reply(tc, eq);
    expect(m.content).toBe('✅ **Training suit** equipped. It applies from your next fight.');
    expect(m.embeds?.[0]?.title).toBe('🎒 Inventory');
    expect(m.embeds?.[0]?.fields?.[0]).toMatchObject({ name: '🥋 Suit', value: '**Training suit**\n+8 HP' });
    expect(buttons(m).map((b) => b.label)).toEqual(['Unequip Suit']);
  });
});

describe('/perfil card with gear', () => {
  async function card(tc: TestContext, locale?: 'en') {
    const flow = new CerebroFlow(tc.ctxOf(cerebro));
    const member = await flow.repo.memberByDiscordId('111');
    const mutant = member && (await flow.repo.mutantByMemberId(member.id));
    if (!member || !mutant) throw new Error('not registered');
    return flow.sheet.data(member, mutant, locale);
  }

  it('lists equipped items; without items the card is unchanged', async () => {
    const { tc } = await setup();
    const before = await card(tc);
    expect(before.gear).toEqual([]);
    await give(tc, 'traje-de-treino');
    await give(tc, 'comunicador-de-pulso');
    for (const [slot, item] of [
      ['traje', 'traje-de-treino'],
      ['dispositivo', 'comunicador-de-pulso'],
    ] as const)
      await tc.interact({
        kind: 'component',
        userId: '111',
        customId: inventoryIds.equip(slot, '111'),
        values: [item],
      });
    const after = await card(tc);
    expect(after.gear?.sort()).toEqual(['Comunicador de pulso', 'Traje de treino']);
    expect(after.stats.hp).toBe(before.stats.hp + 8);
    expect(after.stats.spd).toBe(before.stats.spd + 1);
    expect((await card(tc, 'en')).gear?.sort()).toEqual(['Training suit', 'Wrist communicator']);
  });
});
