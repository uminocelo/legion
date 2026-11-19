import type { TestContext } from '@legion/core';
import { coreTables } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { strikeId } from '../src/index.js';
import { addMember, CH, events, servicesOf, setupUltron } from './helpers.js';

let t: TestContext;
afterEach(async () => t?.close());

const HOUR = 3_600_000;
const strike = (tc: TestContext, user: string, id: string) =>
  tc.interact({ kind: 'component', userId: user, customId: strikeId(id) });
const ultronMsgs = (tc: TestContext) => tc.gateway.messages.filter((m) => m.channelId === CH.events);
const jobs = async (tc: TestContext) => {
  const j = coreTables(tc.db).coreScheduledJobs;
  return (await tc.db.orm.select().from(j)).filter((r) => r.name.startsWith('ultron.'));
};
/** Moves the clock and runs whatever became due. */
const at = async (tc: TestContext, iso: string) => {
  tc.clock.set(new Date(iso));
  await tc.settle();
  await tc.settle();
};

async function raidIn2h(tc: TestContext) {
  const r = await servicesOf(tc).world.schedule({
    kind: 'raid',
    startsAt: new Date(tc.clock.now().getTime() + 2 * HOUR),
    scheduledBy: '1',
  });
  if (!r.ok) throw new Error(r.error);
  return r.event;
}

describe('world event lifecycle', () => {
  it('schedule → announce → start → strikes → victory, with results, XP once and no double posts', async () => {
    t = await setupUltron({
      config: { ultron: { events: { hpPerParticipant: 10, expectedParticipants: 3 } } },
    });
    const s = servicesOf(t);
    const a = await addMember(t, '111', 'xmen');
    const b = await addMember(t, '222', 'irmandade');
    const ev = await raidIn2h(t);
    expect(ev).toMatchObject({ status: 'scheduled', kind: 'raid', templateId: 'bastiao-prime' });
    await at(t, ev.announceAt);
    expect((await s.eventsRepo.event(ev.id))?.status).toBe('announced');
    expect(ultronMsgs(t)).toHaveLength(1);
    expect(ultronMsgs(t)[0]?.msg.embeds?.[0]?.title).toBe('⚠️ Raid: Bastião Prime');
    // Strike before the start
    expect(t.gateway.lastReply(await strike(t, '111', ev.id))?.content).toMatch(
      /^O evento ainda não começou/,
    );

    await at(t, ev.startsAt);
    const live = await s.eventsRepo.event(ev.id);
    expect(live).toMatchObject({ status: 'active', maxHp: 30, hp: 30, bossLevel: 5 });
    expect(ultronMsgs(t)).toHaveLength(2);
    expect(t.gateway.callsOf('createThread')).toHaveLength(1);
    expect((await events(t, 'world.event')).map((e) => e.phase)).toEqual(['announced', 'started']);

    for (let n = 0; n < 10 && (await s.eventsRepo.event(ev.id))?.status === 'active'; n++) {
      for (const u of ['111', '222']) await strike(t, u, ev.id);
      await t.settle();
      t.clock.advance(20 * 60_000);
    }
    const done = await s.eventsRepo.event(ev.id);
    expect(done).toMatchObject({ status: 'ended', outcome: 'victory', hp: 0 });
    const ended = (await events(t, 'world.event')).filter((e) => e.phase === 'ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]?.participantMemberIds.sort()).toEqual([a, b].sort());
    const parts = await s.eventsRepo.participants(ev.id);
    const grants = await events(t, 'xp.grant_requested');
    expect(grants).toHaveLength(2);
    for (const p of parts)
      expect(grants.find((g) => g.memberId === p.memberId)?.amount).toBe(
        50 + Math.floor((50 * p.damage) / (parts[0]?.damage ?? 1)),
      );
    expect(grants.every((g) => g.reason === 'world_event' && g.sourceEventId === ev.id)).toBe(true);
    const results = ultronMsgs(t)[2]?.msg;
    expect(results?.embeds?.[0]?.title).toBe('🏆 Raid: Bastião Prime · Vitória');
    expect(results?.embeds?.[0]?.fields?.map((f) => f.name)).toEqual([
      'Dano total',
      'Participantes',
      'Maiores danos',
      'XP',
    ]);
    // Replays of every job and the end job firing later: nothing posts twice, XP stays once.
    await s.world.announce(ev.id);
    await s.world.start(ev.id);
    await s.world.end(ev.id);
    await at(t, ev.endsAt);
    expect(ultronMsgs(t)).toHaveLength(3);
    expect(await events(t, 'xp.grant_requested')).toHaveLength(2);
    // J.A.R.V.I.S. pays the victory credits from world.event ended, once (v0.10, US-14).
    const { jarvis, jarvisServices } = await import('@legion/bot-jarvis');
    const wallet = jarvisServices(t.ctxOf(jarvis)).wallet;
    expect([await wallet.balanceOf(a), await wallet.balanceOf(b)]).toEqual([30, 30]);
    // A strike after the end
    expect(t.gateway.lastReply(await strike(t, '111', ev.id))?.content).toBe('O evento já terminou.');
  });

  it('the weekly invasion is planned from the cron, times out into a defeat and pays participation XP', async () => {
    t = await setupUltron();
    const s = servicesOf(t);
    await addMember(t, '111', 'xmen');
    await s.world.planRecurring();
    await s.world.planRecurring(); // idempotent
    const [inv] = await s.eventsRepo.openEvents('invasion');
    expect(await s.eventsRepo.openEvents()).toHaveLength(1);
    expect(inv?.startsAt).toBe('2026-11-21T23:00:00.000Z'); // Saturday 20:00 in São Paulo
    expect(inv?.announceAt).toBe('2026-11-21T22:00:00.000Z');
    await at(t, inv?.startsAt ?? '');
    expect((await s.eventsRepo.event(inv?.id ?? ''))?.maxHp).toBe(2400);
    await strike(t, '111', inv?.id ?? '');
    await t.settle();
    await at(t, inv?.endsAt ?? '');
    expect(await s.eventsRepo.event(inv?.id ?? '')).toMatchObject({ status: 'ended', outcome: 'defeat' });
    expect((await events(t, 'xp.grant_requested')).map((g) => g.amount)).toEqual([15]);
    const results = ultronMsgs(t).at(-1)?.msg.embeds?.[0];
    expect(results?.title).toBe('💀 Invasão: Enxame de Nanites · Derrota');
    expect(results?.fields?.find((f) => f.name === 'Dano por facção')?.value).toMatch(/· \d+$/);
    // The next invasion is already planned for the following Saturday.
    expect((await s.eventsRepo.openEvents('invasion'))[0]?.startsAt).toBe('2026-11-28T23:00:00.000Z');
  });

  it('cancel removes the pending jobs and nothing is announced', async () => {
    t = await setupUltron();
    const s = servicesOf(t);
    const ev = await raidIn2h(t);
    await s.world.cancel(ev.id);
    expect((await jobs(t)).filter((j) => j.payload.includes(ev.id)).map((j) => j.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    await at(t, ev.endsAt);
    expect(ultronMsgs(t)).toHaveLength(0);
    expect((await events(t, 'world.event')).map((e) => [e.phase, e.outcome])).toEqual([['ended', null]]);
  });

  it('bot down from before the start until after the end: one catch-up run, no double posts', async () => {
    t = await setupUltron();
    const s = servicesOf(t);
    const ev = await raidIn2h(t);
    await at(t, ev.announceAt);
    await at(t, new Date(new Date(ev.endsAt).getTime() + HOUR).toISOString());
    expect(await s.eventsRepo.event(ev.id)).toMatchObject({ status: 'ended', outcome: 'defeat' });
    // announcement, event message (edited in place to its final state), results
    expect(ultronMsgs(t).map((m) => m.msg.embeds?.[0]?.title?.slice(0, 2))).toEqual(['⚠️', '🏁', '💀']);
    expect((await events(t, 'world.event')).map((e) => e.phase)).toEqual(['announced', 'started', 'ended']);
  });

  it('a restart in the middle of a phase (job retried) does not post again', async () => {
    t = await setupUltron();
    const s = servicesOf(t);
    const ev = await raidIn2h(t);
    await at(t, ev.startsAt);
    // Simulate the job running again after a crash right after it posted.
    await s.world.announce(ev.id);
    await s.world.start(ev.id);
    expect(ultronMsgs(t)).toHaveLength(2);
    expect((await events(t, 'world.event')).map((e) => e.phase)).toEqual(['announced', 'started']);
  });
});

describe('strikes', () => {
  it('cooldown, idempotent application, HP floor, knockout doubles the cooldown, faction damage sums', async () => {
    t = await setupUltron({
      config: { ultron: { events: { hpPerParticipant: 1000, expectedParticipants: 1 } } },
    });
    const s = servicesOf(t);
    const a = await addMember(t, '111', 'xmen');
    await addMember(t, '222', 'xmen');
    const ev = await raidIn2h(t);
    await at(t, ev.startsAt);
    expect(t.gateway.lastReply(await strike(t, '999', ev.id))?.content).toMatch(/^Registre seu herói/);
    expect(t.gateway.lastReply(await strike(t, '111', ev.id))?.content).toMatch(/^Ataque enviado!/);
    expect(t.gateway.lastReply(await strike(t, '111', ev.id))?.content).toBe(
      'Você ainda está se recuperando. Ataque de novo em 10 min.',
    );
    await strike(t, '222', ev.id);
    await t.settle();
    const resolved = (await events(t, 'combat.resolved')).filter((r) => r.raidId === ev.id);
    expect(resolved).toHaveLength(2);
    const after = await s.eventsRepo.event(ev.id);
    const dealt = resolved.reduce((x, r) => x + r.damageBySide.players, 0);
    expect(after?.hp).toBe(1000 - dealt);
    expect((await s.eventsRepo.factionDamage(ev.id)).map((f) => [f.faction, f.damage])).toEqual([
      ['xmen', dealt],
    ]);

    // Same combat.resolved again: applied once.
    const first = resolved[0];
    if (!first) throw new Error('no strike');
    const again = { id: 'x', type: 'combat.resolved', source: 'sentinel', payload: first } as never;
    await s.world.onStrikeResolved(again);
    expect((await s.eventsRepo.event(ev.id))?.hp).toBe(1000 - dealt);

    // A knocked-out strike with more damage than HP left: HP stops at 0, cooldown doubles.
    t.clock.advance(11 * 60_000);
    // A strike whose fight Sentinel has not resolved yet.
    await t.db.transaction((tx) =>
      s.eventsRepo.startStrike(
        {
          eventId: ev.id,
          memberId: a,
          faction: 'xmen',
          combatId: 'pending-1',
          nextStrikeAt: new Date(t.clock.now().getTime() + 10 * 60_000).toISOString(),
        },
        tx,
      ),
    );
    await s.world.onStrikeResolved({
      id: 'y',
      type: 'combat.resolved',
      source: 'sentinel',
      payload: {
        ...first,
        combatId: 'pending-1',
        damageBySide: { players: 5000, enemies: 9 },
        survivors: [],
      },
    } as never);
    const me = await s.eventsRepo.participant(ev.id, a);
    expect(me?.knockouts).toBe(1);
    expect(new Date(me?.nextStrikeAt ?? 0).getTime() - t.clock.now().getTime()).toBe(20 * 60_000);
    expect(await s.eventsRepo.event(ev.id)).toMatchObject({ hp: 0, status: 'ended', outcome: 'victory' });
  });

  it('throttles embed edits to one per 10 s and catches up with a scheduled edit', async () => {
    t = await setupUltron({
      config: { ultron: { events: { hpPerParticipant: 5000, expectedParticipants: 1 } } },
    });
    const ev = await raidIn2h(t);
    for (const u of ['111', '222', '333']) await addMember(t, u);
    await at(t, ev.startsAt);
    const edits = () => t.gateway.callsOf('editMessage').length;
    const before = edits();
    t.clock.advance(11_000);
    for (const u of ['111', '222', '333']) await strike(t, u, ev.id);
    await t.runtime.bus.drain();
    expect(edits() - before).toBe(1);
    const refresh = (await jobs(t)).filter((j) => j.name === 'ultron.refresh' && j.status === 'pending');
    expect(refresh).toHaveLength(1);
    t.clock.advance(10_000);
    await t.settle();
    expect(edits() - before).toBe(2);
  });

  it('the same kind cannot overlap; different kinds can', async () => {
    t = await setupUltron();
    const s = servicesOf(t);
    const ev = await raidIn2h(t);
    const again = await s.world.schedule({
      kind: 'raid',
      startsAt: new Date(new Date(ev.startsAt).getTime() + 10 * 60_000),
      scheduledBy: '1',
    });
    expect(again).toEqual({ ok: false, error: 'overlap' });
    const inv = await s.world.schedule({
      kind: 'invasion',
      startsAt: new Date(ev.startsAt),
      scheduledBy: '1',
    });
    expect(inv.ok).toBe(true);
    expect(
      await s.world.schedule({
        kind: 'raid',
        startsAt: new Date(t.clock.now().getTime() - HOUR),
        scheduledBy: '1',
      }),
    ).toEqual({
      ok: false,
      error: 'past',
    });
  });

  it('without J.A.R.V.I.S. events still run, no XP is requested and the results hide XP', async () => {
    t = await setupUltron({ jarvis: false });
    const ev = await raidIn2h(t);
    await addMember(t, '111');
    await at(t, ev.startsAt);
    await strike(t, '111', ev.id);
    await at(t, ev.endsAt);
    expect(await events(t, 'xp.grant_requested')).toEqual([]);
    expect(
      ultronMsgs(t)
        .at(-1)
        ?.msg.embeds?.[0]?.fields?.some((f) => f.name === 'XP'),
    ).toBe(false);
  });
});
