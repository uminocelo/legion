import type { ActionInput, OutgoingMessage, TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { addMember, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const STAFF = '999';
const actor = { discordUserId: STAFF, name: 'Staff' };
const run = (tc: TestContext, id: string, input: ActionInput) => {
  const a = tc.runtime.dashboard.getAction('jarvis', id);
  if (!a) throw new Error(`no action ${id}`);
  return a.run(input, actor);
};
const slash = async (tc: TestContext, subcommand: string, options: Record<string, unknown>) =>
  tc.gateway.lastReply(
    await tc.interact({
      kind: 'command',
      userId: STAFF,
      isGuildOwner: true,
      commandName: 'jarvis',
      subcommand,
      options,
    }),
  )?.content;

describe('J.A.R.V.I.S. dashboard actions', () => {
  it('give and remove credits match /jarvis creditos dar, refusals included', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const a = await addMember(t, '111', 'xmen', 'Tempestade');
    await addMember(t, '222', 'xmen', 'Ciclope');

    const viaAction = await run(t, 'credits-give', { member: '111', amount: 50, reason: 'evento' });
    const viaSlash = await slash(t, 'creditos dar', { membro: '222', quantidade: 50, motivo: 'evento' });
    expect(viaAction.ok).toBe(true);
    expect(viaAction.message).toBe(viaSlash?.replace('<@222>', '<@111>'));
    expect(await s.wallet.balanceOf(a)).toBe(50);

    const tooMuch = await run(t, 'credits-remove', { member: '111', amount: 80, reason: 'erro' });
    expect(tooMuch.ok).toBe(false);
    expect(tooMuch.message).toBe(
      (await slash(t, 'creditos dar', { membro: '111', quantidade: -80, motivo: 'erro' })) ?? '',
    );
    expect(await s.wallet.balanceOf(a)).toBe(50);

    const removed = await run(t, 'credits-remove', { member: '111', amount: 20, reason: 'erro' });
    expect(removed.ok).toBe(true);
    expect(await s.wallet.balanceOf(a)).toBe(30);

    const unknown = await run(t, 'credits-give', { member: '555', amount: 5, reason: 'x' });
    expect(unknown).toEqual({
      ok: false,
      message: (await slash(t, 'creditos dar', { membro: '555', quantidade: 5, motivo: 'x' })) ?? '',
    });
  });

  it('give item matches /jarvis item dar, including the already-owned refusal', async () => {
    t = await setupJarvis();
    await addMember(t, '111', 'xmen', 'Tempestade');
    await addMember(t, '222', 'xmen', 'Ciclope');
    const viaAction = await run(t, 'item-give', { member: '111', item: 'traje-de-treino', reason: null });
    const viaSlash = await slash(t, 'item dar', { membro: '222', item: 'traje-de-treino' });
    expect(viaAction.ok).toBe(true);
    expect(viaAction.message).toBe(viaSlash?.replace('<@222>', '<@111>'));
    const again = await run(t, 'item-give', { member: '111', item: 'traje-de-treino', reason: null });
    expect(again.ok).toBe(false);
    expect(again.message).toBe(
      (await slash(t, 'item dar', { membro: '222', item: 'traje-de-treino' }))?.replace('<@222>', '<@111>'),
    );
  });

  it('a price change survives a reload, is used by /loja and buy, and can be cleared', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const m = await addMember(t, '111', 'xmen', 'Tempestade');
    const base = (await s.items.row('traje-de-treino'))?.price;
    expect(base).toBeGreaterThan(0);

    expect(await run(t, 'item-price', { item: 'traje-de-treino', price: 7 })).toEqual({
      ok: true,
      message: 'Preço de traje-de-treino agora é 7 créditos.',
    });
    await s.items.reload();
    expect((await s.items.row('traje-de-treino'))?.price).toBe(7);

    const shop = t.gateway.lastReply(
      await t.interact({ kind: 'command', userId: '111', commandName: 'loja' }),
    ) as OutgoingMessage;
    expect(JSON.stringify(shop)).toContain('7');
    await t.db.transaction((tx) =>
      s.wallet.credit(tx, { memberId: m, amount: 10, reason: 'staff', sourceKey: 'seed' }),
    );
    expect(await s.inventory.buy(m, 'traje-de-treino', 7)).toMatchObject({ ok: true, price: 7, balance: 3 });

    const cleared = await run(t, 'item-price', { item: 'traje-de-treino', price: null });
    expect(cleared.ok).toBe(true);
    expect((await s.items.row('traje-de-treino'))?.price).toBe(base);
    expect((await run(t, 'item-price', { item: 'nao-existe', price: 3 })).ok).toBe(false);
  });
});
