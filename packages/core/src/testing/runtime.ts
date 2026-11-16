import type { LegionDb } from '../db/db.js';
import { InProcessEventBus } from '../events/bus.js';
import { createIdGenerator } from '../ids/ids.js';
import { DbScheduler } from '../scheduler/scheduler.js';
import { silentLogger } from '../silent-log.js';
import { FakeClock } from '../time/clock.js';
import { createTestDb } from './db.js';

export interface TestRuntime {
  db: LegionDb;
  clock: FakeClock;
  scheduler: DbScheduler;
  bus: InProcessEventBus;
  newId: () => string;
  close(): Promise<void>;
}

/** Real DB + scheduler + bus with a fake clock, for tests. */
export async function createTestRuntime(
  opts: { start?: string; timezone?: string } = {},
): Promise<TestRuntime> {
  const db = await createTestDb();
  const clock = new FakeClock(opts.start ?? '2026-11-16T15:00:00.000Z');
  const log = silentLogger();
  const newId = createIdGenerator(clock);
  const scheduler = new DbScheduler({
    db,
    clock,
    newId,
    log,
    timezone: opts.timezone ?? 'America/Sao_Paulo',
  });
  const bus = new InProcessEventBus({ db, scheduler, clock, newId, guildId: '100000000000000001', log });
  return {
    db,
    clock,
    scheduler,
    bus,
    newId,
    close: async () => {
      await bus.drain();
      await db.close();
    },
  };
}
