import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultJarvisConfig, InsufficientCredits, jarvisConfigSchema } from '../src/index.js';
import { addMember, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const STAFF = { userId: '999', isGuildOwner: true };
const give = (tc: TestContext, quantidade: number, motivo = 'evento', userId = STAFF.userId) =>
  tc.interact({
    kind: 'command',
    userId,
    isGuildOwner: userId === STAFF.userId,
    commandName: 'jarvis',
    subcommand: 'creditos dar',
    options: { membro: '111', quantidade, motivo },
  });

describe('jarvis.economy config', () => {
  it('has the spec defaults', () => {
    expect(defaultJarvisConfig().economy).toEqual({
      enabled: true,
      trivia: { correct: 2 },
      missions: {
        daily: { success: 20, failure: 5 },
        weekly: { success: 60, failure: 15 },
        story: { success: 40, failure: 10 },
      },
      worldEvents: { victory: 30, participation: 10 },
      gear: { statCap: 2 },
    });
  });

  it('refuses bad values with a readable path', () => {
    const r = jarvisConfigSchema.safeParse({
      economy: { trivia: { correct: -1 }, missions: { daily: { success: 1.5 } } },
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toEqual([
      'economy.trivia.correct',
      'economy.missions.daily.success',
    ]);
  });
});

describe('WalletService', () => {
  it('credits and debits with a ledger row each; the wallet is created on the first movement', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const m = await addMember(t, '111');
    expect(await s.wallet.balanceOf(m)).toBe(0);
    expect(await s.wallet.history(m)).toEqual([]);
    const w = s.repo.t.jarvisWallets;
    expect(await t.db.orm.select().from(w)).toEqual([]);

    const c = await t.db.transaction((tx) =>
      s.wallet.credit(tx, {
        memberId: m,
        amount: 50,
        reason: 'mission',
        sourceKey: 'mission:r1:m',
        note: 'sinal',
      }),
    );
    expect(c).toEqual({ duplicate: false, balance: 50 });
    const d = await t.db.transaction((tx) =>
      s.wallet.debit(tx, { memberId: m, amount: 20, reason: 'purchase', sourceKey: 'buy:m:capuz' }),
    );
    expect(d).toEqual({ duplicate: false, balance: 30 });
    expect(await s.wallet.balanceOf(m)).toBe(30);
    expect((await s.wallet.history(m)).map((e) => [e.amount, e.reason, e.note])).toEqual(
      expect.arrayContaining([
        [50, 'mission', 'sinal'],
        [-20, 'purchase', null],
      ]),
    );
  });

  it('a repeated sourceKey changes nothing', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const m = await addMember(t, '111');
    const pay = () =>
      t?.db.transaction((tx) =>
        s.wallet.credit(tx, { memberId: m, amount: 10, reason: 'trivia', sourceKey: 'trivia:a1' }),
      );
    expect(await pay()).toEqual({ duplicate: false, balance: 10 });
    expect(await pay()).toEqual({ duplicate: true, balance: 10 });
    expect(await s.wallet.history(m)).toHaveLength(1);
  });

  it('a debit beyond the balance throws InsufficientCredits and writes nothing', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const m = await addMember(t, '111');
    await t.db.transaction((tx) =>
      s.wallet.credit(tx, { memberId: m, amount: 5, reason: 'staff', sourceKey: 'staff:1' }),
    );
    const err = await t.db
      .transaction((tx) =>
        s.wallet.debit(tx, { memberId: m, amount: 6, reason: 'purchase', sourceKey: 'buy:x' }),
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientCredits);
    expect(err).toMatchObject({ balance: 5, amount: 6 });
    expect(await s.wallet.balanceOf(m)).toBe(5);
    expect(await s.wallet.history(m)).toHaveLength(1);
    // The same key can be used later, since nothing was written.
    await t.db.transaction((tx) =>
      s.wallet.credit(tx, { memberId: m, amount: 5, reason: 'staff', sourceKey: 'staff:2' }),
    );
    expect(
      await t.db.transaction((tx) =>
        s.wallet.debit(tx, { memberId: m, amount: 6, reason: 'purchase', sourceKey: 'buy:x' }),
      ),
    ).toEqual({
      duplicate: false,
      balance: 4,
    });
  });

  it('refuses zero and negative amounts', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const m = await addMember(t, '111');
    await expect(
      t.db.transaction((tx) =>
        s.wallet.credit(tx, { memberId: m, amount: 0, reason: 'staff', sourceKey: 'z' }),
      ),
    ).rejects.toThrow(RangeError);
    await expect(
      t.db.transaction((tx) =>
        s.wallet.debit(tx, { memberId: m, amount: -3, reason: 'staff', sourceKey: 'z' }),
      ),
    ).rejects.toThrow(RangeError);
  });
});

describe('/carteira and /jarvis creditos dar', () => {
  it('shows an empty wallet and needs registration', async () => {
    t = await setupJarvis();
    await addMember(t, '111');
    const msg = t.gateway.lastReply(
      await t.interact({ kind: 'command', userId: '111', commandName: 'carteira' }),
    );
    expect(msg?.ephemeral).toBe(true);
    expect(msg?.embeds?.[0]).toMatchObject({
      title: '💳 Carteira',
      description: 'Saldo: **0** créditos',
      fields: [
        {
          name: 'Últimas movimentações',
          value: 'Nenhuma movimentação ainda. Missões, trivia e eventos do mundo pagam créditos.',
        },
      ],
    });
    t.gateway.addMember({ userId: '222' });
    const no = t.gateway.lastReply(
      await t.interact({ kind: 'command', userId: '222', commandName: 'carteira' }),
    );
    expect(no?.content).toMatch(/^Você ainda não é um herói registrado/);
  });

  it('staff give and remove; removing more than the balance is refused; the wallet lists the last 10', async () => {
    t = await setupJarvis();
    t.gateway.addMember({ userId: '999' });
    const m = await addMember(t, '111');
    const s = servicesOf(t);
    expect(t.gateway.lastReply(await give(t, 50, 'x', '111'))?.content).toBe(
      'Apenas a staff pode usar este comando.',
    );
    expect(t.gateway.lastReply(await give(t, 120, 'evento de sábado'))?.content).toBe(
      'Créditos ajustados: +120 para <@111> (motivo: evento de sábado). Saldo: 120.',
    );
    expect(t.gateway.lastReply(await give(t, -20, 'engano'))?.content).toBe(
      'Créditos ajustados: -20 para <@111> (motivo: engano). Saldo: 100.',
    );
    expect(t.gateway.lastReply(await give(t, -101, 'demais'))?.content).toBe(
      '<@111> tem só 100 créditos: não dá para tirar mais do que o saldo.',
    );
    expect(t.gateway.lastReply(await give(t, 0))?.content).toBe(
      'Use uma quantidade de -10000 a 10000, diferente de 0, e um motivo.',
    );
    expect(t.gateway.lastReply(await give(t, 10001))?.content).toMatch(/^Use uma quantidade/);
    expect(await s.wallet.balanceOf(m)).toBe(100);
    const [last] = await s.wallet.history(m, 1);
    expect(last).toMatchObject({ amount: -20, reason: 'staff', createdBy: '999', note: 'engano' });

    for (let n = 0; n < 11; n++) {
      t.clock.advance(60_000);
      await give(t, 1, `bônus ${n}`);
    }
    const lines = (
      t.gateway.lastReply(await t.interact({ kind: 'command', userId: '111', commandName: 'carteira' }))
        ?.embeds?.[0]?.fields?.[0]?.value ?? ''
    ).split('\n');
    expect(lines).toHaveLength(10);
    expect(lines[0]).toMatch(/^`\s+\+1` Staff · bônus 10 · <t:\d+:d>$/);
  });

  it('speaks English and notes when payouts are off', async () => {
    t = await setupJarvis({ locale: 'en', jarvis: { economy: { enabled: false } } });
    t.gateway.addMember({ userId: '999' });
    await addMember(t, '111');
    await give(t, 5, 'gift');
    const e = t.gateway.lastReply(
      await t.interact({ kind: 'command', userId: '111', commandName: 'carteira' }),
    )?.embeds?.[0];
    expect(e).toMatchObject({
      title: '💳 Wallet',
      description: 'Balance: **5** credits',
      footer: { text: 'Credit payouts are turned off on this server.' },
    });
    expect(e?.fields?.[0]?.value).toMatch(/^`\s+\+5` Staff · gift/);
  });
});
