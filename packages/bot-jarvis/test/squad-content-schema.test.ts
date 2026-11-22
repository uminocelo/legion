import { createTestDb, type LegionDb } from '@legion/core';
import { type SQL, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { campaignSchema } from '../src/domain/campaign.js';
import { parseMissionYaml } from '../src/domain/mission.js';
import { questionSchema } from '../src/domain/trivia.js';
import { JARVIS_MIGRATIONS_DIR } from '../src/paths.js';

const missionBase = `
id: teste-squad
kind: daily
title: Teste
summary: Uma missão de teste
start: a
scenes:
  a:
    text: Início
    choices:
      - { label: Sim, next: b }
      - { label: Não, next: c }
  b: { text: Fim bom, end: success }
  c: { text: Fim ruim, end: failure }
`;

describe('optional squad on content YAML', () => {
  it('parses a mission with and without squad', () => {
    const plain = parseMissionYaml(missionBase);
    expect(plain).toMatchObject({ mission: { id: 'teste-squad' } });
    if ('mission' in plain) expect(plain.mission.squad).toBeUndefined();

    const scoped = parseMissionYaml(`${missionBase}\nsquad: Noite\n`);
    expect(scoped).toMatchObject({ mission: { id: 'teste-squad', squad: 'Noite' } });
  });

  it('rejects an empty or too-long mission squad', () => {
    const empty = parseMissionYaml(`${missionBase}\nsquad: "  "\n`);
    expect('errors' in empty && empty.errors.some((e) => e.includes('squad'))).toBe(true);
    const long = parseMissionYaml(`${missionBase}\nsquad: ${'x'.repeat(33)}\n`);
    expect('errors' in long && long.errors.some((e) => e.includes('squad'))).toBe(true);
  });

  it('parses a campaign with and without squad', () => {
    const base = {
      id: 'historia-noite',
      kind: 'story',
      title: 'Noite',
      summary: 'Campanha do esquadrão Noite.',
    };
    expect(campaignSchema.parse(base).squad).toBeUndefined();
    expect(campaignSchema.parse({ ...base, squad: 'Noite' }).squad).toBe('Noite');
    expect(campaignSchema.safeParse({ ...base, squad: '' }).success).toBe(false);
  });

  it('parses a trivia question with and without squad', () => {
    const base = {
      id: 'quad-squad-1',
      category: 'quadrinhos',
      difficulty: 'facil',
      question: 'Em que ano os X-Men estrearam?',
      choices: ['1961', '1963'],
      answer: 1,
      explanation: 'X-Men #1 saiu em 1963.',
      source: 'https://en.wikipedia.org/wiki/X-Men',
    };
    expect(questionSchema.parse(base).squad).toBeUndefined();
    expect(questionSchema.parse({ ...base, squad: 'NOITE1' }).squad).toBe('NOITE1');
    expect(questionSchema.safeParse({ ...base, squad: 'x'.repeat(33) }).success).toBe(false);
  });
});

describe('0008_squad_content migration', () => {
  let db: LegionDb | undefined;
  afterEach(async () => db?.close());

  const rows = async <T>(d: LegionDb, q: SQL): Promise<T[]> =>
    d.dialect === 'sqlite'
      ? d.orm.all<T>(q)
      : ((await (d.orm as unknown as { execute(q: SQL): Promise<{ rows: T[] }> }).execute(q)).rows as T[]);

  it('adds nullable squad_id on missions, campaigns and trivia', async () => {
    db = await createTestDb();
    await db.migrate('jarvis', JARVIS_MIGRATIONS_DIR);
    const tables = ['jarvis_missions', 'jarvis_campaigns', 'jarvis_trivia_questions'] as const;
    for (const table of tables) {
      const cols = await rows<{ name: string }>(db, sql`pragma table_info(${sql.raw(table)})`);
      expect(cols.some((c) => c.name === 'squad_id')).toBe(true);
    }
  });
});
