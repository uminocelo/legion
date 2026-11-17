import type { LegionDb } from '@legion/core';
import { pickSchema } from '@legion/core';
import * as pgSchema from './schema.pg.js';
import * as sqliteSchema from './schema.sqlite.js';

export type SentinelTables = typeof sqliteSchema;
export const sentinelTables = (db: Pick<LegionDb, 'dialect'>): SentinelTables =>
  pickSchema(db, sqliteSchema, pgSchema);
export { pgSchema as sentinelPgSchema, sqliteSchema as sentinelSqliteSchema };
