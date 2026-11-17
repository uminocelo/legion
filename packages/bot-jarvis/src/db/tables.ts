import type { LegionDb } from '@legion/core';
import { pickSchema } from '@legion/core';
import * as pgSchema from './schema.pg.js';
import * as sqliteSchema from './schema.sqlite.js';

export type JarvisTables = typeof sqliteSchema;
export const jarvisTables = (db: Pick<LegionDb, 'dialect'>): JarvisTables =>
  pickSchema(db, sqliteSchema, pgSchema);
export { pgSchema as jarvisPgSchema, sqliteSchema as jarvisSqliteSchema };
