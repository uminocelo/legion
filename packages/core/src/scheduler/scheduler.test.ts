import { eq } from 'drizzle-orm';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { coreTables } from '../db/core-tables.js';
import { silentLogger } from '../silent-log.js';
import { createTestRuntime, type TestRuntime } from '../testing/runtime.js';
import { DbScheduler } from './scheduler.js';

let rt: TestRuntime;
afterEach(async () => rt?.close());

const jobs = async (r: TestRuntime) => {
  const t = coreTables(r.db).coreScheduledJobs;
  return r.db.orm.select().from(t);
};

describe('DbScheduler', () => {
  it('runs due jobs once and not future ones', async () => {
    rt = await createTestRuntime();
    const seen: unknown[] = [];
    rt.scheduler.define('t.job', async (p) => {
      seen.push(p);
    });
    await rt.scheduler.enqueue('t.job', { a: 1 });
    await rt.scheduler.enqueue('t.job', { a: 2 }, { runAt: new Date(rt.clock.now().getTime() + 60_000) });
    expect(await rt.scheduler.tick()).toBe(1);
    expect(await rt.scheduler.tick()).toBe(0);
    expect(seen).toEqual([{ a: 1 }]);
    rt.clock.advance(60_000);
    await rt.scheduler.tick();
    expect(seen).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('dedupes by key', async () => {
    rt = await createTestRuntime();
    rt.scheduler.define('t.job', async () => {});
    expect(await rt.scheduler.enqueue('t.job', null, { dedupeKey: 'k' })).not.toBeNull();
    expect(await rt.scheduler.enqueue('t.job', null, { dedupeKey: 'k' })).toBeNull();
  });

  it('two schedulers on the same DB claim a job only once', async () => {
    rt = await createTestRuntime();
    let runs = 0;
    const other = new DbScheduler({
      db: rt.db,
      clock: rt.clock,
      newId: rt.newId,
      log: silentLogger(),
      timezone: 'UTC',
    });
    for (const s of [rt.scheduler, other]) s.define('t.job', async () => void runs++);
    await rt.scheduler.enqueue('t.job', null);
    await Promise.all([rt.scheduler.tick(), other.tick()]);
    expect(runs).toBe(1);
  });

  it('retries with backoff, then marks failed', async () => {
    rt = await createTestRuntime();
    let calls = 0;
    rt.scheduler.define('t.fail', async () => {
      calls++;
      throw new Error('nope');
    });
    await rt.scheduler.enqueue('t.fail', null, { maxAttempts: 3 });
    await rt.scheduler.tick();
    expect(calls).toBe(1);
    await rt.scheduler.tick(); // backoff not elapsed
    expect(calls).toBe(1);
    rt.clock.advance(1_000);
    await rt.scheduler.tick();
    rt.clock.advance(5_000);
    await rt.scheduler.tick();
    expect(calls).toBe(3);
    const [job] = await jobs(rt);
    expect(job?.status).toBe('failed');
    expect(job?.lastError).toBe('nope');
  });

  it('returns crashed (lock expired) jobs to pending', async () => {
    rt = await createTestRuntime();
    let runs = 0;
    rt.scheduler.define('t.job', async () => void runs++);
    const id = (await rt.scheduler.enqueue('t.job', null)) ?? '';
    const t = coreTables(rt.db).coreScheduledJobs;
    const lockedUntil = new Date(rt.clock.now().getTime() + 300_000).toISOString();
    await rt.db.orm.update(t).set({ status: 'running', lockedUntil }).where(eq(t.id, id));
    await rt.scheduler.tick();
    expect(runs).toBe(0);
    rt.clock.advance(300_001);
    await rt.scheduler.tick();
    expect(runs).toBe(1);
  });

  it('cancels by dedupe key', async () => {
    rt = await createTestRuntime();
    let runs = 0;
    rt.scheduler.define('t.job', async () => void runs++);
    await rt.scheduler.enqueue('t.job', null, { dedupeKey: 'x' });
    expect(await rt.scheduler.cancel('x')).toBe(true);
    await rt.scheduler.tick();
    expect(runs).toBe(0);
  });

  it('recurring jobs run once per missed window and never double-schedule across restarts', async () => {
    rt = await createTestRuntime({ start: '2026-11-16T14:30:00.000Z' }); // 11:30 in São Paulo
    let runs = 0;
    rt.scheduler.every('t.daily', '0 12 * * *', async () => void runs++);
    await rt.scheduler.ensureRecurring();
    await rt.scheduler.ensureRecurring(); // "restart"
    let pending = (await jobs(rt)).filter((j) => j.status === 'pending');
    expect(pending.map((j) => j.runAt)).toEqual(['2026-11-16T15:00:00.000Z']);
    // Down for three days: the missed run happens once, then the next one is scheduled after now.
    rt.clock.set('2026-11-19T20:00:00.000Z');
    const restarted = new DbScheduler({
      db: rt.db,
      clock: rt.clock,
      newId: rt.newId,
      log: silentLogger(),
      timezone: 'America/Sao_Paulo',
    });
    restarted.every('t.daily', '0 12 * * *', async () => void runs++);
    await restarted.ensureRecurring();
    await restarted.tick();
    await restarted.tick();
    expect(runs).toBe(1);
    pending = (await jobs(rt)).filter((j) => j.status === 'pending');
    expect(pending.map((j) => j.runAt)).toEqual(['2026-11-20T15:00:00.000Z']);
  });

  it('cron next run respects the timezone (property)', async () => {
    rt = await createTestRuntime();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 365 * 86_400_000 }), (offset) => {
        const after = new Date(Date.UTC(2026, 0, 1) + offset);
        const next = rt.scheduler.nextRun('0 12 * * *', after);
        // 12:00 in São Paulo (UTC-3, no DST since 2019) is 15:00Z.
        return next > after && next.getUTCHours() === 15 && next.getTime() - after.getTime() <= 86_400_000;
      }),
    );
  });
});
