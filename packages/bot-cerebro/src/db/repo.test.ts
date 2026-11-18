import { compareSchemas, createIdGenerator, createTestDb, FakeClock, type LegionDb } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { CEREBRO_MIGRATIONS_DIR } from '../paths.js';
import { membersReadModel, mutantsReadModel } from '../read-models.js';
import { CerebroRepo } from './repo.js';
import * as pgSchema from './schema.pg.js';
import * as sqliteSchema from './schema.sqlite.js';

let db: LegionDb | undefined;
afterEach(async () => db?.close());

const setup = async () => {
  db = await createTestDb();
  await db.migrate('cerebro', CEREBRO_MIGRATIONS_DIR);
  const clock = new FakeClock('2026-11-16T15:00:00.000Z');
  return { clock, repo: new CerebroRepo(db, 'g1', clock, createIdGenerator(clock)) };
};

const mutant = (memberId: string, codename: string, normalized: string) => ({
  memberId,
  codename,
  codenameNormalized: normalized,
  power: 'Controla faíscas',
  archetype: 'Elemental',
  origin: 'Nasceu durante uma tempestade elétrica.',
});

describe('cerebro schema', () => {
  it('matches between sqlite and pg', () => {
    expect(compareSchemas(sqliteSchema, pgSchema)).toEqual([]);
  });
});

describe('CerebroRepo', () => {
  it('ensureMember is idempotent', async () => {
    const { repo } = await setup();
    const a = await repo.ensureMember('u1');
    const b = await repo.ensureMember('u1');
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.row.id).toBe(a.row.id);
    expect(a.row).toMatchObject({ onboardingStep: 'signal', rank: 'recruta', optIns: '[]' });
  });

  it('the DB rejects a duplicate normalized codename in the same guild, and a second mutant per member', async () => {
    const { repo } = await setup();
    const a = (await repo.ensureMember('u1')).row;
    const b = (await repo.ensureMember('u2')).row;
    await repo.insertMutant(mutant(a.id, 'Fênix Azul', 'fenix azul'));
    await expect(repo.insertMutant(mutant(b.id, 'fenix azul', 'fenix azul'))).rejects.toThrow();
    await expect(repo.insertMutant(mutant(a.id, 'Outro', 'outro'))).rejects.toThrow();
    expect(await repo.codenameTaken('fenix azul')).toBe(true);
  });

  it('read models expose typed views and hide members who left', async () => {
    const { repo } = await setup();
    const a = (await repo.ensureMember('u1')).row;
    await repo.updateMember(a.id, { onboardingStep: 'registered', faction: 'xmen', optIns: '["live_ping"]' });
    await repo.insertMutant(mutant(a.id, 'Faísca', 'faisca'));
    const members = membersReadModel(repo);
    expect(await members.getByDiscordId('u1')).toEqual({
      id: a.id,
      discordUserId: 'u1',
      onboardingStep: 'registered',
      faction: 'xmen',
      factionChangedAt: null,
      rank: 'recruta',
      optIns: ['live_ping'],
      leftAt: null,
    });
    expect((await mutantsReadModel(repo).getByMemberId(a.id))?.codename).toBe('Faísca');
    expect(await members.listRegistered({ faction: 'xmen' })).toHaveLength(1);
    expect(await members.listRegistered({ faction: 'brotherhood' })).toHaveLength(0);
    await repo.updateMember(a.id, { leftAt: '2026-11-16T16:00:00.000Z' });
    expect(await members.listRegistered()).toHaveLength(0);
  });

  it('counts canon attempts inside the window only', async () => {
    const { repo, clock } = await setup();
    const a = (await repo.ensureMember('u1')).row;
    expect(await repo.recordCanonAttempt(a.id, 'Wolverine', 10)).toBe(1);
    clock.advance(11 * 60_000);
    expect(await repo.recordCanonAttempt(a.id, 'Magneto', 10)).toBe(1);
    expect(await repo.recordCanonAttempt(a.id, 'Storm', 10)).toBe(2);
  });
});
