import type { EventPayloads, TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { addMember, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const ended = (
  over: Partial<EventPayloads['war.ended']> & { winnerMemberIds: string[] },
): EventPayloads['war.ended'] => ({
  warId: '01JWAR00000000000000000001',
  startsAt: '2026-11-01T03:00:00.000Z',
  endsAt: '2026-12-01T03:00:00.000Z',
  winners: ['brotherhood', 'xmen'],
  scores: [
    { faction: 'brotherhood', points: 10, members: 1 },
    { faction: 'xmen', points: 10, members: 1 },
  ],
  ...over,
});

async function emitWar(tc: TestContext, payload: EventPayloads['war.ended']) {
  await tc.runtime.bus.forSource('ultron').emit(tc.db.orm, 'war.ended', payload);
  await tc.runtime.bus.drain();
}

describe('jarvis.war-credits', () => {
  it('pays every tied faction once, and a replay does not pay again', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const a = await addMember(t, '111');
    const b = await addMember(t, '222');
    const e = ended({ winnerMemberIds: [a, b, a] });
    await emitWar(t, e);
    await emitWar(t, e);
    expect([await s.wallet.balanceOf(a), await s.wallet.balanceOf(b)]).toEqual([50, 50]);
    expect(await s.wallet.history(a)).toMatchObject([
      { amount: 50, reason: 'war', note: 'brotherhood, xmen', sourceKey: `war:${e.warId}:${a}` },
    ]);
  });

  it('skips a member who left and pays nothing when nobody won or the economy is off', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const a = await addMember(t, '111');
    const gone = await addMember(t, '222');
    const { CerebroRepo } = await import('@legion/bot-cerebro');
    await new CerebroRepo(t.db, t.gateway.guildId, t.clock, t.runtime.newId).updateMember(gone, {
      leftAt: t.clock.now().toISOString(),
    });
    await emitWar(t, ended({ winnerMemberIds: [] }));
    expect(await s.wallet.balanceOf(a)).toBe(0);
    await emitWar(t, ended({ winnerMemberIds: [a, gone, '01JNOBODY00000000000000000'] }));
    expect([await s.wallet.balanceOf(a), await s.wallet.balanceOf(gone)]).toEqual([50, 0]);
    await t.close();

    t = await setupJarvis({ jarvis: { economy: { enabled: false } } });
    const c = await addMember(t, '111');
    await emitWar(t, ended({ winnerMemberIds: [c] }));
    expect(await servicesOf(t).wallet.balanceOf(c)).toBe(0);

    await t.close();
    t = await setupJarvis({ jarvis: { economy: { war: { winner: 0 } } } });
    const d = await addMember(t, '111');
    await emitWar(t, ended({ winnerMemberIds: [d] }));
    expect(await servicesOf(t).wallet.balanceOf(d)).toBe(0);
  });
});
