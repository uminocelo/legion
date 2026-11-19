import { computePlayerStats, type StatBonus, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { addMember, events, setupSentinel } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const fakeGear = (tc: TestContext, bonus: StatBonus, cap = 2) =>
  tc.runtime.providers.provide(
    'gear',
    { bonusOf: async () => bonus, equippedOf: async () => [], statCap: () => cap },
    'jarvis',
  );

async function trainingPlayerStats(tc: TestContext) {
  await addMember(tc, '111');
  await tc.interact({ kind: 'command', userId: '111', commandName: 'treino' });
  await tc.settle();
  const req = (await events(tc, 'combat.requested'))[0];
  return req?.participants.find((p) => p.kind === 'player')?.stats;
}

describe('training with gear', () => {
  it('without a gear provider the snapshot is as in v0.8.1', async () => {
    t = await setupSentinel({ jarvis: false });
    expect(await trainingPlayerStats(t)).toEqual(computePlayerStats('Elemental', 1));
  });

  it('the combat.requested snapshot carries the capped bonus', async () => {
    t = await setupSentinel({ jarvis: false });
    fakeGear(t, { hp: 8, atk: 4, def: 0, spd: 1, foc: 0 });
    const base = computePlayerStats('Elemental', 1);
    expect(await trainingPlayerStats(t)).toEqual({
      ...base,
      hp: base.hp + 8,
      atk: base.atk + 2,
      spd: base.spd + 1,
    });
  });

  it('statCap 0 leaves the stats unchanged', async () => {
    t = await setupSentinel({ jarvis: false });
    fakeGear(t, { hp: 16, atk: 2, def: 2, spd: 2, foc: 2 }, 0);
    expect(await trainingPlayerStats(t)).toEqual(computePlayerStats('Elemental', 1));
  });
});
