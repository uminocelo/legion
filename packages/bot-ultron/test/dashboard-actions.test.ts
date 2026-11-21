import type { ActionInput, TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ultronTables } from '../src/index.js';
import { servicesOf, setupUltron } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const STAFF = '999';
const run = (tc: TestContext, id: string, input: ActionInput = {}) => {
  const a = tc.runtime.dashboard.getAction('ultron', id);
  if (!a) throw new Error(`no action ${id}`);
  return a.run(input, { discordUserId: STAFF, name: 'Staff' });
};
const slash = async (tc: TestContext, subcommand: string, options: Record<string, unknown> = {}) =>
  tc.gateway.lastReply(
    await tc.interact({
      kind: 'command',
      userId: STAFF,
      isGuildOwner: true,
      commandName: 'ultron',
      subcommand,
      options,
    }),
  )?.content;
const boot = () => setupUltron({ config: { ultron: { invasion: { enabled: false } } } });

describe('ULTRON dashboard actions', () => {
  it('start and end war match /ultron guerra, refusals included', async () => {
    t = await boot();
    expect((await run(t, 'war-end')).message).toBe(await slash(t, 'guerra encerrar'));
    const started = await run(t, 'war-start');
    expect(started.ok).toBe(true);
    expect(started.message).toMatch(/<t:\d+:F>/);
    const again = await run(t, 'war-start');
    expect(again).toEqual({ ok: false, message: await slash(t, 'guerra iniciar') });
    const ended = await run(t, 'war-end');
    expect(ended.ok).toBe(true);
    expect(await servicesOf(t).warRepo.findStatus('active')).toBeNull();
  });

  it('schedule, start and cancel events match /ultron evento', async () => {
    t = await boot();
    const nothing = await run(t, 'event-cancel', { kind: null });
    expect(nothing).toEqual({ ok: false, message: await slash(t, 'evento cancelar') });

    const when = new Date(t.clock.now().getTime() + 2 * 86_400_000).toISOString();
    const scheduled = await run(t, 'event-schedule', { kind: 'raid', when });
    expect(scheduled.ok).toBe(true);
    const e = ultronTables(t.db).ultronWorldEvents;
    const [row] = await t.db.orm.select().from(e);
    expect(row).toMatchObject({ kind: 'raid', status: 'scheduled', startsAt: when, scheduledBy: STAFF });

    const cancelled = await run(t, 'event-cancel', { kind: 'raid' });
    expect(cancelled.ok).toBe(true);
    expect((await t.db.orm.select().from(e))[0]?.status).toBe('cancelled');

    const past = await run(t, 'event-schedule', {
      kind: 'raid',
      when: new Date(t.clock.now().getTime() - 3_600_000).toISOString(),
    });
    const slashPast = await slash(t, 'evento agendar', { tipo: 'raid', quando: '2020-01-01 10:00' });
    expect(past.ok).toBe(false);
    expect(past.message).toBe(slashPast);

    const now = await run(t, 'event-start', { kind: 'raid' });
    expect(now.ok).toBe(true);
    expect(now.message).toContain('#300000000000000012'.slice(1));
    expect((await t.db.orm.select().from(e)).some((x) => x.status === 'active')).toBe(true);
  });

  it('sets the threat meter within 0–100, and refuses when the meter is off', async () => {
    t = await boot();
    expect(await run(t, 'threat-set', { level: 80 })).toEqual({
      ok: true,
      message: 'Ameaça definida em 80 / 100.',
    });
    const th = ultronTables(t.db).ultronThreat;
    expect((await t.db.orm.select().from(th))[0]?.level).toBe(80);
    expect((await run(t, 'threat-set', { level: 101 })).ok).toBe(false);
    await t.close();
    t = await setupUltron({
      config: { ultron: { invasion: { enabled: false }, threat: { enabled: false } } },
    });
    expect((await run(t, 'threat-set', { level: 10 })).ok).toBe(false);
  });
});
