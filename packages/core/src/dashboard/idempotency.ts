import { and, like, lt } from 'drizzle-orm';
import { coreTables } from '../db/core-tables.js';
import type { LegionDb } from '../db/db.js';

const PREFIX = 'dashboard.idem:';
const KEY = /^[A-Za-z0-9_-]{16,64}$/;

/** One-use form keys (D27) in `core_kv`: the first claim wins, a repeat changes nothing. */
export class IdempotencyKeys {
  constructor(
    private readonly db: LegionDb,
    private readonly now: () => Date,
  ) {}

  /** True the first time `key` is claimed in this session; false when reused or malformed. */
  async claim(sessionHash: string, key: string): Promise<boolean> {
    if (!KEY.test(key)) return false;
    const t = coreTables(this.db).coreKv;
    const rows = await this.db.orm
      .insert(t)
      .values({
        key: `${PREFIX}${sessionHash.slice(0, 32)}:${key}`,
        value: '1',
        updatedAt: this.now().toISOString(),
      })
      .onConflictDoNothing()
      .returning({ key: t.key });
    return rows.length > 0;
  }

  /** Forgets keys older than a day (daily job). */
  async purge(): Promise<number> {
    const t = coreTables(this.db).coreKv;
    const before = new Date(this.now().getTime() - 86_400_000).toISOString();
    const rows = await this.db.orm
      .delete(t)
      .where(and(like(t.key, `${PREFIX}%`), lt(t.updatedAt, before)))
      .returning({ key: t.key });
    return rows.length;
  }
}
