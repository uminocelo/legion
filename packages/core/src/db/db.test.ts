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

describe('concurrent transactions', () => {
  it('20 concurrent write transactions all commit (no SQLITE_BUSY)', async () => {
    const db = await createTestDb();
    try {
      await db.migrate('core', (await import('../paths.js')).CORE_MIGRATIONS_DIR);
      const clock = new FakeClock('2026-11-16T15:00:00.000Z');
      const kv = new KvStore(db, () => clock.now());
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          db.transaction(async (tx) => {
            await kv.set(`k${i}`, i, tx);
            await new Promise((r) => setTimeout(r, 1));
            await kv.set(`k${i}:b`, i, tx);
          }),
        ),
      );
      const values = await Promise.all(Array.from({ length: 20 }, (_, i) => kv.get<number>(`k${i}:b`)));
      expect(values).toEqual(Array.from({ length: 20 }, (_, i) => i));
      // a write outside any transaction while one is open waits instead of failing with SQLITE_BUSY
      let release: () => void = () => {};
      const open = db.transaction(async (tx) => {
        await kv.set('in-tx', 1, tx);
        await new Promise<void>((r) => {
          release = r;
        });
      });
      await new Promise((r) => setTimeout(r, 5));
      const outside = kv.set('outside', 2);
      setTimeout(() => release(), 30);
      await Promise.all([open, outside]);
      expect([await kv.get('in-tx'), await kv.get('outside')]).toEqual([1, 2]);
      // a failing transaction does not block the queue
      await expect(db.transaction(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
      await db.transaction((tx) => kv.set('after', 1, tx));
      expect(await kv.get('after')).toBe(1);
    } finally {
      await db.close();
    }
  });
});
