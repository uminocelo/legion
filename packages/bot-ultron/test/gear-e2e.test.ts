import { jarvis, jarvisServices } from '@legion/bot-jarvis';
import { computePlayerStats, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { addMember, CH, emit, events, setupUltron } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const STAFF = { userId: '999', isGuildOwner: true };

async function missionStats(tc: TestContext, missionId: string, memberId: string) {
  await emit(tc, 'mission.started', {
    missionId,
    missionType: 'combat',
    memberIds: [memberId],
    partyLevel: 7,
    difficulty: 'normal',
    channelId: CH.combat,
  });
  const req = (await events(tc, 'combat.requested')).find((r) => r.missionId === missionId);
  return req?.participants.find((p) => p.refId === memberId)?.stats;
}

describe('gear end to end (Cérebro, J.A.R.V.I.S., Sentinel, ULTRON)', () => {
  it('staff grant → player equips → the mission fight has the capped bonus; disable → the next fight has none', async () => {
    t = await setupUltron();
    t.gateway.addMember({ userId: '999' });
    const m = await addMember(t, '111');
    const s = jarvisServices(t.ctxOf(jarvis));
    await t.runtime.bus
      .forSource('jarvis')
      .transaction((tx) =>
        s.xp.award(tx, { memberId: m, amount: 1800, reason: 'grant', sourceKey: 'e2e:lvl' }),
      );
    await t.runtime.bus.drain(); // level 7

    for (const item of ['traje-tatico', 'gerador-de-escudo']) {
      const id = await t.interact({
        kind: 'command',
        ...STAFF,
        commandName: 'jarvis',
        subcommand: 'item dar',
        options: { membro: '111', item },
      });
      expect(t.gateway.lastReply(id)?.content).toMatch(/^🎁/);
    }
    for (const [slot, item] of [
      ['traje', 'traje-tatico'],
      ['dispositivo', 'gerador-de-escudo'],
    ] as const) {
      const id = await t.interact({
        kind: 'component',
        userId: '111',
        customId: `jarvis:v1:inv:equip:${slot}:111`,
        values: [item],
      });
      expect(t.gateway.lastReply(id)?.content).toMatch(/^✅/);
    }

    // traje-tatico (def 1, hp 8) + gerador-de-escudo (def 1, hp 16): hp 24 is capped at 16.
    const base = computePlayerStats('Elemental', 7);
    expect(await missionStats(t, 'm-gear-1', m)).toEqual({ ...base, def: base.def + 2, hp: base.hp + 16 });

    // Staff turn the shield generator off: unequipped, still owned, no bonus next fight.
    expect(await s.inventory.deactivate('gerador-de-escudo', '999')).toBe(1);
    expect((await s.inventory.owned(m)).map((r) => r.itemId).sort()).toEqual([
      'gerador-de-escudo',
      'traje-tatico',
    ]);
    expect(await missionStats(t, 'm-gear-2', m)).toEqual({ ...base, def: base.def + 1, hp: base.hp + 8 });
    await s.inventory.deactivate('traje-tatico', '999');
    expect(await missionStats(t, 'm-gear-3', m)).toEqual(base);
  });
});
