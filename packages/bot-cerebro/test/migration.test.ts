import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, type LegionDb } from '@legion/core';
import { type SQL, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { CEREBRO_MIGRATIONS_DIR } from '../src/paths.js';

let db: LegionDb | undefined;
afterEach(async () => db?.close());

/** A copy of Cérebro's migrations as shipped in v0.8.1 (before 0002_hero_origins). */
function v081Migrations(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cerebro-v081-'));
  cpSync(CEREBRO_MIGRATIONS_DIR, dir, { recursive: true });
  for (const dialect of ['sqlite', 'pg']) {
    const journal = join(dir, dialect, 'meta', '_journal.json');
    const j = JSON.parse(readFileSync(journal, 'utf8')) as { entries: { tag: string }[] };
    j.entries = j.entries.filter((e) => e.tag < '0002');
    writeFileSync(journal, JSON.stringify(j));
    rmSync(join(dir, dialect, '0002_hero_origins.sql'));
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

describe('0002_hero_origins migration', () => {
  it('backfills origins from v0.8.1 data in every onboarding step', async () => {
    db = await createTestDb();
    await db.migrate('cerebro', v081Migrations());
    const now = '2026-11-01T12:00:00.000Z';
    const member = (id: string, step: string, faction: string | null) =>
      run(
        db as LegionDb,
        sql`insert into members (id, guild_id, discord_user_id, onboarding_step, faction, rank, opt_ins, created_at, updated_at)
            values (${id}, 'g1', ${`u-${id}`}, ${step}, ${faction}, 'recruta', '[]', ${now}, ${now})`,
      );
    await member('m1', 'signal', null);
    await member('m2', 'rules_accepted', null);
    await member('m3', 'faction_chosen', 'brotherhood');
    await member('m4', 'registered', 'xmen');
    await member('m5', 'registered', 'independent');
    for (const [id, memberId, codename] of [
      ['h4', 'm4', 'Faísca'],
      ['h5', 'm5', 'Brasa'],
    ])
      await run(
        db,
        sql`insert into mutants (id, member_id, guild_id, codename, codename_normalized, power, archetype, origin, created_at, updated_at)
            values (${id}, ${memberId}, 'g1', ${codename}, ${codename.toLowerCase()}, 'Faíscas', 'Elemental', 'Uma tempestade.', ${now}, ${now})`,
      );

    await db.migrate('cerebro', CEREBRO_MIGRATIONS_DIR);

    const members = await rows<{ id: string; onboarding_step: string; faction: string | null }>(
      db,
      sql`select id, onboarding_step, faction from members order by id`,
    );
    expect(members).toEqual([
      { id: 'm1', onboarding_step: 'signal', faction: null },
      { id: 'm2', onboarding_step: 'rules_accepted', faction: null },
      { id: 'm3', onboarding_step: 'rules_accepted', faction: 'brotherhood' }, // picks an origin next, keeps the faction
      { id: 'm4', onboarding_step: 'registered', faction: 'xmen' },
      { id: 'm5', onboarding_step: 'registered', faction: 'independent' },
    ]);
    const heroes = await rows<{ id: string; origin_type: string; origin_rechoice: number; origin: string }>(
      db,
      sql`select id, origin_type, origin_rechoice, origin from mutants order by id`,
    );
    expect(heroes.map((h) => ({ ...h, origin_rechoice: Number(h.origin_rechoice) }))).toEqual([
      { id: 'h4', origin_type: 'mutante', origin_rechoice: 1, origin: 'Uma tempestade.' },
      { id: 'h5', origin_type: 'mutante', origin_rechoice: 1, origin: 'Uma tempestade.' },
    ]);
    const pending = await rows<{ n: number }>(
      db,
      sql`select count(*) as n from members where pending_origin is null`,
    );
    expect(Number(pending[0]?.n)).toBe(5);
  });

  it('heroes created after the migration start with the change closed', async () => {
    db = await createTestDb();
    await db.migrate('cerebro', CEREBRO_MIGRATIONS_DIR);
    const now = '2026-11-20T12:00:00.000Z';
    await run(
      db,
      sql`insert into mutants (id, member_id, guild_id, codename, codename_normalized, power, archetype, origin, created_at, updated_at)
          values ('h1', 'm1', 'g1', 'Brasa', 'brasa', 'Fogo', 'Elemental', 'x', ${now}, ${now})`,
    );
    const [h] = await rows<{ origin_type: string; origin_rechoice: number }>(
      db,
      sql`select origin_type, origin_rechoice from mutants`,
    );
    expect({ ...h, origin_rechoice: Number(h?.origin_rechoice) }).toEqual({
      origin_type: 'mutante',
      origin_rechoice: 0,
    });
  });
});
