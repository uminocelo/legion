import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestContext } from '../testing/context.js';

describe('SQLite concurrency', () => {
  it.skipIf(!!process.env.TEST_DATABASE_URL)(
    'a consumer transaction next to another consumer of the same event does not stall',
    async () => {
      const t = await createTestContext({});
      try {
        await t.db.orm.run(sql`create table if not exists zz_counter (id integer primary key, n integer)`);
        await t.db.orm.run(sql`insert into zz_counter (id, n) values (1, 0) on conflict do nothing`);
        const bus = t.runtime.bus;
        bus.on('xp.grant_requested', 'test.tx', async () => {
          await t.db.transaction(async (tx) => {
            await tx.run(sql`select n from zz_counter`);
            await tx.run(sql`update zz_counter set n = n + 1 where id = 1`);
          });
        });
        bus.on('xp.grant_requested', 'test.plain', async () => {});
        const started = Date.now();
        for (const n of [1, 2, 3])
          await bus.forSource('herbie').emit(t.db.orm, 'xp.grant_requested', {
            memberId: 'm',
            amount: 1,
            reason: 'r',
            sourceEventId: `e${n}`,
          });
        await bus.drain();
        expect(Date.now() - started).toBeLessThan(1500);
        const rows = await t.db.orm.all<{ n: number }>(sql`select n from zz_counter where id = 1`);
        expect(Number(rows[0]?.n)).toBe(3);
      } finally {
        await t.close();
      }
    },
  );
});
