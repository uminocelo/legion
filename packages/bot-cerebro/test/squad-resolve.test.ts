import { createTestDb, type LegionDb } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { founderActiveSquad, resolveActiveSquad } from '../src/db/repo.js';
import { cerebroTables } from '../src/db/tables.js';
import { CEREBRO_MIGRATIONS_DIR } from '../src/paths.js';

const GUILD = 'g1';
const NOW = '2026-11-22T12:00:00.000Z';

let db: LegionDb | undefined;
afterEach(async () => db?.close());

async function ready() {
  db = await createTestDb();
  await db.migrate('cerebro', CEREBRO_MIGRATIONS_DIR);
  return db;
}

async function insertSquad(
  d: LegionDb,
  row: {
    id: string;
    name: string;
    code?: string | null;
    status?: string;
    founder?: string;
    guildId?: string;
  },
) {
  const s = cerebroTables(d).cerebroSquads;
  await d.orm.insert(s).values({
    id: row.id,
    guildId: row.guildId ?? GUILD,
    name: row.name,
    nameKey: row.name.toLowerCase(),
    baseFaction: 'avengers',
    founderMemberId: row.founder ?? `founder-${row.id}`,
    status: row.status ?? 'active',
    code: row.code ?? null,
    requestedAt: NOW,
    decidedAt: NOW,
    decidedBy: 'staff',
  });
}

describe('resolveActiveSquad', () => {
  it('resolves by name_key and by code, and ignores inactive or unknown', async () => {
    const d = await ready();
    await insertSquad(d, { id: 'sq-noite', name: 'Noite', code: 'NOITE1' });
    await insertSquad(d, { id: 'sq-old', name: 'Aurora', code: 'AURORA', status: 'archived' });

    expect(await resolveActiveSquad(d, GUILD, 'Noite')).toEqual({
      id: 'sq-noite',
      name: 'Noite',
      baseFaction: 'avengers',
    });
    expect(await resolveActiveSquad(d, GUILD, 'noite')).toEqual({
      id: 'sq-noite',
      name: 'Noite',
      baseFaction: 'avengers',
    });
    expect(await resolveActiveSquad(d, GUILD, 'noite1')).toEqual({
      id: 'sq-noite',
      name: 'Noite',
      baseFaction: 'avengers',
    });
    expect(await resolveActiveSquad(d, GUILD, 'Aurora')).toBeNull();
    expect(await resolveActiveSquad(d, GUILD, 'AURORA')).toBeNull();
    expect(await resolveActiveSquad(d, GUILD, 'Fantasma')).toBeNull();
    expect(await resolveActiveSquad(d, 'other-guild', 'Noite')).toBeNull();
  });

  it('prefers code when the value looks like a 6-char code', async () => {
    const d = await ready();
    // name_key "abc123" would collide with a code-shaped value; code wins.
    await insertSquad(d, { id: 'sq-name', name: 'Abc123', code: 'NAME01' });
    await insertSquad(d, { id: 'sq-code', name: 'Outro', code: 'ABC123' });
    expect(await resolveActiveSquad(d, GUILD, 'ABC123')).toEqual({
      id: 'sq-code',
      name: 'Outro',
      baseFaction: 'avengers',
    });
    expect(await resolveActiveSquad(d, GUILD, 'abc123')).toEqual({
      id: 'sq-code',
      name: 'Outro',
      baseFaction: 'avengers',
    });
  });
});

describe('founderActiveSquad', () => {
  it('returns the active squad founded by the member', async () => {
    const d = await ready();
    await insertSquad(d, { id: 'sq-1', name: 'Noite', code: 'NOITE1', founder: 'm-founder' });
    await insertSquad(d, {
      id: 'sq-2',
      name: 'Velha',
      code: 'VELHA1',
      founder: 'm-founder',
      status: 'archived',
    });
    expect(await founderActiveSquad(d, 'm-founder')).toEqual({
      id: 'sq-1',
      name: 'Noite',
      baseFaction: 'avengers',
    });
    expect(await founderActiveSquad(d, 'm-other')).toBeNull();
  });
});
