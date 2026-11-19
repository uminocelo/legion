import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { addMember, emit, servicesOf, setupUltron } from './helpers.js';

let t: TestContext;
afterEach(async () => t?.close());

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const level = async () => (await servicesOf(t).eventsRepo.threat())?.level;
const setLevel = async (n: number) => {
  const repo = servicesOf(t).eventsRepo;
  const row = await repo.threat();
  await repo.saveThreat({
    level: n,
    lastTickDay: row?.lastTickDay ?? '2026-11-15',
    seen: row ? row.lastTickDay : undefined,
  });
};
let run = 0;
const missions = async (count: number, outcome: 'success' | 'failure' | 'abandoned' = 'success') => {
  for (let k = 0; k < count; k++)
    await emit(t, 'mission.completed', { missionId: 'm', runId: `r-${++run}`, memberIds: [], outcome });
};
const ameaca = async (user = '111') =>
  t.gateway.lastReply(await t.interact({ kind: 'command', userId: user, commandName: 'ameaca' }));

describe('threat meter', () => {
  it('starts at 0, rises on a quiet day, falls on an active one and a second run changes nothing', async () => {
    t = await setupUltron(); // Monday 2026-11-16, 12:00 in São Paulo
    const threat = servicesOf(t).threat;
    await threat.tick(); // first run (also done on boot): starts the meter
    expect(await servicesOf(t).eventsRepo.threat()).toMatchObject({ level: 0, lastTickDay: '2026-11-15' });

    await missions(5, 'abandoned'); // abandoned runs are not activity
    await missions(2, 'failure');
    t.clock.advance(DAY);
    expect(await threat.tick()).toBe(1);
    expect(await level()).toBe(10);
    expect(await threat.tick()).toBe(0);
    expect(await level()).toBe(10);

    await missions(3);
    t.clock.advance(DAY);
    expect(await threat.tick()).toBe(1);
    expect(await level()).toBe(5);
  });

  it('counts strikes as activity and catches up at most 7 missed days', async () => {
    t = await setupUltron();
    const s = servicesOf(t);
    await s.threat.tick();
    const a = await addMember(t, '111');
    const ev = await s.world.schedule({
      kind: 'raid',
      startsAt: new Date(t.clock.now().getTime() + HOUR),
      scheduledBy: '1',
    });
    if (!ev.ok) throw new Error(ev.error);
    for (let k = 0; k < 3; k++)
      await t.db.transaction((tx) =>
        s.eventsRepo.startStrike(
          {
            eventId: ev.event.id,
            memberId: a,
            faction: 'xmen',
            combatId: `k-${k}`,
            nextStrikeAt: t.clock.now().toISOString(),
          },
          tx,
        ),
      );
    await setLevel(50);
    t.clock.advance(DAY);
    expect(await s.threat.tick()).toBe(1);
    expect(await level()).toBe(45);

    // Down for 12 days: only the last 7 count (45 + 70, capped at 100).
    t.clock.advance(12 * DAY);
    expect(await s.threat.tick()).toBe(7);
    expect(await level()).toBe(100);
    expect((await s.eventsRepo.threat())?.lastTickDay).toBe('2026-11-28');
  });

  it('sizes invasions from the threat: 1 wave normal, 2 waves normal, 3 waves difícil', async () => {
    t = await setupUltron({
      config: { ultron: { events: { hpPerParticipant: 100, expectedParticipants: 1, difficulty: 'facil' } } },
    });
    const s = servicesOf(t);
    await s.threat.tick();
    const cases: [number, number, string, number][] = [
      [33, 1, 'normal', 100],
      [34, 2, 'normal', 100],
      [67, 3, 'dificil', 125],
    ];
    for (const [lvl, waves, difficulty, maxHp] of cases) {
      await setLevel(lvl);
      const r = await s.world.schedule({
        kind: 'invasion',
        startsAt: new Date(t.clock.now().getTime() + HOUR),
        scheduledBy: '1',
      });
      if (!r.ok) throw new Error(r.error);
      t.clock.set(new Date(r.event.startsAt));
      await s.world.start(r.event.id);
      expect(await s.eventsRepo.event(r.event.id)).toMatchObject({ waves, difficulty, maxHp });
      await s.world.cancel(r.event.id);
    }
  });

  it('/ameaca shows the meter even with no event, in both locales', async () => {
    t = await setupUltron({ config: { ultron: { events: { difficulty: 'facil' } } } });
    await servicesOf(t).threat.tick();
    await setLevel(70);
    const pt = (await ameaca())?.embeds?.[0];
    expect(pt?.title).toBe('☢️ Ameaça');
    expect(pt?.fields?.[0]).toEqual({
      name: 'Ameaça',
      value: [
        '`████████░░░░ 70%` 70 / 100 · alta',
        'Próxima invasão: 3 ondas, dificuldade Difícil.',
        'Dias quietos aumentam a ameaça; missões e ataques a reduzem.',
      ].join('\n'),
    });
    await t.close();

    t = await setupUltron({ config: { locale: 'en' } });
    await servicesOf(t).threat.tick();
    const en = (await ameaca())?.embeds?.[0];
    expect(en?.fields?.[0]?.name).toBe('Threat');
    expect(en?.fields?.[0]?.value).toMatch(/0 \/ 100 · low\nNext invasion: 1 wave, Normal difficulty\./);
  });

  it('threat.enabled: false — no ticks, one-wave invasions and no field on /ameaca', async () => {
    t = await setupUltron({ config: { ultron: { threat: { enabled: false } } } });
    const s = servicesOf(t);
    t.clock.advance(3 * DAY);
    expect(await s.threat.tick()).toBe(0);
    expect(await s.eventsRepo.threat()).toBeNull();
    expect((await ameaca())?.content).toBe('Nenhuma ameaça no radar. Por enquanto.');
    const r = await s.world.schedule({
      kind: 'invasion',
      startsAt: new Date(t.clock.now().getTime() + HOUR),
      scheduledBy: '1',
    });
    if (!r.ok) throw new Error(r.error);
    t.clock.set(new Date(r.event.startsAt));
    await s.world.start(r.event.id);
    expect(await s.eventsRepo.event(r.event.id)).toMatchObject({ waves: 1, difficulty: 'normal' });
  });
});
