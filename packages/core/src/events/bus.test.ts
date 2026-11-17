import { afterEach, describe, expect, it } from 'vitest';
import { coreTables } from '../db/core-tables.js';
import { DbScheduler } from '../scheduler/scheduler.js';
import { silentLogger } from '../silent-log.js';
import { createTestRuntime, type TestRuntime } from '../testing/runtime.js';
import { InProcessEventBus, MAX_EVENT_RETRIES } from './bus.js';
import type { LegionEvent } from './catalog.js';

let rt: TestRuntime;
afterEach(async () => rt?.close());

const optIns = (memberId: string) => ({ memberId, optIns: ['live_ping'] });

describe('event catalog validation', () => {
  it('rejects unknown types and invalid payloads at emit time', async () => {
    rt = await createTestRuntime();
    // @ts-expect-error unknown type
    await expect(rt.bus.emit(rt.db.orm, 'nope.event', {})).rejects.toThrow(/Unknown event type/);
    // @ts-expect-error invalid payload
    await expect(rt.bus.emit(rt.db.orm, 'xp.grant_requested', { memberId: 'm', amount: 0 })).rejects.toThrow(
      /Invalid payload/,
    );
  });
});

describe('InProcessEventBus', () => {
  it('dispatches after commit, stamps the source and records consumption', async () => {
    rt = await createTestRuntime();
    const seen: LegionEvent[] = [];
    rt.bus.on('player.optins_changed', 'test.a', async (e) => void seen.push(e));
    const cerebro = rt.bus.forSource('cerebro');
    await cerebro.transaction(async (tx) => {
      await cerebro.emit(tx, 'player.optins_changed', optIns('m1'));
      expect(seen).toHaveLength(0); // not before commit
    });
    await rt.bus.drain();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.source).toBe('cerebro');
    expect(seen[0]?.version).toBe(1);
    const cons = await rt.db.orm.select().from(coreTables(rt.db).coreEventConsumption);
    expect(cons).toMatchObject([{ consumerId: 'test.a', status: 'done', attempts: 1 }]);
  });

  it('never dispatches or logs an event from a rolled-back transaction', async () => {
    rt = await createTestRuntime();
    const seen: unknown[] = [];
    rt.bus.on('player.optins_changed', 'test.a', async (e) => void seen.push(e));
    await expect(
      rt.bus.transaction(async (tx) => {
        await rt.bus.emit(tx, 'player.optins_changed', optIns('m1'));
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await rt.bus.drain();
    expect(seen).toHaveLength(0);
    expect(await rt.db.orm.select().from(coreTables(rt.db).coreEventLog)).toHaveLength(0);
  });

  it('refuses a foreign transaction handle', async () => {
    rt = await createTestRuntime();
    await expect(
      rt.db.transaction((tx) => rt.bus.emit(tx, 'player.optins_changed', optIns('m1'))),
    ).rejects.toThrow(/bus.transaction/);
  });

  it('replays unconsumed events oldest first on startup, once', async () => {
    rt = await createTestRuntime();
    // A previous boot already knew the consumer.
    rt.bus.on('player.optins_changed', 'test.late', async () => {
      throw new Error('process died before handling');
    });
    await rt.bus.replayPending();
    const t = coreTables(rt.db).coreEventConsumption;
    // Events logged while nobody was subscribed (e.g. the process died before dispatch).
    await rt.bus.emit(rt.db.orm, 'player.optins_changed', optIns('m1'));
    rt.clock.advance(1000);
    await rt.bus.emit(rt.db.orm, 'player.optins_changed', optIns('m2'));
    await rt.bus.drain();
    await rt.db.orm.delete(t); // as if the process died before recording anything

    const scheduler = new DbScheduler({
      db: rt.db,
      clock: rt.clock,
      newId: rt.newId,
      log: silentLogger(),
      timezone: 'UTC',
    });
    const restarted = new InProcessEventBus({
      db: rt.db,
      scheduler,
      clock: rt.clock,
      newId: rt.newId,
      guildId: 'g',
      log: silentLogger(),
    });
    const order: string[] = [];
    restarted.on('player.optins_changed', 'test.late', async (e) => void order.push(e.payload.memberId));
    expect(await restarted.replayPending()).toBe(2);
    expect(order).toEqual(['m1', 'm2']);
    expect(await restarted.replayPending()).toBe(0);
  });

  it('never replays events from before a consumer was first seen (a newly enabled bot)', async () => {
    rt = await createTestRuntime();
    rt.bus.on('player.optins_changed', 'test.old', async () => {});
    await rt.bus.replayPending(); // first boot
    await rt.bus.emit(rt.db.orm, 'player.optins_changed', optIns('before'));
    await rt.bus.drain();
    rt.clock.advance(1000);
    const scheduler = new DbScheduler({
      db: rt.db,
      clock: rt.clock,
      newId: rt.newId,
      log: silentLogger(),
      timezone: 'UTC',
    });
    const next = new InProcessEventBus({
      db: rt.db,
      scheduler,
      clock: rt.clock,
      newId: rt.newId,
      guildId: 'g',
      log: silentLogger(),
    });
    const seen: string[] = [];
    next.on('player.optins_changed', 'test.old', async () => {});
    next.on('player.optins_changed', 'test.new', async (e) => void seen.push(e.payload.memberId));
    expect(await next.replayPending()).toBe(0);
    await next.emit(rt.db.orm, 'player.optins_changed', optIns('after'));
    await next.drain();
    expect(seen).toEqual(['after']);
  });

  it('on the first boot with first-seen tracking, consumers with history keep their replay', async () => {
    rt = await createTestRuntime();
    rt.bus.on('player.optins_changed', 'test.known', async () => {});
    await rt.bus.emit(rt.db.orm, 'player.optins_changed', optIns('m1'));
    await rt.bus.drain();
    await rt.bus.emit(rt.db.orm, 'player.optins_changed', optIns('m2'));
    await rt.bus.drain();
    const t = coreTables(rt.db).coreEventConsumption;
    const rows = await rt.db.orm.select().from(t);
    await rt.db.orm.delete(t);
    await rt.db.orm.insert(t).values(rows.slice(0, 1)); // m2 was never recorded
    const calls: string[] = [];
    const scheduler = new DbScheduler({
      db: rt.db,
      clock: rt.clock,
      newId: rt.newId,
      log: silentLogger(),
      timezone: 'UTC',
    });
    const next = new InProcessEventBus({
      db: rt.db,
      scheduler,
      clock: rt.clock,
      newId: rt.newId,
      guildId: 'g',
      log: silentLogger(),
    });
    next.on('player.optins_changed', 'test.known', async (e) => void calls.push(e.payload.memberId));
    expect(await next.replayPending()).toBe(1);
    expect(calls).toEqual(['m2']);
  });

  it('skips events older than the lookback window', async () => {
    rt = await createTestRuntime();
    await rt.bus.emit(rt.db.orm, 'player.optins_changed', optIns('old'));
    rt.clock.advance(8 * 86_400_000);
    const order: string[] = [];
    rt.bus.on('player.optins_changed', 'test.late', async (e) => void order.push(e.payload.memberId));
    expect(await rt.bus.replayPending()).toBe(0);
  });

  it('delivers a duplicate to a consumer only once', async () => {
    rt = await createTestRuntime();
    let calls = 0;
    rt.bus.on('player.optins_changed', 'test.a', async () => void calls++);
    await rt.bus.emit(rt.db.orm, 'player.optins_changed', optIns('m1'));
    await rt.bus.drain();
    await rt.bus.replayPending();
    expect(calls).toBe(1);
  });

  it('retries a failing handler with backoff through the scheduler, then marks it failed', async () => {
    rt = await createTestRuntime();
    let calls = 0;
    rt.bus.on('player.optins_changed', 'test.flaky', async () => {
      calls++;
      throw new Error(`fail ${calls}`);
    });
    let okCalls = 0;
    rt.bus.on('player.optins_changed', 'test.ok', async () => void okCalls++);
    await rt.bus.emit(rt.db.orm, 'player.optins_changed', optIns('m1'));
    await rt.bus.drain();
    expect(calls).toBe(1);
    expect(okCalls).toBe(1); // other consumers are unaffected
    for (const ms of [1_000, 5_000, 30_000, 120_000, 600_000]) {
      rt.clock.advance(ms);
      await rt.scheduler.tick();
    }
    expect(calls).toBe(1 + MAX_EVENT_RETRIES);
    rt.clock.advance(3_600_000);
    await rt.scheduler.tick();
    expect(calls).toBe(1 + MAX_EVENT_RETRIES);
    const t = coreTables(rt.db).coreEventConsumption;
    const rows = await rt.db.orm.select().from(t);
    expect(rows.find((r) => r.consumerId === 'test.flaky')).toMatchObject({
      status: 'failed',
      attempts: 6,
      lastError: 'fail 6',
    });
    // Replay does not resurrect failed consumptions.
    expect(await rt.bus.replayPending()).toBe(0);
  });

  it('a retry that succeeds marks the consumption done', async () => {
    rt = await createTestRuntime();
    let calls = 0;
    rt.bus.on('player.optins_changed', 'test.flaky', async () => {
      calls++;
      if (calls === 1) throw new Error('once');
    });
    await rt.bus.emit(rt.db.orm, 'player.optins_changed', optIns('m1'));
    await rt.bus.drain();
    rt.clock.advance(1_000);
    await rt.scheduler.tick();
    const [row] = await rt.db.orm.select().from(coreTables(rt.db).coreEventConsumption);
    expect(row).toMatchObject({ status: 'done', attempts: 2 });
  });

  it('rejects duplicate consumer ids per type', async () => {
    rt = await createTestRuntime();
    rt.bus.on('player.optins_changed', 'x', async () => {});
    expect(() => rt.bus.on('player.optins_changed', 'x', async () => {})).toThrow(/already subscribed/);
  });
});
