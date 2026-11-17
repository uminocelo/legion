import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type Client, createClient } from '@libsql/client';
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

const BUSY_RETRY_MS = 5000;
const isBusy = (err: unknown) =>
  /SQLITE_BUSY|database is locked/i.test(String((err as { code?: string })?.code ?? err));

/**
 * While a libSQL transaction is open, other statements run on another pooled connection and fail at
 * once with SQLITE_BUSY (timeout 0). Retry those with a short async backoff (up to ~5 s), so the event
 * loop stays free for the transaction to finish. Transactions themselves are untouched.
 */
export function retryOnBusy<C extends Client>(client: C): C {
  const wrap =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const start = Date.now();
      for (let delay = 2; ; delay = Math.min(delay * 2, 100)) {
        try {
          return await fn(...args);
        } catch (err) {
          if (!isBusy(err) || Date.now() - start > BUSY_RETRY_MS) throw err;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    };
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      const bound = value.bind(target);
      return prop === 'execute' || prop === 'batch' || prop === 'executeMultiple' ? wrap(bound) : bound;
    },
  });
}

const READ_ONLY = /^\s*(select|with\s[\s\S]*?\)\s*select|pragma\s+\w+\s*$|explain)\b/i;
const sqlOf = (stmt: unknown) =>
  typeof stmt === 'string' ? stmt : String((stmt as { sql?: string })?.sql ?? '');

/** Routes every statement that may write (and every batch) through `queued`. Reads run at once. */
export function queueWrites<C extends Client>(client: C, queued: <T>(fn: () => Promise<T>) => Promise<T>): C {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      const bound = value.bind(target);
      if (prop === 'execute')
        return (stmt: unknown, ...rest: unknown[]) =>
          READ_ONLY.test(sqlOf(stmt)) ? bound(stmt, ...rest) : queued(() => bound(stmt, ...rest));
      if (prop === 'batch' || prop === 'executeMultiple')
        return (...args: unknown[]) => queued(() => bound(...args));
      return bound;
    },
  });
}

export async function createDb(url: string, opts: CreateDbOptions = {}): Promise<LegionDb> {
  if (dialectOf(url) === 'sqlite') {
    if (url.startsWith('file:')) mkdirSync(dirname(resolve(url.slice('file:'.length))), { recursive: true });
    // libSQL runs SQLite synchronously from a pool of connections, so a SQLite busy wait blocks the event
    // loop (the transaction holding the lock can't finish), and a statement that fails with SQLITE_BUSY
    // is left open on its pooled connection (a later COMMIT there fails with "statements in progress").
    // So this process never makes SQLite wait on itself: transactions run one at a time (ADR 0002) and
    // plain writes queue behind them. timeout 0 + retryOnBusy only cover other processes (the CLI).
    let queue: Promise<unknown> = Promise.resolve();
    const serial = <T>(fn: () => Promise<T>): Promise<T> => {
      const run = queue.then(fn, fn);
      queue = run.catch(() => {});
      return run;
    };
    /** Waits for open transactions (at most 5 s, so a stray write inside a transaction fails, not hangs). */
    const queued = <T>(fn: () => Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        let p: Promise<T> | undefined;
        const go = () => {
          p ??= fn();
          p.then(resolve, reject);
          return p;
        };
        const timer = setTimeout(go, BUSY_RETRY_MS);
        void serial(() => {
          clearTimeout(timer);
          return go().catch(() => {});
        });
      });
    const client = createClient({ url, timeout: 0 });
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA foreign_keys = ON');
    const orm = drizzleLibsql(queueWrites(retryOnBusy(client), queued));
    return {
      dialect: 'sqlite',
      orm,
      transaction: (fn) => serial(() => orm.transaction((tx) => fn(tx as unknown as Executor))),
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
