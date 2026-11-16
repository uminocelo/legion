import type { LegionDb } from '@legion/core';
import { pickSchema } from '@legion/core';
import * as pgSchema from './schema.pg.js';
import * as sqliteSchema from './schema.sqlite.js';

export type CerebroTables = typeof sqliteSchema;
export const cerebroTables = (db: Pick<LegionDb, 'dialect'>): CerebroTables =>
  pickSchema(db, sqliteSchema, pgSchema);
export { pgSchema as cerebroPgSchema, sqliteSchema as cerebroSqliteSchema };
