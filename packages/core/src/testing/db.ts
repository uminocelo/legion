import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { createDb, type LegionDb } from '../db/db.js';
import { CORE_MIGRATIONS_DIR } from '../paths.js';

let counter = 0;

/**
 * A fresh, migrated database for one test: a temp SQLite file, or an isolated schema in
 * `TEST_DATABASE_URL` when it points at Postgres (CI runs the suite both ways). The schema is
 * dropped on close.
 */
export async function createTestDb(): Promise<LegionDb> {
  const pgUrl = process.env.TEST_DATABASE_URL;
  if (!pgUrl) {
    const db = await createDb(`file:${join(mkdtempSync(join(tmpdir(), 'legion-db-')), 'test.db')}`);
    await db.migrate('core', CORE_MIGRATIONS_DIR);
    return db;
  }
  const schema = `t_${process.pid}_${Date.now().toString(36)}_${counter++}`;
  const db = await createDb(pgUrl, { pgSchema: schema });
  await db.migrate('core', CORE_MIGRATIONS_DIR);
  return {
    ...db,
    dialect: db.dialect,
    orm: db.orm,
    close: async () => {
      await db.close();
      const client = new pg.Client({ connectionString: pgUrl });
      await client.connect();
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    },
  };
}
