import { integer as pgInt, pgTable, text as pgText } from 'drizzle-orm/pg-core';
import { getTableConfig, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../testing/db.js';
import { FakeClock } from '../time/clock.js';
import { dialectOf, type LegionDb } from './db.js';
import { KvStore } from './kv.js';
import { compareSchemas } from './parity.js';
import * as pgSchema from './schema.pg.js';
import * as sqliteSchema from './schema.sqlite.js';

let db: LegionDb | undefined;
afterEach(async () => {
  await db?.close();
  db = undefined;
});

describe('schema parity', () => {
  it('core tables match between sqlite and pg', () => {
    expect(compareSchemas(sqliteSchema, pgSchema)).toEqual([]);
  });

  it('detects a column mismatch', () => {
    const a = { t: sqliteTable('t', { id: text('id').primaryKey(), n: text('n') }) };
    const b = { t: pgTable('t', { id: pgText('id').primaryKey(), n: pgInt('n') }) };
    expect(getTableConfig(a.t).name).toBe('t');
    expect(compareSchemas(a, b)[0]).toContain('t.columns');
  });

  it('detects a missing table', () => {
    expect(compareSchemas({ x: sqliteSchema.coreKv }, {})).toEqual(['x: missing in pg']);
  });
});

describe('createDb', () => {
  it('detects the dialect from the URL', () => {
    expect(dialectOf('file:./data/legion.db')).toBe('sqlite');
    expect(dialectOf('postgres://u:p@h/db')).toBe('pg');
    expect(() => dialectOf('mysql://x')).toThrow(/Unsupported/);
  });

  it('migrates, pings and supports transactions with rollback', async () => {
    db = await createTestDb();
    expect(await db.ping()).toBe(true);
    const kv = new KvStore(db, () => new FakeClock().now());
    await kv.set('a', { n: 1 });
    await kv.set('a', { n: 2 });
    expect(await kv.get('a')).toEqual({ n: 2 });
    await expect(
      db.transaction(async (tx) => {
        await kv.set('b', 1, tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await kv.get('b')).toBeNull();
  });

  it('re-running migrations is a no-op', async () => {
    db = await createTestDb();
    const { CORE_MIGRATIONS_DIR } = await import('../paths.js');
    await db.migrate('core', CORE_MIGRATIONS_DIR);
    expect(await db.ping()).toBe(true);
  });
});
