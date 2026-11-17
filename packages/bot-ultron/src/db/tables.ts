import type { LegionDb } from '@legion/core';
import { pickSchema } from '@legion/core';
import * as pgSchema from './schema.pg.js';
import * as sqliteSchema from './schema.sqlite.js';

export type UltronTables = typeof sqliteSchema;
export const ultronTables = (db: Pick<LegionDb, 'dialect'>): UltronTables =>
  pickSchema(db, sqliteSchema, pgSchema);
export { pgSchema as ultronPgSchema, sqliteSchema as ultronSqliteSchema };
