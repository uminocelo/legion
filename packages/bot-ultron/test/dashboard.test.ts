import { cerebro } from '@legion/bot-cerebro';
import { jarvis } from '@legion/bot-jarvis';
import { sentinel } from '@legion/bot-sentinel';
import { createTestContext, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ultronTables } from '../src/index.js';
import { addMember, servicesOf, setupUltron } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const panel = async (tc: TestContext, id: string) => {
  const p = tc.runtime.dashboard.get('ultron', id);
  if (!p) throw new Error(`no panel ${id}`);
  return p.render();
};
const rowsOf = async (tc: TestContext, id: string) => {
  const v = await panel(tc, id);
  if (v.kind !== 'table') throw new Error('not a table');
  return v.rows;
};

describe('ULTRON dashboard panels', () => {
  it('lists upcoming, active and recent events, but not old ones', async () => {
    t = await setupUltron({ config: { ultron: { invasion: { enabled: false } } } });
    const e = ultronTables(t.db).ultronWorldEvents;
    const now = t.clock.now().getTime();
    const at = (h: number) => new Date(now + h * 3_600_000).toISOString();
    const base = {
      guildId: t.gateway.guildId,
      templateId: 'x',
      scheduledBy: 'cron',
      difficulty: 'normal',
      createdAt: at(0),
      updatedAt: at(0),
    };
    await t.db.orm.insert(e).values([
      {
        ...base,
        id: 'up',
        kind: 'invasion',
        status: 'scheduled',
        announceAt: at(1),
        startsAt: at(2),
        endsAt: at(3),
        waves: 2,
      },
      {
        ...base,
        id: 'live',
        kind: 'raid',
        status: 'active',
        announceAt: at(-2),
        startsAt: at(-1),
        endsAt: at(1),
        maxHp: 1000,
        hp: 400,
      },
      {
        ...base,
        id: 'done',
        kind: 'invasion',
        status: 'ended',
        outcome: 'victory',
        announceAt: at(-50),
        startsAt: at(-49),
        endsAt: at(-48),
      },
      {
        ...base,
        id: 'old',
        kind: 'raid',
        status: 'ended',
        outcome: 'defeat',
        announceAt: at(-400),
        startsAt: at(-399),
        endsAt: at(-398),
      },
    ]);
    const rows = await rowsOf(t, 'events');
    expect(rows.map((r) => [r[0], r[1], r[4], r[5], r[6]])).toEqual([
      ['Invasão', 'agendado', '—', '1 / 2', '—'],
      ['Raid', 'em andamento', '400 / 1000', '1 / 1', '—'],
      ['Invasão', 'encerrado', '—', '1 / 1', 'vitória'],
    ]);
  });

  it('shows the active war scoreboard and the war history', async () => {
    t = await setupUltron({ config: { ultron: { invasion: { enabled: false } } } });
    const s = servicesOf(t);
    expect(await panel(t, 'war')).toMatchObject({ kind: 'stats' }); // no war yet
    const a = await addMember(t, '111', 'xmen');
    const b = await addMember(t, '222', 'independent');
    await s.war.staffStart();
    const war = await s.warRepo.findStatus('active');
    expect(war).not.toBeNull();
    await s.warRepo.addPoint({
      warId: war?.id ?? '',
      memberId: a,
      faction: 'xmen',
      points: 30,
      reason: 'mission',
      sourceKey: 'k1',
    });
    await s.warRepo.addPoint({
      warId: war?.id ?? '',
      memberId: b,
      faction: 'independent',
      points: 10,
      reason: 'strike',
      sourceKey: 'k2',
    });
    const live = await rowsOf(t, 'war');
    expect(String(live[0]?.[0])).toContain('Guerra em andamento');
    expect(live[1]?.[0]).toContain('X-Men');
    expect(live.slice(1).map((r) => r[0])).toHaveLength(2);
    expect(live[1]?.[1]).toBeGreaterThanOrEqual(live[2]?.[1] as number);

    await s.war.staffEnd();
    const history = await rowsOf(t, 'war-history');
    expect(history).toHaveLength(1);
    expect(history[0]?.[2]).toContain('X-Men');
    expect(String((await rowsOf(t, 'war'))[0]?.[0])).toContain('Última guerra');
  });

  it('shows the threat level, band and next invasion size', async () => {
    t = await setupUltron({ config: { ultron: { invasion: { enabled: false } } } });
    const th = ultronTables(t.db).ultronThreat;
    await t.db.orm.insert(th).values({
      guildId: t.gateway.guildId,
      level: 70,
      lastTickDay: null,
      updatedAt: t.clock.now().toISOString(),
    });
    expect(await panel(t, 'threat')).toEqual({
      kind: 'stats',
      items: [
        { labelKey: 'ultron.dashboard.threat_level', value: '70 / 100' },
        { labelKey: 'ultron.dashboard.threat_band', value: 'alta' },
        { labelKey: 'ultron.dashboard.next_waves', value: 3 },
        { labelKey: 'ultron.dashboard.next_difficulty', value: 'dificil' },
      ],
    });
  });

  it('registers nothing when ULTRON is disabled', async () => {
    t = await createTestContext({ bots: [cerebro, jarvis, sentinel] });
    expect(t.runtime.dashboard.list().map((p) => `${p.bot}/${p.id}`)).toEqual([
      'core/members',
      'cerebro/squads',
      'jarvis/economy',
      'jarvis/top-balances',
      'jarvis/purchases',
    ]);
  });
});
