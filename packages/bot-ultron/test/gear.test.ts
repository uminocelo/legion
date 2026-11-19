import { computePlayerStats, type StatBonus, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { strikeId } from '../src/index.js';
import { addMember, CH, emit, events, servicesOf, setupUltron } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const BONUS: StatBonus = { hp: 24, atk: 1, def: 3, spd: 0, foc: 0 };
const fakeGear = (tc: TestContext, of: string) =>
  tc.runtime.providers.provide(
    'gear',
    {
      bonusOf: async (id) => (id === of ? BONUS : { hp: 0, atk: 0, def: 0, spd: 0, foc: 0 }),
      equippedOf: async () => [],
      statCap: () => 2,
    },
    'jarvis',
  );
const geared = (level: number) => {
  const b = computePlayerStats('Elemental', level);
  return { ...b, hp: b.hp + 16, atk: b.atk + 1, def: b.def + 2 };
};

async function missionPlayers(tc: TestContext, memberIds: string[]) {
  await emit(tc, 'mission.started', {
    missionId: 'm-gear',
    missionType: 'combat',
    memberIds,
    partyLevel: 1,
    difficulty: 'normal',
    channelId: CH.combat,
  });
  const req = (await events(tc, 'combat.requested')).find((r) => r.missionId === 'm-gear');
  return new Map(req?.participants.filter((p) => p.side === 'players').map((p) => [p.refId, p.stats]));
}

async function strikeStats(tc: TestContext, user: string) {
  const s = servicesOf(tc);
  const r = await s.world.schedule({
    kind: 'raid',
    startsAt: new Date(tc.clock.now().getTime() + 7_200_000),
    scheduledBy: '1',
  });
  if (!r.ok) throw new Error(r.error);
  tc.clock.set(new Date(r.event.startsAt));
  await tc.settle();
  await tc.settle();
  await tc.interact({ kind: 'component', userId: user, customId: strikeId(r.event.id) });
  await tc.settle();
  const req = (await events(tc, 'combat.requested')).find(
    (x) => x.raidId === r.event.id || x.mode === 'raid_strike',
  );
  return req?.participants.find((p) => p.side === 'players')?.stats;
}

describe('ULTRON fights with gear', () => {
  it('mission fight: each player gets their own capped bonus', async () => {
    t = await setupUltron({ jarvis: false });
    const a = await addMember(t, '111');
    const b = await addMember(t, '222');
    fakeGear(t, a);
    const players = await missionPlayers(t, [a, b]);
    expect(players.get(a)).toEqual(geared(1));
    expect(players.get(b)).toEqual(computePlayerStats('Elemental', 1));
  });

  it('mission fight without a gear provider is as in v0.8.1', async () => {
    t = await setupUltron({ jarvis: false });
    const a = await addMember(t, '111');
    expect((await missionPlayers(t, [a])).get(a)).toEqual(computePlayerStats('Elemental', 1));
  });

  it('raid strike: the snapshot carries the capped bonus', async () => {
    t = await setupUltron({ jarvis: false });
    const a = await addMember(t, '111');
    fakeGear(t, a);
    expect(await strikeStats(t, '111')).toEqual(geared(1));
  });

  it('raid strike without a gear provider is as in v0.8.1', async () => {
    t = await setupUltron({ jarvis: false });
    await addMember(t, '111');
    expect(await strikeStats(t, '111')).toEqual(computePlayerStats('Elemental', 1));
  });
});
