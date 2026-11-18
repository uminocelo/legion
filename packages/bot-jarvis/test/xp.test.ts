import type { TestContext } from '@legion/core';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { jarvis } from '../src/index.js';
import { addMember, award, events, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('award pipeline', () => {
  it('is idempotent by sourceKey', async () => {
    t = await setupJarvis();
    const m = await addMember(t, '111');
    expect((await award(t, m, 40, 'grant:e1:tutorial')).duplicate).toBe(false);
    expect((await award(t, m, 40, 'grant:e1:tutorial')).duplicate).toBe(true);
    const p = await t.runtime.providers.readModels().progress.get(m);
    expect(p).toMatchObject({ xp: 45, level: 1, currentStreak: 1 }); // 40 + streak bonus 5
    expect((await events(t, 'xp.awarded')).map((e) => [e.amount, e.reason])).toEqual([
      [40, 'grant'],
      [5, 'streak_bonus'],
    ]);
    expect(await events(t, 'streak.updated')).toEqual([{ memberId: m, streak: 1, day: '2026-11-16' }]);
  });

  it('grants the streak bonus once per day and counts across days', async () => {
    t = await setupJarvis();
    const m = await addMember(t, '111');
    await award(t, m, 10, 'a', 'trivia');
    await award(t, m, 10, 'b', 'trivia');
    t.clock.advance(24 * 3600_000);
    await award(t, m, 10, 'c', 'trivia');
    const s = servicesOf(t);
    const p = await s.repo.progress(m);
    expect(p).toMatchObject({
      xp: 30 + 5 + 10,
      currentStreak: 2,
      bestStreak: 2,
      lastActiveDay: '2026-11-17',
    });
    expect(await events(t, 'streak.updated')).toHaveLength(2);
    // admin adjustments never count as an active day
    t.clock.advance(24 * 3600_000);
    await award(t, m, 50, 'admin:1', 'admin_adjust');
    expect((await s.repo.progress(m))?.lastActiveDay).toBe('2026-11-17');
  });

  it('emits rank.changed once per crossing, up and down, and Cérebro swaps the roles', async () => {
    t = await setupJarvis();
    await t.runtime.ready({ startPolling: false }); // role sync
    const m = await addMember(t, '111');
    await award(t, m, 490, 'g1'); // +5 streak = 495
    expect(await events(t, 'rank.changed')).toHaveLength(0);
    await award(t, m, 10, 'g2'); // 505
    await award(t, m, 10, 'g3');
    expect(await events(t, 'rank.changed')).toEqual([
      { memberId: m, discordUserId: '111', from: 'recruta', to: 'agente' },
    ]);
    expect(t.gateway.memberRoleNames('111')).toContain('Agente');
    await award(t, m, 1500, 'g4'); // 2015
    await award(t, m, -100, 'admin:2', 'admin_adjust'); // 1915: back to agente
    expect((await events(t, 'rank.changed')).map((e) => `${e.from}>${e.to}`)).toEqual([
      'recruta>agente',
      'agente>veterano',
      'veterano>agente',
    ]);
    expect(t.gateway.memberRoleNames('111')).toContain('Agente');
    expect(t.gateway.memberRoleNames('111')).not.toContain('Veterano');
    const levels = (await events(t, 'level.changed')).map((e) => `${e.from}>${e.to}`);
    expect(levels).toEqual(['1>4', '4>7']);
  });

  it('rolls back everything when the transaction fails', async () => {
    t = await setupJarvis();
    const m = await addMember(t, '111');
    const s = servicesOf(t);
    await expect(
      t.runtime.bus.forSource('jarvis').transaction(async (tx) => {
        await s.xp.award(tx, { memberId: m, amount: 600, reason: 'grant', sourceKey: 'x' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await s.repo.ledgerFor(m)).toEqual([]);
    expect(await events(t, 'xp.awarded')).toEqual([]);
    expect((await award(t, m, 600, 'x')).duplicate).toBe(false); // the key is free again
  });

  it('incremental progress equals the progress rebuilt from the ledger (property, real DB)', async () => {
    t = await setupJarvis();
    const tc = t;
    const s = servicesOf(tc);
    let n = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            amount: fc.integer({ min: -300, max: 600 }).filter((x) => x !== 0),
            reason: fc.constantFrom('trivia', 'grant', 'admin_adjust'),
            days: fc.integer({ min: 0, max: 2 }),
            dup: fc.boolean(),
          }),
          { maxLength: 15 },
        ),
        async (steps) => {
          const m = await addMember(tc, String(900_000 + n++));
          for (const [i, st] of steps.entries()) {
            tc.clock.advance(st.days * 24 * 3600_000);
            const key = st.dup && i > 0 ? `k${m}:${i - 1}` : `k${m}:${i}`;
            await award(tc, m, st.amount, key, st.reason as 'trivia');
          }
          const inc = await s.repo.progress(m);
          const { after } = await s.xp.recalculate(m);
          expect(after).toMatchObject({
            xp: inc?.xp ?? 0,
            level: inc?.level ?? 1,
            rank: inc?.rank ?? 'recruta',
            currentStreak: inc?.currentStreak ?? 0,
            bestStreak: inc?.bestStreak ?? 0,
            lastActiveDay: inc?.lastActiveDay ?? null,
          });
        },
      ),
      { numRuns: 15 },
    );
  });
});

describe('consumers', () => {
  it('player.created creates the progress row once', async () => {
    t = await setupJarvis();
    const m = await addMember(t, '111');
    const bus = t.runtime.bus.forSource('cerebro');
    const payload = {
      memberId: m,
      discordUserId: '111',
      mutantId: 'mu1',
      codename: 'Faísca',
      archetype: 'Elemental',
      faction: 'xmen',
      originType: 'mutante',
    };
    await bus.transaction((tx) => bus.emit(tx, 'player.created', payload));
    await bus.transaction((tx) => bus.emit(tx, 'player.created', payload));
    await t.runtime.bus.drain();
    expect(await t.runtime.providers.readModels().progress.get(m)).toEqual({
      xp: 0,
      level: 1,
      rank: 'recruta',
      currentStreak: 0,
      bestStreak: 0,
    });
  });

  it('xp.grant_requested writes one ledger entry per (sourceEventId, reason, member) and ignores unknown members', async () => {
    t = await setupJarvis();
    const m = await addMember(t, '111');
    const bus = t.runtime.bus.forSource('herbie');
    const grant = { memberId: m, amount: 25, reason: 'tutorial', sourceEventId: 'ev1' };
    await bus.transaction((tx) => bus.emit(tx, 'xp.grant_requested', grant));
    await bus.transaction((tx) => bus.emit(tx, 'xp.grant_requested', grant));
    await bus.transaction((tx) => bus.emit(tx, 'xp.grant_requested', { ...grant, memberId: 'ghost' }));
    const other = await addMember(t, '222');
    await bus.transaction((tx) => bus.emit(tx, 'xp.grant_requested', { ...grant, memberId: other }));
    await t.runtime.bus.drain();
    expect((await servicesOf(t).repo.ledgerFor(other)).map((l) => l.sourceKey)).toContain(
      `grant:ev1:tutorial:${other}`,
    );
    const ledger = await servicesOf(t).repo.ledgerFor(m);
    expect(ledger.map((l) => [l.reason, l.note, l.sourceKey])).toEqual([
      ['grant', 'tutorial', `grant:ev1:tutorial:${m}`],
      ['streak_bonus', null, `streak:${m}:2026-11-16`],
    ]);
    const { coreTables } = await import('@legion/core');
    const c = coreTables(t.db).coreEventConsumption;
    const statuses = (await t.db.orm.select().from(c))
      .filter((r) => r.consumerId === 'jarvis.xp-grant')
      .map((r) => r.status);
    expect(statuses).toEqual(['done', 'done', 'done', 'done']); // unknown member: done, not retried forever
  });

  it('provides the progress read model to other bots, with a lazily lapsed streak', async () => {
    t = await setupJarvis();
    const m = await addMember(t, '111');
    await award(t, m, 10, 'a', 'trivia');
    t.clock.advance(2 * 24 * 3600_000);
    const ctx = t.ctxOf(jarvis);
    expect(await ctx.read.progress.get(m)).toMatchObject({ xp: 15, currentStreak: 0, bestStreak: 1 });
  });
});
