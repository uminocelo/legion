import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, type LegionDb } from '@legion/core';
import { type SQL, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { CEREBRO_MIGRATIONS_DIR } from '../src/paths.js';

let db: LegionDb | undefined;
afterEach(async () => db?.close());

/** Cérebro migrations as shipped before 0004_squads (1.0.0 data). */
function beforeSquads(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cerebro-pre-squads-'));
  cpSync(CEREBRO_MIGRATIONS_DIR, dir, { recursive: true });
  for (const dialect of ['sqlite', 'pg']) {
    const journal = join(dir, dialect, 'meta', '_journal.json');
    const j = JSON.parse(readFileSync(journal, 'utf8')) as { entries: { tag: string }[] };
    j.entries = j.entries.filter((e) => e.tag < '0004');
    writeFileSync(journal, JSON.stringify(j));
    rmSync(join(dir, dialect, '0004_squads.sql'));
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

describe('0004_squads migration', () => {
  it('upgrades 1.0.0 data and keeps pending_squad_id empty', async () => {
    db = await createTestDb();
    await db.migrate('cerebro', beforeSquads());
    await run(
      db,
      sql`insert into members (id, guild_id, discord_user_id, onboarding_step, faction, rank, opt_ins, created_at, updated_at)
          values ('m1', 'g1', 'u1', 'registered', 'xmen', 'recruta', '[]', ${NOW}, ${NOW})`,
    );
    await db.migrate('cerebro', CEREBRO_MIGRATIONS_DIR);
    const [member] = await rows<{ pending_squad_id: string | null }>(
      db,
      sql`select pending_squad_id from members where id = 'm1'`,
    );
    expect(member?.pending_squad_id ?? null).toBeNull();
  });

  it('rejects a repeated squad name and a second squad for the same member', async () => {
    db = await createTestDb();
    await db.migrate('cerebro', CEREBRO_MIGRATIONS_DIR);
    const squad = (id: string, nameKey: string) =>
      run(
        db as LegionDb,
        sql`insert into cerebro_squads (id, guild_id, name, name_key, base_faction, founder_member_id, status, requested_at)
            values (${id}, 'g1', ${nameKey}, ${nameKey}, 'xmen', ${`founder-${id}`}, 'requested', ${NOW})`,
      );
    await squad('s1', 'noite');
    const fails = (fn: () => unknown) => expect(Promise.resolve().then(fn)).rejects.toThrow();
    await fails(() => squad('s2', 'noite'));
    await squad('s3', 'aurora');
    await run(
      db,
      sql`insert into cerebro_squad_members (member_id, squad_id, joined_at, via)
          values ('m1', 's3', ${NOW}, 'founder')`,
    );
    await fails(() =>
      run(
        db,
        sql`insert into cerebro_squad_members (member_id, squad_id, joined_at, via)
            values ('m1', 's1', ${NOW}, 'code')`,
      ),
    );
    const members = await rows<{ member_id: string; squad_id: string }>(
      db,
      sql`select member_id, squad_id from cerebro_squad_members`,
    );
    expect(members).toEqual([{ member_id: 'm1', squad_id: 's3' }]);
  });
});
