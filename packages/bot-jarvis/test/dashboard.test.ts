import { cerebro } from '@legion/bot-cerebro';
import { createTestContext, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { addMember, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const panel = (tc: TestContext, id: string) => {
  const p = tc.runtime.dashboard.get('jarvis', id);
  if (!p) throw new Error(`no panel ${id}`);
  return p.render();
};

describe('J.A.R.V.I.S. dashboard panels', () => {
  it('shows totals, 7-day flows, top balances and purchases from the wallet ledger', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const a = await addMember(t, '111', 'xmen', 'Tempestade');
    const b = await addMember(t, '222', 'xmen', 'Ciclope');
    const move = (
      fn: 'credit' | 'debit',
      memberId: string,
      amount: number,
      reason: string,
      key: string,
      note?: string,
    ) =>
      t?.db.transaction((tx) =>
        s.wallet[fn](tx, {
          memberId,
          amount,
          reason: reason as never,
          sourceKey: key,
          ...(note ? { note } : {}),
        }),
      );
    await move('credit', a, 500, 'trivia', 'old'); // falls outside the 7-day window
    t.clock.advance(8 * 86_400_000);
    await move('credit', a, 100, 'mission', 'm1');
    await move('credit', b, 50, 'trivia', 't1');
    await move('debit', a, 30, 'purchase', 'buy1', 'capa-x');

    expect(await panel(t, 'economy')).toEqual({
      kind: 'stats',
      items: [
        { labelKey: 'jarvis.dashboard.in_circulation', value: 620 },
        { labelKey: 'jarvis.dashboard.wallets', value: 2 },
        { labelKey: 'jarvis.dashboard.earned_7d', value: 150 },
        { labelKey: 'jarvis.dashboard.spent_7d', value: 30 },
      ],
    });
    expect(
      (await panel(t, 'top-balances')).kind === 'table' && (await panel(t, 'top-balances')),
    ).toMatchObject({
      rows: [
        [1, 'Tempestade', 570],
        [2, 'Ciclope', 50],
      ],
    });
    const purchases = await panel(t, 'purchases');
    expect(purchases).toMatchObject({ kind: 'table' });
    if (purchases.kind === 'table') {
      expect(purchases.rows).toHaveLength(1);
      expect(purchases.rows[0]?.slice(1)).toEqual(['Tempestade', 'capa-x', 30]);
    }
  });

  it('registers nothing when J.A.R.V.I.S. is disabled', async () => {
    t = await createTestContext({ bots: [cerebro] });
    expect(t.runtime.dashboard.list().map((p) => p.bot)).toEqual(['core']);
  });
});
