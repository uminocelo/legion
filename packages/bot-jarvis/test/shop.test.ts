import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OutgoingMessage, TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { itemDirs, jarvis, jarvisDoctorChecks, shopIds } from '../src/index.js';
import { addMember, award, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
const tmp: string[] = [];
afterEach(async () => {
  await t?.close();
  t = undefined;
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup(config: Record<string, unknown> = {}) {
  t = await setupJarvis(config);
  const m = await addMember(t, '111', 'xmen', 'Faísca');
  return { tc: t, m, s: servicesOf(t) };
}
async function fund(tc: TestContext, memberId: string, amount: number, key = 'seed') {
  await tc.db.transaction((tx) =>
    servicesOf(tc).wallet.credit(tx, {
      memberId,
      amount,
      reason: 'staff',
      sourceKey: `staff:${key}:${memberId}`,
    }),
  );
}
/** Balance equals the ledger sum for every wallet. */
async function consistent(tc: TestContext) {
  const s = servicesOf(tc);
  for (const w of await tc.db.orm.select().from(s.repo.t.jarvisWallets)) {
    const sum = (await s.wallet.history(w.memberId, 1000)).reduce((a, e) => a + e.amount, 0);
    expect(w.balance).toBe(sum);
    expect(w.balance).toBeGreaterThanOrEqual(0);
  }
}
const loja = (tc: TestContext, pagina?: number, userId = '111') =>
  tc.interact({ kind: 'command', userId, commandName: 'loja', ...(pagina ? { options: { pagina } } : {}) });
const reply = (tc: TestContext, id: string) => tc.gateway.lastReply(id) as OutgoingMessage;
const buttons = (m: OutgoingMessage) => (m.components ?? []).flat().filter((c) => c.type === 'button');

describe('InventoryService.buy', () => {
  it('debits and grants in one transaction; each refusal writes nothing', async () => {
    const { tc, m, s } = await setup();
    expect(await s.inventory.buy(m, 'traje-de-treino', 60)).toEqual({
      ok: false,
      reason: 'insufficient',
      price: 60,
      balance: 0,
    });
    await fund(tc, m, 100);
    expect(await s.inventory.buy(m, 'traje-de-treino', 50)).toEqual({
      ok: false,
      reason: 'price_changed',
      price: 60,
    });
    expect(await s.inventory.buy(m, 'broche-de-recruta', 0)).toEqual({ ok: false, reason: 'not_for_sale' });
    expect(await s.inventory.buy(m, 'nada', 10)).toEqual({ ok: false, reason: 'not_for_sale' });
    expect(await s.inventory.buy(m, 'traje-tatico', 140)).toEqual({
      ok: false,
      reason: 'level_too_low',
      minLevel: 3,
    });
    expect(await s.wallet.balanceOf(m)).toBe(100);
    expect(await s.inventory.owned(m)).toEqual([]);

    expect(await s.inventory.buy(m, 'traje-de-treino', 60)).toEqual({ ok: true, price: 60, balance: 40 });
    expect(await s.inventory.owned(m)).toMatchObject([{ itemId: 'traje-de-treino', source: 'purchase' }]);
    expect(await s.wallet.history(m, 1)).toMatchObject([
      { amount: -60, reason: 'purchase', note: 'traje-de-treino', sourceKey: `buy:${m}:traje-de-treino` },
    ]);
    expect(await s.inventory.buy(m, 'traje-de-treino', 60)).toEqual({ ok: false, reason: 'owned' });
    // Disabled items leave the shop.
    await s.inventory.deactivate('comunicador-de-pulso');
    expect(await s.inventory.buy(m, 'comunicador-de-pulso', 60)).toEqual({
      ok: false,
      reason: 'not_for_sale',
    });
    expect(await s.wallet.balanceOf(m)).toBe(40);
    await consistent(tc);
  });

  it('an item a member already got from staff is not sold again', async () => {
    const { tc, m, s } = await setup();
    await fund(tc, m, 100);
    await s.inventory.grant({ memberId: m, itemId: 'comunicador-de-pulso', source: 'staff' });
    expect(await s.inventory.buy(m, 'comunicador-de-pulso', 60)).toEqual({ ok: false, reason: 'owned' });
    expect(await s.wallet.balanceOf(m)).toBe(100);
  });

  it('two clicks at once on the same item: charged once, one copy', async () => {
    const { tc, m, s } = await setup();
    await fund(tc, m, 500);
    const res = await Promise.all([
      s.inventory.buy(m, 'traje-de-treino', 60),
      s.inventory.buy(m, 'traje-de-treino', 60),
      s.inventory.buy(m, 'traje-de-treino', 60),
    ]);
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    expect(res.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.reason))).toEqual(['owned', 'owned']);
    expect(await s.wallet.balanceOf(m)).toBe(440);
    expect(await s.inventory.owned(m)).toHaveLength(1);
    await consistent(tc);
  });

  it('two items at once with credits for only one: one purchase, one refusal', async () => {
    const { tc, m, s } = await setup();
    await fund(tc, m, 100);
    const res = await Promise.all([
      s.inventory.buy(m, 'traje-de-treino', 60),
      s.inventory.buy(m, 'comunicador-de-pulso', 60),
    ]);
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    expect(res.find((r) => !r.ok)).toMatchObject({
      ok: false,
      reason: 'insufficient',
      price: 60,
      balance: 40,
    });
    expect(await s.wallet.balanceOf(m)).toBe(40);
    expect(await s.inventory.owned(m)).toHaveLength(1);
    await consistent(tc);
  });
});

describe('/loja', () => {
  it('lists the stock with price, slot, level, bonus and flags, and the balance; needs registration', async () => {
    const { tc, m, s } = await setup();
    await fund(tc, m, 70);
    await s.inventory.grant({ memberId: m, itemId: 'comunicador-de-pulso', source: 'staff' });
    const msg = reply(tc, await loja(tc));
    expect(msg.ephemeral).toBe(true);
    const lines = msg.embeds?.[0]?.description?.split('\n') ?? [];
    expect(lines).toHaveLength(11);
    expect(lines).toContain(
      '**Comunicador de pulso** · 60 créditos · dispositivo · nível 1 · +1 VEL · _você já tem_',
    );
    expect(lines).toContain('**Capa de gala** · 150 créditos · traje · nível 1 · visual · _visual_');
    expect(lines).toContain(
      '**Drone mascote** · 360 créditos · dispositivo · nível 8 · +1 VEL, +1 FOCO · _precisa do nível 8_',
    );
    expect(msg.embeds?.[0]?.footer?.text).toBe('Seu saldo: 70 créditos');
    expect(buttons(msg)).toEqual([]);
    tc.gateway.addMember({ userId: '222' });
    expect(reply(tc, await loja(tc, undefined, '222')).content).toMatch(
      /^Você ainda não é um herói registrado/,
    );
  });

  it('pick → Comprar buys, then Comprar again refuses; another user cannot click', async () => {
    const { tc, m, s } = await setup();
    await fund(tc, m, 100);
    await loja(tc);
    const pick = await tc.interact({
      kind: 'component',
      userId: '111',
      customId: shopIds.pick(1, '111'),
      values: ['traje-de-treino'],
    });
    const picked = reply(tc, pick);
    expect(buttons(picked)).toMatchObject([
      {
        label: 'Comprar Traje de treino (60)',
        customId: shopIds.buy('traje-de-treino', 60, '111'),
        disabled: false,
      },
    ]);
    tc.gateway.addMember({ userId: '222' });
    const other = await tc.interact({
      kind: 'component',
      userId: '222',
      customId: shopIds.buy('traje-de-treino', 60, '111'),
    });
    expect(reply(tc, other).content).toBe('Este menu não é seu. Use /loja para o seu.');
    expect(await s.wallet.balanceOf(m)).toBe(100);

    const buy = await tc.interact({
      kind: 'component',
      userId: '111',
      customId: shopIds.buy('traje-de-treino', 60, '111'),
    });
    const done = reply(tc, buy);
    expect(done.content).toBe(
      '✅ Você comprou **Traje de treino** por 60 créditos. Saldo: 40. Equipe com /inventario.',
    );
    expect(done.embeds?.[0]?.footer?.text).toBe('Seu saldo: 40 créditos');
    // An old Comprar button (stale menu): refused, nothing charged.
    const again = await tc.interact({
      kind: 'component',
      userId: '111',
      customId: shopIds.buy('traje-de-treino', 60, '111'),
    });
    expect(reply(tc, again).content).toBe('Você já tem **Traje de treino**.');
    expect(await s.wallet.balanceOf(m)).toBe(40);
  });

  it('says why a purchase failed: credits, level, price changed, not for sale', async () => {
    const { tc, m, s } = await setup();
    const click = async (item: string, price: number) =>
      reply(
        tc,
        await tc.interact({ kind: 'component', userId: '111', customId: shopIds.buy(item, price, '111') }),
      ).content;
    expect(await click('capa-de-gala', 150)).toBe(
      'Créditos insuficientes: **Capa de gala** custa 150 e você tem 0.',
    );
    await fund(tc, m, 1000);
    expect(await click('drone-mascote', 360)).toBe('**Drone mascote** precisa do nível 8.');
    expect(await click('capa-de-gala', 120)).toBe(
      'O preço de **Capa de gala** mudou para 150 créditos. Nada foi cobrado: confira e clique em Comprar de novo.',
    );
    await s.inventory.deactivate('capa-de-gala');
    expect(await click('capa-de-gala', 150)).toBe('Este item não está mais à venda.');
    expect(await s.wallet.balanceOf(m)).toBe(1000);
    await award(tc, m, 3200, 'lvl'); // level 9
    expect(await click('drone-mascote', 360)).toMatch(/^✅ Você comprou \*\*Drone mascote\*\*/);
  });

  it('pages of 25 with ◀ ▶ and /loja pagina', async () => {
    const root = mkdtempSync(join(tmpdir(), 'shop-'));
    tmp.push(root);
    const dir = join(root, 'items');
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'muitos.yaml'),
      Array.from(
        { length: 30 },
        (_, i) =>
          `- { id: extra-${String(i).padStart(2, '0')}, slot: traje, name: { pt-BR: Extra ${i} }, bonus: { hp: 1 }, shop: { price: 5, order: ${i} } }\n`,
      ).join(''),
    );
    const { tc, s } = await setup();
    await s.items.reload([itemDirs('/none')[0] as string, dir]);
    const first = reply(tc, await loja(tc));
    expect(first.embeds?.[0]?.description?.split('\n')).toHaveLength(25);
    expect(first.embeds?.[0]?.description?.split('\n')[0]).toMatch(/^\*\*Extra 0\*\*/);
    expect(first.embeds?.[0]?.footer?.text).toBe('Seu saldo: 0 créditos · página 1 de 2');
    expect(buttons(first).map((b) => [b.label, b.disabled])).toEqual([
      ['◀', true],
      ['▶', false],
    ]);
    const next = reply(
      tc,
      await tc.interact({ kind: 'component', userId: '111', customId: shopIds.page(2, '111') }),
    );
    expect(next.embeds?.[0]?.description?.split('\n')).toHaveLength(16);
    expect(reply(tc, await loja(tc, 9)).embeds?.[0]?.footer?.text).toBe(
      'Seu saldo: 0 créditos · página 2 de 2',
    );
  });

  it('is closed when the economy is off, and speaks English', async () => {
    const off = await setup({ jarvis: { economy: { enabled: false } } });
    expect(reply(off.tc, await loja(off.tc)).content).toBe('A loja está fechada neste servidor.');
    await off.tc.close();
    const en = await setup({ locale: 'en' });
    await fund(en.tc, en.m, 10);
    const view = reply(en.tc, await loja(en.tc));
    expect(view.embeds?.[0]?.title).toBe('🛒 Shop');
    expect(view.embeds?.[0]?.description?.split('\n')).toContain(
      '**Training suit** · 60 credits · suit · level 1 · +8 HP',
    );
    const buy = await en.tc.interact({
      kind: 'component',
      userId: '111',
      customId: shopIds.buy('traje-de-treino', 60, '111'),
    });
    expect(reply(en.tc, buy).content).toBe('Not enough credits: **Training suit** costs 60 and you have 10.');
  });
});

describe('doctor: shop', () => {
  const shopCheck = (tc: TestContext) =>
    jarvisDoctorChecks(tc.ctxOf(jarvis)).find((c) => c.id === 'jarvis.items');

  it('ok with the shipped stock; warns when the economy is on and nothing is for sale; quiet when off', async () => {
    const { tc, s } = await setup();
    expect(await shopCheck(tc)?.run()).toMatchObject({
      status: 'ok',
      message: '12 item(ns) nos arquivos; 11 à venda',
    });
    for (const r of await s.items.all()) if (r.price !== null) await s.inventory.deactivate(r.id, '999');
    expect(await shopCheck(tc)?.run()).toMatchObject({ status: 'warn' });
    await tc.close();
    const off = await setup({ jarvis: { economy: { enabled: false } } });
    for (const r of await off.s.items.all())
      if (r.price !== null) await off.s.inventory.deactivate(r.id, '999');
    expect(await shopCheck(off.tc)?.run()).toMatchObject({ status: 'ok' });
  });
});
