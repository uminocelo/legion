import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle as drizzleLibsql, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate as migrateLibsql } from 'drizzle-orm/libsql/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export type Dialect = 'sqlite' | 'pg';

/**
 * The query surface shared by both dialects. Repositories are typed against the SQLite builder
 * and receive the matching tables at runtime (see `pickSchema`); only the portable subset
 * (select/insert/update/delete/returning/onConflict/transaction) may be used.
 */
// biome-ignore lint/suspicious/noExplicitAny: schema-agnostic handle shared by every package
export type Orm = LibSQLDatabase<any>;
/** A database handle or an open transaction. */
export type Executor = Pick<Orm, 'select' | 'insert' | 'update' | 'delete'>;

export interface LegionDb {
  readonly dialect: Dialect;
  readonly orm: Orm;
  transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
  /** Applies a package's migrations from `<dir>/sqlite` or `<dir>/pg`, tracked in its own table. */
  migrate(packageId: string, migrationsDir: string): Promise<void>;
  /** Liveness probe used by /healthz and `legion doctor`. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  /** Postgres only: isolate everything in this schema (tests). */
  pgSchema?: string;
}

export function dialectOf(url: string): Dialect {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return 'pg';
  if (url.startsWith('file:') || url === ':memory:') return 'sqlite';
  throw new Error(
    `Unsupported DATABASE_URL "${url.split(':')[0]}:"; use file:./data/legion.db or postgres://…`,
  );
}

/** Picks the table set for the active dialect, typed as the SQLite variant. */
export function pickSchema<S>(db: Pick<LegionDb, 'dialect'>, sqlite: S, pgTables: unknown): S {
  return db.dialect === 'sqlite' ? sqlite : (pgTables as S);
}

export async function createDb(url: string, opts: CreateDbOptions = {}): Promise<LegionDb> {
  if (dialectOf(url) === 'sqlite') {
    if (url.startsWith('file:')) mkdirSync(dirname(resolve(url.slice('file:'.length))), { recursive: true });
    const client = createClient({ url });
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA busy_timeout = 5000');
    await client.execute('PRAGMA foreign_keys = ON');
    const orm = drizzleLibsql(client);
    return {
      dialect: 'sqlite',
      orm,
      transaction: (fn) => orm.transaction((tx) => fn(tx as unknown as Executor)),
      migrate: async (packageId, dir) =>
        migrateLibsql(orm, {
          migrationsFolder: `${dir}/sqlite`,
          migrationsTable: `__migrations_${packageId}`,
        }),
      ping: async () => {
        try {
          await client.execute('SELECT 1');
          return true;
        } catch {
          return false;
        }
      },
      close: async () => client.close(),
    };
  }

  const schema = opts.pgSchema;
  if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`invalid pg schema name ${schema}`);
  const pool = new pg.Pool({
    connectionString: url,
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  });
  if (schema) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  const orm = drizzlePg(pool) as unknown as Orm;
  return {
    dialect: 'pg',
    orm,
    transaction: (fn) => orm.transaction((tx) => fn(tx as unknown as Executor)),
    migrate: async (packageId, dir) =>
      migratePg(drizzlePg(pool), {
        migrationsFolder: `${dir}/pg`,
        migrationsTable: `__migrations_${packageId}`,
        migrationsSchema: schema ?? 'public',
      }),
    ping: async () => {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    close: async () => pool.end(),
  };
}
