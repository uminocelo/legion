import type { EventPayloads, TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { addMember, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const ended = (
  over: Partial<EventPayloads['world.event']> & { participantMemberIds: string[] },
): EventPayloads['world.event'] => ({
  worldEventId: '01JWORLDEVENT0000000000001',
  kind: 'raid',
  phase: 'ended',
  title: 'Raid: Bastião Prime',
  startsAt: '2026-11-19T12:00:00.000Z',
  endsAt: '2026-11-19T13:00:00.000Z',
  outcome: 'victory',
  ...over,
});
async function emitWorld(tc: TestContext, payload: EventPayloads['world.event']) {
  await tc.runtime.bus.forSource('ultron').emit(tc.db.orm, 'world.event', payload);
  await tc.runtime.bus.drain();
}

describe('jarvis.world-credits', () => {
  it('pays victory to each participant once, even when the event is delivered twice', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const a = await addMember(t, '111');
    const b = await addMember(t, '222');
    const e = ended({ participantMemberIds: [a, b, a] });
    await emitWorld(t, e);
    await emitWorld(t, e);
    expect([await s.wallet.balanceOf(a), await s.wallet.balanceOf(b)]).toEqual([30, 30]);
    expect(await s.wallet.history(a)).toMatchObject([
      {
        amount: 30,
        reason: 'world_event',
        note: 'Raid: Bastião Prime',
        sourceKey: `world:${e.worldEventId}:${a}`,
      },
    ]);
  });

  it('a defeat pays participation; announced, started and cancelled events pay nothing', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const a = await addMember(t, '111');
    await emitWorld(
      t,
      ended({ worldEventId: '01JWORLDEVENT0000000000002', phase: 'started', participantMemberIds: [a] }),
    );
    await emitWorld(
      t,
      ended({ worldEventId: '01JWORLDEVENT0000000000003', outcome: null, participantMemberIds: [a] }),
    );
    expect(await s.wallet.balanceOf(a)).toBe(0);
    await emitWorld(
      t,
      ended({ worldEventId: '01JWORLDEVENT0000000000004', outcome: 'defeat', participantMemberIds: [a] }),
    );
    expect(await s.wallet.balanceOf(a)).toBe(10);
  });

  it('skips unknown members and members who left; economy off pays nobody', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const a = await addMember(t, '111');
    const gone = await addMember(t, '222');
    const { CerebroRepo } = await import('@legion/bot-cerebro');
    await new CerebroRepo(t.db, t.gateway.guildId, t.clock, t.runtime.newId).updateMember(gone, {
      leftAt: t.clock.now().toISOString(),
    });
    await emitWorld(t, ended({ participantMemberIds: [a, gone, '01JNOBODY00000000000000000'] }));
    expect([await s.wallet.balanceOf(a), await s.wallet.balanceOf(gone)]).toEqual([30, 0]);
    await t.close();

    t = await setupJarvis({ jarvis: { economy: { enabled: false } } });
    const c = await addMember(t, '111');
    await emitWorld(t, ended({ participantMemberIds: [c] }));
    expect(await servicesOf(t).wallet.balanceOf(c)).toBe(0);
  });
});
