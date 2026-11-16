import { type LegionDb, pickSchema } from './db.js';
import * as pgSchema from './schema.pg.js';
import * as sqliteSchema from './schema.sqlite.js';

export type CoreTables = typeof sqliteSchema;
export const coreTables = (db: Pick<LegionDb, 'dialect'>): CoreTables =>
  pickSchema(db, sqliteSchema, pgSchema);
export { pgSchema as corePgSchema, sqliteSchema as coreSqliteSchema };
