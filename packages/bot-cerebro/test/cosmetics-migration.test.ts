import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, type LegionDb } from '@legion/core';
import { type SQL, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { CEREBRO_MIGRATIONS_DIR } from '../src/paths.js';

let db: LegionDb | undefined;
afterEach(async () => db?.close());

/** Cérebro migrations as shipped before 0005_supporter_cosmetics. */
function beforeCosmetics(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cerebro-pre-cosmetics-'));
  cpSync(CEREBRO_MIGRATIONS_DIR, dir, { recursive: true });
  for (const dialect of ['sqlite', 'pg']) {
    const journal = join(dir, dialect, 'meta', '_journal.json');
    const j = JSON.parse(readFileSync(journal, 'utf8')) as { entries: { tag: string }[] };
    j.entries = j.entries.filter((e) => e.tag < '0005');
    writeFileSync(journal, JSON.stringify(j));
    rmSync(join(dir, dialect, '0005_supporter_cosmetics.sql'));
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

describe('0005_supporter_cosmetics migration', () => {
  it('adds nullable frame_id and title_id on members', async () => {
    db = await createTestDb();
    await db.migrate('cerebro', beforeCosmetics());
    await run(
      db,
      sql`insert into members (id, guild_id, discord_user_id, onboarding_step, faction, rank, opt_ins, created_at, updated_at)
          values ('m1', 'g1', 'u1', 'registered', 'xmen', 'recruta', '[]', ${NOW}, ${NOW})`,
    );
    await db.migrate('cerebro', CEREBRO_MIGRATIONS_DIR);
    const [member] = await rows<{ frame_id: string | null; title_id: string | null }>(
      db,
      sql`select frame_id, title_id from members where id = 'm1'`,
    );
    expect(member).toEqual({ frame_id: null, title_id: null });
    await run(
      db,
      sql`update members set frame_id = 'frame-aurora', title_id = 'title-patron' where id = 'm1'`,
    );
    const [saved] = await rows<{ frame_id: string | null; title_id: string | null }>(
      db,
      sql`select frame_id, title_id from members where id = 'm1'`,
    );
    expect(saved).toEqual({ frame_id: 'frame-aurora', title_id: 'title-patron' });
  });
});
