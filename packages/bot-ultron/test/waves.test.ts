import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { EventsRepo, playerCombatantId, ultron, WorldEventService } from '../src/index.js';
import { addMember, CH, events, servicesOf, setupUltron } from './helpers.js';

let t: TestContext;
afterEach(async () => t?.close());

const HOUR = 3_600_000;
const at = async (tc: TestContext, iso: string) => {
  tc.clock.set(new Date(iso));
  await tc.settle();
  await tc.settle();
};
const ultronMsgs = (tc: TestContext) => tc.gateway.messages.filter((m) => m.channelId === CH.events);

/** Invasion with fixed waves and tiny HP (10, 13, 16) so tests control every hit. */
async function invasion(waves: number | 'threat' = 3, extra: Record<string, unknown> = {}) {
  t = await setupUltron({
    config: {
      ultron: {
        events: { hpPerParticipant: 10, expectedParticipants: 1, bossLevel: 5 },
        invasion: { waves },
        ...extra,
      },
    },
  });
  const s = servicesOf(t);
  const r = await s.world.schedule({
    kind: 'invasion',
    startsAt: new Date(t.clock.now().getTime() + 2 * HOUR),
    scheduledBy: '1',
  });
  if (!r.ok) throw new Error(r.error);
  return { s, ev: r.event };
}

let n = 0;
/** A strike Sentinel has resolved with exactly `damage`. Sent before `resolve` is awaited. */
async function startHit(world: WorldEventService, repo: EventsRepo, eventId: string, memberId: string) {
  const combatId = `c-${++n}`;
  await t.db.transaction((tx) =>
    repo.startStrike(
      { eventId, memberId, faction: 'xmen', combatId, nextStrikeAt: t.clock.now().toISOString() },
      tx,
    ),
  );
  return (damage: number) =>
    world.onStrikeResolved({
      id: `e-${combatId}`,
      type: 'combat.resolved',
      source: 'sentinel',
      payload: {
        combatId,
        requestedBy: 'ultron',
        mode: 'raid_strike',
        missionId: null,
        raidId: eventId,
        seed: 1,
        winnerSide: 'players',
        rounds: 1,
        damageBySide: { players: damage, enemies: 0 },
        survivors: [playerCombatantId(memberId)],
        logHash: 'x',
      },
    } as never);
}

describe('multi-wave invasions', () => {
  it('clears every wave in the same message: +25% HP, boss +1 level, results list each wave', async () => {
    const { s, ev } = await invasion(3);
    const a = await addMember(t, '111');
    await at(t, ev.startsAt);
    expect(await s.eventsRepo.event(ev.id)).toMatchObject({ waves: 3, wave: 1, maxHp: 10, bossLevel: 5 });
    const started = (await events(t, 'world.event')).find((e) => e.phase === 'started');
    expect(started).toMatchObject({ wave: 1, waves: 3 });

    const hit = (d: number) => startHit(s.world, s.eventsRepo, ev.id, a).then((go) => go(d));
    await hit(10);
    expect(await s.eventsRepo.event(ev.id)).toMatchObject({
      status: 'active',
      wave: 2,
      maxHp: 13,
      hp: 13,
      bossLevel: 6,
    });
    // The new wave shows at once in the same event message (no new post).
    const edited = t.gateway.callsOf('editMessage').at(-1)?.[2] as {
      embeds: { fields: { name: string }[] }[];
    };
    expect(edited.embeds[0]?.fields[0]?.name).toBe('HP · Onda 2/3');
    expect(
      await s.eventsRepo
        .event(ev.id)
        .then((e) => (e ? s.world.bossSnapshot(e) : null))
        .then((b) => b?.level),
    ).toBe(6);

    await hit(13);
    expect(await s.eventsRepo.event(ev.id)).toMatchObject({ wave: 3, maxHp: 16, bossLevel: 7 });
    await hit(20);
    expect(await s.eventsRepo.event(ev.id)).toMatchObject({ status: 'ended', outcome: 'victory', hp: 0 });

    expect((await s.eventsRepo.waves(ev.id)).map((w) => [w.wave, w.maxHp, w.bossLevel, w.outcome])).toEqual([
      [1, 10, 5, 'cleared'],
      [2, 13, 6, 'cleared'],
      [3, 16, 7, 'cleared'],
    ]);
    expect((await s.eventsRepo.waveDamage(ev.id)).map((d) => [d.wave, d.damage])).toEqual([
      [1, 10],
      [2, 13],
      [3, 20],
    ]);
    const ended = (await events(t, 'world.event')).filter((e) => e.phase === 'ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ outcome: 'victory', wave: 3, waves: 3 });
    expect(ultronMsgs(t)).toHaveLength(3);
    const results = ultronMsgs(t)[2]?.msg.embeds?.[0];
    expect(results?.fields?.find((f) => f.name === 'Dano total')?.value).toBe('43 / 39');
    expect(results?.fields?.find((f) => f.name === 'Ondas')?.value).toMatch(
      /^✅ Onda 1 · limpa em 1 min · <@111> · 10\n✅ Onda 2 · limpa em 1 min · <@111> · 13\n✅ Onda 3 · limpa em 1 min · <@111> · 20$/,
    );
  });

  it('time out mid-way: defeat, cleared waves kept, current wave failed, the rest not reached', async () => {
    const { s, ev } = await invasion(3);
    const a = await addMember(t, '111');
    await at(t, ev.startsAt);
    t.clock.advance(5 * 60_000);
    await (await startHit(s.world, s.eventsRepo, ev.id, a))(10);
    await at(t, ev.endsAt);
    expect(await s.eventsRepo.event(ev.id)).toMatchObject({ status: 'ended', outcome: 'defeat', wave: 2 });
    expect((await s.eventsRepo.waves(ev.id)).map((w) => [w.wave, w.outcome])).toEqual([
      [1, 'cleared'],
      [2, 'failed'],
    ]);
    const results = ultronMsgs(t).at(-1)?.msg.embeds?.[0];
    expect(results?.title).toMatch(/Derrota$/);
    expect(results?.fields?.find((f) => f.name === 'Ondas')?.value).toBe(
      [
        '✅ Onda 1 · limpa em 5 min · <@111> · 10',
        '❌ Onda 2 · falhou após 55 min · —',
        '▫️ Onda 3 · não alcançada',
      ].join('\n'),
    );
  });

  it('concurrent final strikes move the wave once; a strike begun on wave 1 lands on wave 2', async () => {
    const { s, ev } = await invasion(3);
    const a = await addMember(t, '111');
    const b = await addMember(t, '222');
    const c = await addMember(t, '333');
    await at(t, ev.startsAt);
    const first = await startHit(s.world, s.eventsRepo, ev.id, a);
    const second = await startHit(s.world, s.eventsRepo, ev.id, b);
    const late = await startHit(s.world, s.eventsRepo, ev.id, c); // fight began on wave 1
    await Promise.all([first(10), second(10)]);
    expect(await s.eventsRepo.event(ev.id)).toMatchObject({ status: 'active', wave: 2, hp: 3 });
    expect(await s.eventsRepo.waves(ev.id)).toHaveLength(2);
    await late(1);
    expect((await s.eventsRepo.event(ev.id))?.hp).toBe(2);
    const byWave = (await s.eventsRepo.waveDamage(ev.id)).map((d) => [d.wave, d.damage]);
    expect(byWave.sort()).toEqual([
      [1, 10],
      [2, 1],
      [2, 10],
    ]);
  });

  it('a restart between waves resumes at the stored wave and HP', async () => {
    const { s, ev } = await invasion(2);
    const a = await addMember(t, '111');
    await at(t, ev.startsAt);
    await (await startHit(s.world, s.eventsRepo, ev.id, a))(10);
    // A fresh service (as after a restart): no state lives in memory.
    const ctx = t.ctxOf(ultron);
    const repo = new EventsRepo(t.db, t.gateway.guildId, t.clock);
    const world = new WorldEventService(ctx, repo, s.repo, s.flavor);
    await world.start(ev.id); // the start job retried: no-op
    expect(await repo.event(ev.id)).toMatchObject({ status: 'active', wave: 2, hp: 13 });
    await (await startHit(world, repo, ev.id, a))(13);
    expect(await repo.event(ev.id)).toMatchObject({ status: 'ended', outcome: 'victory', wave: 2 });
    expect((await repo.waves(ev.id)).map((w) => w.outcome)).toEqual(['cleared', 'cleared']);
  });

  it('raids and single-wave invasions stay one wave with the old results', async () => {
    const { s } = await invasion(3);
    const raid = await s.world.schedule({
      kind: 'raid',
      startsAt: new Date(t.clock.now().getTime() + 2 * HOUR),
      scheduledBy: '1',
    });
    if (!raid.ok) throw new Error(raid.error);
    await at(t, raid.event.endsAt);
    expect(await s.eventsRepo.event(raid.event.id)).toMatchObject({ waves: 1, wave: 1, outcome: 'defeat' });
    const results = ultronMsgs(t).find((m) => m.msg.embeds?.[0]?.title?.startsWith('💀 Raid'))?.msg;
    expect(results?.embeds?.[0]?.fields?.some((f) => f.name === 'Ondas')).toBe(false);
  });
});
