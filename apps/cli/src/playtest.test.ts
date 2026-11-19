import { CerebroRepo, cerebro, cerebroTables } from '@legion/bot-cerebro';
import { jarvis, jarvisServices, jarvisTables } from '@legion/bot-jarvis';
import { createTestContext, type TestContext } from '@legion/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { formatPlaytest, parseSince, playtestReport } from './playtest.js';

const MISSIONS_CH = '300000000000000009';
const LIMITS = { dailyPerMember: 1, weeklyPerMember: 1 };
let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup() {
  const tc = await createTestContext({
    bots: [cerebro, jarvis],
    config: { channels: { missions: MISSIONS_CH } },
  });
  tc.gateway.addChannel({ id: MISSIONS_CH, name: 'missoes', kind: 'text', parentId: null, overwrites: [] });
  return tc;
}

async function addPlayer(tc: TestContext, userId: string, codename: string) {
  tc.gateway.addMember({ userId });
  const repo = new CerebroRepo(tc.db, tc.gateway.guildId, tc.clock, tc.runtime.newId);
  const { row } = await repo.ensureMember(userId);
  await repo.updateMember(row.id, { onboardingStep: 'registered', faction: 'xmen' });
  await repo.insertMutant({
    memberId: row.id,
    codename,
    codenameNormalized: codename.toLowerCase(),
    power: 'p',
    archetype: 'Elemental',
    origin: 'o',
  });
  return row.id;
}

const sceneButtons = (tc: TestContext) =>
  (
    tc.gateway.messages
      .filter((m) => m.msg.persona === 'jarvis' && (m.msg.components?.[0]?.length ?? 0) > 0)
      .at(-1)?.msg.components?.[0] ?? []
  ).map((b) => ('customId' in b ? (b.customId ?? '') : ''));
const click = (tc: TestContext, customId: string, userId: string) =>
  tc.interact({ kind: 'component', userId, customId });

/** Patrulha noturna to the success ending (40 XP), as in the J.A.R.V.I.S. tests. */
async function playPatrol(tc: TestContext, userId: string) {
  await tc.interact({
    kind: 'command',
    userId,
    commandName: 'missao',
    subcommand: 'iniciar',
    options: { missao: 'patrulha-noturna' },
  });
  await click(tc, sceneButtons(tc)[1] ?? '', userId);
  await click(tc, sceneButtons(tc)[0] ?? '', userId);
}

const report = (tc: TestContext, since = new Date(0)) =>
  playtestReport(tc.db, {
    guildId: tc.gateway.guildId,
    since,
    now: tc.clock.now(),
    bots: ['cerebro', 'jarvis'],
    limits: LIMITS,
  });

describe('legion playtest-report', () => {
  it('summarises a played mission and finds nothing wrong', async () => {
    t = await setup();
    const id = await addPlayer(t, '111', 'Pulso');
    await playPatrol(t, '111');
    const r = await report(t);
    expect(r.registrations.map((x) => x.who)).toEqual(['Pulso']);
    expect(r.runs).toEqual([
      expect.objectContaining({
        missionId: 'patrulha-noturna',
        kind: 'daily',
        status: 'success',
        leader: 'Pulso',
        members: [{ who: 'Pulso', xp: 40 }],
      }),
    ]);
    // The first activity of the day also pays the streak bonus.
    expect(r.xp).toEqual([
      { who: 'Pulso', reason: 'mission', total: 40, rows: 1 },
      { who: 'Pulso', reason: 'streak_bonus', total: 5, rows: 1 },
    ]);
    expect(r.problems).toEqual([]);
    const text = formatPlaytest(r);
    expect(text).toContain('patrulha-noturna [daily] success @ aliada');
    expect(text).toContain('✅ XP, créditos, limites e lutas batem');
    expect(r.economy).toEqual({
      byReason: [{ reason: 'mission', total: 20, rows: 1 }],
      purchases: 0,
      staff: [],
    });
    expect(text).toContain('== Economia (créditos no período) ==\nmission: +20 (1 linha(s))\ncompras: 0');
    expect(text).toContain(`grep '"level":50'`);
    expect(id).toBeTruthy();
  });

  it('flags progress that does not match the ledger, XP on an abandoned run, and limits broken', async () => {
    t = await setup();
    const memberId = await addPlayer(t, '111', 'Pulso');
    await playPatrol(t, '111');
    const j = jarvisTables(t.db);
    await t.db.orm.update(j.jarvisProgress).set({ xp: 999 }).where(eq(j.jarvisProgress.memberId, memberId));
    const [run] = await jarvisServices(t.ctxOf(jarvis)).repo.runsOf(memberId);
    // A second daily on the same day, as if the limit had not been applied.
    await t.db.orm
      .insert(j.jarvisMissionRuns)
      .values({ ...(run as NonNullable<typeof run>), id: 'run-2', status: 'abandoned' });
    await t.db.orm
      .insert(j.jarvisMissionMembers)
      .values({ runId: 'run-2', memberId, joinedAt: run?.createdAt ?? '' });
    await t.db.orm.insert(j.jarvisXpLedger).values({
      id: 'l-2',
      guildId: t.gateway.guildId,
      memberId,
      amount: 40,
      reason: 'mission',
      note: 'patrulha-noturna',
      sourceKey: `mission:run-2:${memberId}`,
      day: run?.day ?? '',
      createdAt: run?.createdAt ?? '',
    });
    const r = await report(t);
    expect(r.problems).toEqual(
      expect.arrayContaining([
        'patrulha-noturna (run-2): abandoned, mas pagou XP',
        'Pulso: progresso mostra 999 XP, histórico soma 85',
        expect.stringMatching(/^Pulso: 2 missões diárias em \d{4}-\d{2}-\d{2} \(limite 1\)$/),
      ]),
    );
    expect(formatPlaytest(r)).toMatch(/❌ 3 problema\(s\)/);
  });

  it('economy: staff movements are listed; a wrong or negative balance and a ledger without a wallet are problems', async () => {
    t = await setup();
    t.gateway.addMember({ userId: '999' });
    const a = await addPlayer(t, '111', 'Pulso');
    const b = await addPlayer(t, '222', 'Brasa');
    await playPatrol(t, '111');
    await t.interact({
      kind: 'command',
      userId: '999',
      isGuildOwner: true,
      commandName: 'jarvis',
      subcommand: 'creditos dar',
      options: { membro: '222', quantidade: 50, motivo: 'evento' },
    });
    const clean = await report(t);
    expect(clean.problems).toEqual([]);
    expect(clean.economy?.staff).toEqual([
      expect.objectContaining({ who: 'Brasa', amount: 50, by: '999', note: 'evento' }),
    ]);
    expect(formatPlaytest(clean)).toMatch(/staff \+50 → Brasa · por <@999> · evento/);

    const j = jarvisTables(t.db);
    await t.db.orm.update(j.jarvisWallets).set({ balance: 999 }).where(eq(j.jarvisWallets.memberId, a));
    await t.db.orm.delete(j.jarvisWallets).where(eq(j.jarvisWallets.memberId, b));
    const r = await report(t);
    expect(r.problems).toEqual([
      'Pulso: carteira mostra 999 créditos, histórico soma 20',
      'Brasa: tem créditos no histórico (50), mas nenhuma carteira',
    ]);
  });

  it('skips the economy without J.A.R.V.I.S.', async () => {
    t = await setup();
    const r = await playtestReport(t.db, {
      guildId: t.gateway.guildId,
      since: new Date(0),
      now: t.clock.now(),
      bots: ['cerebro'],
      limits: LIMITS,
    });
    expect(r.economy).toBeNull();
    expect(formatPlaytest(r)).not.toContain('Economia');
  });

  it('does not expect XP for a member who left the server', async () => {
    t = await setup();
    const memberId = await addPlayer(t, '111', 'Pulso');
    const other = await addPlayer(t, '222', 'Brasa');
    await playPatrol(t, '111');
    const j = jarvisTables(t.db);
    const [run] = await jarvisServices(t.ctxOf(jarvis)).repo.runsOf(memberId);
    // Brasa was in the party too, but got no mission XP.
    await t.db.orm
      .insert(j.jarvisMissionMembers)
      .values({ runId: run?.id ?? '', memberId: other, joinedAt: run?.createdAt ?? '' });
    expect((await report(t)).problems).toEqual([expect.stringMatching(/success, mas sem XP para Brasa$/)]);
    const c = cerebroTables(t.db);
    await t.db.orm
      .update(c.members)
      .set({ leftAt: run?.createdAt ?? '' })
      .where(eq(c.members.id, other));
    expect((await report(t)).problems).toEqual([]);
  });

  it('only reports what happened since --since and warns about missions left open', async () => {
    t = await setup();
    await addPlayer(t, '111', 'Pulso');
    await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'missao',
      subcommand: 'iniciar',
      options: { missao: 'patrulha-noturna' },
    });
    const later = new Date(t.clock.now().getTime() + 60 * 60_000);
    const r = await playtestReport(t.db, {
      guildId: t.gateway.guildId,
      since: new Date(0),
      now: later,
      bots: ['cerebro', 'jarvis'],
    });
    expect(r.warnings).toEqual([expect.stringMatching(/ainda "active" há 60 min sem mudança/)]);
    expect((await report(t, later)).runs).toEqual([]);
  });

  it('reads --since as a duration or a date', () => {
    const now = new Date('2026-11-18T20:00:00.000Z');
    expect(parseSince('90m', now)?.toISOString()).toBe('2026-11-18T18:30:00.000Z');
    expect(parseSince('3h', now)?.toISOString()).toBe('2026-11-18T17:00:00.000Z');
    expect(parseSince('2d', now)?.toISOString()).toBe('2026-11-16T20:00:00.000Z');
    expect(parseSince('2026-11-18T19:00:00-03:00', now)?.toISOString()).toBe('2026-11-18T22:00:00.000Z');
    expect(parseSince('ontem', now)).toBeNull();
  });
});
