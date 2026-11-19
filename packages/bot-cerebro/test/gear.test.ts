import { computePlayerStats, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { CerebroFlow, cerebro } from '../src/index.js';
import { register, setupCerebro, USER } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function sheetStats(tc: TestContext) {
  const flow = new CerebroFlow(tc.ctxOf(cerebro));
  const member = await flow.repo.memberByDiscordId(USER);
  const mutant = member && (await flow.repo.mutantByMemberId(member.id));
  if (!member || !mutant) throw new Error('not registered');
  return (await flow.sheet.data(member, mutant)).stats;
}

describe('sheet stats with gear', () => {
  it('without a gear provider the sheet is as in v0.8.1', async () => {
    t = await setupCerebro();
    await register(t);
    expect(await sheetStats(t)).toEqual(computePlayerStats('Elemental', 1));
  });

  it('adds the capped gear bonus', async () => {
    t = await setupCerebro();
    await register(t);
    t.runtime.providers.provide(
      'gear',
      {
        bonusOf: async () => ({ hp: 30, atk: 1, def: 0, spd: 0, foc: 5 }),
        equippedOf: async () => [],
        statCap: () => 2,
      },
      'jarvis',
    );
    const base = computePlayerStats('Elemental', 1);
    expect(await sheetStats(t)).toEqual({ ...base, hp: base.hp + 16, atk: base.atk + 1, foc: base.foc + 2 });
  });
});
