import { cerebroTables } from '@legion/bot-cerebro';
import type { TestContext } from '@legion/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { contentHash } from '../src/content.js';
import { parseMissionYaml } from '../src/domain/mission.js';
import { missionColumns } from '../src/mission-content.js';
import { addMember, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const A = '111';
const B = '222';
const MISSION_YAML = `
id: squad-patrol
kind: daily
title: Patrulha da Noite
summary: Só o esquadrão Noite.
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

async function seat(
  tc: TestContext,
  memberId: string,
  squad: { id: string; name: string; code: string; faction: string; founder: string },
) {
  const tables = cerebroTables(tc.db);
  const now = tc.clock.now().toISOString();
  const [existing] = await tc.db.orm
    .select({ id: tables.cerebroSquads.id })
    .from(tables.cerebroSquads)
    .where(eq(tables.cerebroSquads.id, squad.id));
  if (!existing) {
    await tc.db.orm.insert(tables.cerebroSquads).values({
      id: squad.id,
      guildId: tc.gateway.guildId,
      name: squad.name,
      nameKey: squad.name.toLowerCase(),
      baseFaction: squad.faction,
      founderMemberId: squad.founder,
      status: 'active',
      code: squad.code,
      requestedAt: now,
      decidedAt: now,
      decidedBy: 'staff',
    });
  }
  await tc.db.orm
    .insert(tables.cerebroSquadMembers)
    .values({ memberId, squadId: squad.id, joinedAt: now, via: 'founder' })
    .onConflictDoNothing();
}

async function world() {
  t = await setupJarvis({ squads: { enabled: true } });
  const a = await addMember(t, A, 'avengers', 'AgenteA');
  const b = await addMember(t, B, 'avengers', 'AgenteB');
  await seat(t, a, {
    id: 'sq-noite',
    name: 'Noite',
    code: 'NOITE1',
    faction: 'avengers',
    founder: a,
  });
  return { t, a, b, s: servicesOf(t) };
}

const list = (tc: TestContext, userId: string) =>
  tc.interact({ kind: 'command', userId, commandName: 'missao', subcommand: 'lista' });
const start = (tc: TestContext, userId: string, missao: string) =>
  tc.interact({
    kind: 'command',
    userId,
    commandName: 'missao',
    subcommand: 'iniciar',
    options: { missao },
  });
const reply = (tc: TestContext, id: string) => tc.gateway.lastReply(id);

describe('squad content visibility', () => {
  it('hides a squad mission from outsiders and shows it to seated members', async () => {
    const { t: tc, s } = await world();
    const parsed = parseMissionYaml(MISSION_YAML);
    if ('errors' in parsed) throw new Error(parsed.errors.join('; '));
    const now = tc.clock.now().toISOString();
    await tc.db.orm.insert(s.repo.t.jarvisMissions).values({
      id: parsed.mission.id,
      ...missionColumns(parsed.mission),
      active: 1,
      updatedAt: now,
      origin: 'staff',
      importedBy: 'staff',
      disabledBy: null,
      squadId: 'sq-noite',
    });
    await tc.db.orm.insert(s.repo.t.jarvisMissions).values({
      id: 'open-patrol',
      ...missionColumns({ ...parsed.mission, id: 'open-patrol', title: { 'pt-BR': 'Patrulha aberta' } }),
      active: 1,
      updatedAt: now,
      origin: 'staff',
      importedBy: 'staff',
      disabledBy: null,
      squadId: null,
    });

    const listA = await list(tc, A);
    const listB = await list(tc, B);
    expect(
      reply(tc, listA)
        ?.embeds?.[0]?.fields?.map((f) => f.name)
        .join('\n'),
    ).toMatch(/Patrulha da Noite/);
    expect(
      reply(tc, listB)
        ?.embeds?.[0]?.fields?.map((f) => f.name)
        .join('\n') ?? '',
    ).not.toMatch(/Patrulha da Noite/);
    expect(
      reply(tc, listA)
        ?.embeds?.[0]?.fields?.map((f) => f.name)
        .join('\n'),
    ).toMatch(/Patrulha aberta/);
    expect(
      reply(tc, listB)
        ?.embeds?.[0]?.fields?.map((f) => f.name)
        .join('\n'),
    ).toMatch(/Patrulha aberta/);

    const startA = await start(tc, A, 'squad-patrol');
    expect(reply(tc, startA)?.content).toMatch(/Missão iniciada/);
    const startB = await start(tc, B, 'squad-patrol');
    expect(reply(tc, startB)?.content).toMatch(/Não encontrei essa missão/);
  });

  it('excludes squad trivia from outsiders while keeping global questions', async () => {
    const { t: tc, s } = await world();
    const now = tc.clock.now().toISOString();
    const q = {
      id: 'squad-q-1',
      locale: 'pt-BR',
      category: 'geral',
      difficulty: 'facil',
      question: 'Pergunta do esquadrão?',
      choices: JSON.stringify(['a', 'b']),
      answerIndex: 0,
      explanation: 'Porque sim.',
      source: 'https://example.com',
      contentHash: contentHash({
        id: 'squad-q-1',
        category: 'geral',
        difficulty: 'facil',
        question: 'Pergunta do esquadrão?',
        choices: ['a', 'b'],
        answer: 0,
        explanation: 'Porque sim.',
        source: 'https://example.com',
      }),
      active: 1,
      updatedAt: now,
      origin: 'staff',
      review: 'approved',
      createdBy: 'staff',
      reviewedBy: null,
      squadId: 'sq-noite',
    };
    await tc.db.orm.insert(s.repo.t.jarvisTriviaQuestions).values(q);

    // Only the squad question stays active in geral/pt-BR.
    const others = (await s.repo.activeQuestions('pt-BR', 'geral')).filter((x) => x.id !== q.id);
    for (const o of others) {
      await tc.db.orm
        .update(s.repo.t.jarvisTriviaQuestions)
        .set({ active: 0 })
        .where(eq(s.repo.t.jarvisTriviaQuestions.id, o.id));
    }

    const ask = (userId: string) =>
      tc.interact({ kind: 'command', userId, commandName: 'trivia', options: { categoria: 'geral' } });
    const aId = await ask(A);
    expect(JSON.stringify(reply(tc, aId))).toMatch(/Pergunta do esquadrão/);
    const bId = await ask(B);
    expect(reply(tc, bId)?.content).toMatch(/Não há perguntas/);
  });
});
