import type { LegionDb } from '@legion/core';
import { pickSchema } from '@legion/core';
import * as pgSchema from './schema.pg.js';
import * as sqliteSchema from './schema.sqlite.js';

export type HerbieTables = typeof sqliteSchema;
export const herbieTables = (db: Pick<LegionDb, 'dialect'>): HerbieTables =>
  pickSchema(db, sqliteSchema, pgSchema);
export { pgSchema as herbiePgSchema, sqliteSchema as herbieSqliteSchema };
