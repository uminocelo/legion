import { type PgTable, getTableConfig as pgConfig } from 'drizzle-orm/pg-core';
import { type SQLiteTable, getTableConfig as sqliteConfig } from 'drizzle-orm/sqlite-core';

type Shape = {
  name: string;
  columns: string[];
  primaryKey: string[];
  indexes: string[];
  uniques: string[];
};

// biome-ignore lint/suspicious/noExplicitAny: drizzle table config internals differ per dialect
type Loose = any;

const normType = (t: string) => {
  const s = t.toLowerCase();
  if (s.includes('text') || s.includes('varchar')) return 'text';
  if (s.includes('int')) return 'integer';
  if (s.includes('real') || s.includes('double') || s.includes('numeric')) return 'real';
  return s;
};
const shapeOf = (cfg: Loose): Shape => {
  const cols = cfg.columns.map((c: Loose) => {
    const unique = c.isUnique ? ` unique:${c.uniqueName ?? ''}` : '';
    return `${c.name}:${normType(c.getSQLType())}:${c.notNull ? 'notnull' : 'null'}${c.primary ? ':pk' : ''}${unique}`;
  });
  const pk = cfg.primaryKeys.flatMap((p: Loose) => p.columns.map((c: Loose) => c.name));
  const indexes = cfg.indexes.map((i: Loose) => {
    const on = i.config.columns.map((c: Loose) => c.name).join(',');
    return `${i.config.name}(${on})${i.config.unique ? ':unique' : ''}`;
  });
  const uniques = cfg.uniqueConstraints.map(
    (u: Loose) => `${u.name}(${u.columns.map((c: Loose) => c.name).join(',')})`,
  );
  return {
    name: cfg.name,
    columns: cols.sort(),
    primaryKey: pk,
    indexes: indexes.sort(),
    uniques: uniques.sort(),
  };
};

/** Lists every difference between the SQLite and Postgres declarations of a package's tables. */
export function compareSchemas(sqlite: Record<string, unknown>, pg: Record<string, unknown>): string[] {
  const diffs: string[] = [];
  const keys = new Set([...Object.keys(sqlite), ...Object.keys(pg)]);
  for (const key of keys) {
    const a = sqlite[key];
    const b = pg[key];
    if (!a || !b) {
      diffs.push(`${key}: missing in ${a ? 'pg' : 'sqlite'}`);
      continue;
    }
    const sa = shapeOf(sqliteConfig(a as SQLiteTable));
    const sb = shapeOf(pgConfig(b as PgTable));
    for (const field of ['name', 'columns', 'primaryKey', 'indexes', 'uniques'] as const) {
      if (JSON.stringify(sa[field]) !== JSON.stringify(sb[field]))
        diffs.push(`${key}.${field}: sqlite=${JSON.stringify(sa[field])} pg=${JSON.stringify(sb[field])}`);
    }
  }
  return diffs;
}
