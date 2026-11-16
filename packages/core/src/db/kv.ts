import { eq } from 'drizzle-orm';
import { coreTables } from './core-tables.js';
import type { Executor, LegionDb } from './db.js';

/** Small JSON key/value store in `core_kv`. */
export class KvStore {
  constructor(
    private readonly db: LegionDb,
    private readonly now: () => Date,
  ) {}

  async get<T>(key: string, ex: Executor = this.db.orm): Promise<T | null> {
    const t = coreTables(this.db).coreKv;
    const [row] = await ex.select().from(t).where(eq(t.key, key)).limit(1);
    return row ? (JSON.parse(row.value) as T) : null;
  }

  async set(key: string, value: unknown, ex: Executor = this.db.orm): Promise<void> {
    const t = coreTables(this.db).coreKv;
    const row = { key, value: JSON.stringify(value), updatedAt: this.now().toISOString() };
    await ex
      .insert(t)
      .values(row)
      .onConflictDoUpdate({ target: t.key, set: { value: row.value, updatedAt: row.updatedAt } });
  }
}
