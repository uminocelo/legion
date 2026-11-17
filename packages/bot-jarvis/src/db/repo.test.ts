import { compareSchemas } from '@legion/core';
import { describe, expect, it } from 'vitest';
import * as pgSchema from './schema.pg.js';
import * as sqliteSchema from './schema.sqlite.js';

describe('jarvis schema', () => {
  it('matches between sqlite and pg', () => {
    expect(compareSchemas(sqliteSchema, pgSchema)).toEqual([]);
  });
});
