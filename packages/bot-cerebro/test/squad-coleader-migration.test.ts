import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, type LegionDb } from '@legion/core';
import { type SQL, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { CEREBRO_MIGRATIONS_DIR } from '../src/paths.js';

let db: LegionDb | undefined;
afterEach(async () => db?.close());

/** Cérebro migrations as shipped before 0006_squad_coleader. */
function beforeColeader(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cerebro-pre-coleader-'));
  cpSync(CEREBRO_MIGRATIONS_DIR, dir, { recursive: true });
  for (const dialect of ['sqlite', 'pg']) {
    const journal = join(dir, dialect, 'meta', '_journal.json');
    const j = JSON.parse(readFileSync(journal, 'utf8')) as { entries: { tag: string }[] };
    j.entries = j.entries.filter((e) => e.tag < '0006');
    writeFileSync(journal, JSON.stringify(j));
    rmSync(join(dir, dialect, '0006_squad_coleader.sql'));
  }
  return dir;
}

const run = (d: LegionDb, q: SQL) =>
  d.dialect === 'sqlite'
    ? d.orm.run(q)
    : (d.orm as unknown as { execute(q: SQL): Promise<unknown> }).execute(q);
const rows = async <T>(d: LegionDb, q: SQL): Promise<T[]> =>
  d.dialect === 'sqlite'
    ? d.orm.all<T>(q)
    : ((await (d.orm as unknown as { execute(q: SQL): Promise<{ rows: T[] }> }).execute(q)).rows as T[]);

const NOW = '2026-11-22T12:00:00.000Z';

describe('0006_squad_coleader migration', () => {
  it('adds nullable co_leader_member_id on cerebro_squads', async () => {
    db = await createTestDb();
    await db.migrate('cerebro', beforeColeader());
    await run(
      db,
      sql`insert into members (id, guild_id, discord_user_id, onboarding_step, faction, rank, opt_ins, created_at, updated_at)
          values ('m1', 'g1', 'u1', 'registered', 'xmen', 'recruta', '[]', ${NOW}, ${NOW})`,
    );
    await run(
      db,
      sql`insert into cerebro_squads (id, guild_id, name, name_key, base_faction, founder_member_id, status, requested_at)
          values ('sq1', 'g1', 'Noite', 'noite', 'xmen', 'm1', 'active', ${NOW})`,
    );
    await db.migrate('cerebro', CEREBRO_MIGRATIONS_DIR);
    const [squad] = await rows<{ co_leader_member_id: string | null }>(
      db,
      sql`select co_leader_member_id from cerebro_squads where id = 'sq1'`,
    );
    expect(squad?.co_leader_member_id ?? null).toBeNull();
    await run(db, sql`update cerebro_squads set co_leader_member_id = 'm2' where id = 'sq1'`);
    const [saved] = await rows<{ co_leader_member_id: string | null }>(
      db,
      sql`select co_leader_member_id from cerebro_squads where id = 'sq1'`,
    );
    expect(saved?.co_leader_member_id).toBe('m2');
  });
});
