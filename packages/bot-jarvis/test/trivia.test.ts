import { cerebro } from '@legion/bot-cerebro';
import { CoreRuntime, FakeRandomSource, mulberry32, silentLogger, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { jarvis, pickQuestion, shuffledOrder } from '../src/index.js';
import { addMember, answerIndex, events, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});
const U = '111';
const ask = (tc: TestContext, categoria?: string) =>
  tc.interact({ kind: 'command', userId: U, commandName: 'trivia', options: categoria ? { categoria } : {} });

describe('question selection', () => {
  const qs = ['a', 'b', 'c'].map((id) => ({ id }));
  const now = new Date('2026-11-16T15:00:00.000Z');
  it('skips questions seen within noRepeatDays', () => {
    const seen = new Map([
      ['a', '2026-11-10T00:00:00.000Z'],
      ['b', '2026-11-15T00:00:00.000Z'],
    ]);
    for (let s = 0; s < 20; s++) expect(pickQuestion(qs, seen, now, 30, mulberry32(s))?.id).toBe('c');
  });
  it('falls back to the least recently seen', () => {
    const seen = new Map([
      ['a', '2026-11-12T00:00:00.000Z'],
      ['b', '2026-11-01T00:00:00.000Z'],
      ['c', '2026-11-15T00:00:00.000Z'],
    ]);
    expect(pickQuestion(qs, seen, now, 30, mulberry32(1))?.id).toBe('b');
  });
  it('is deterministic for a seed and shuffles all choices', () => {
    expect(pickQuestion(qs, new Map(), now, 30, mulberry32(7))).toEqual(
      pickQuestion(qs, new Map(), now, 30, mulberry32(7)),
    );
    expect(shuffledOrder(4, mulberry32(3))).toEqual(shuffledOrder(4, mulberry32(3)));
    expect([...shuffledOrder(4, mulberry32(3))].sort()).toEqual([0, 1, 2, 3]);
    expect(pickQuestion([], new Map(), now, 30, mulberry32(1))).toBeNull();
  });
});

describe('/trivia', () => {
  it('refuses unregistered members', async () => {
    t = await setupJarvis({ channels: { welcome: '300000000000000001' } });
    t.gateway.addMember({ userId: U });
    const id = await ask(t);
    expect(t.gateway.lastReply(id)?.content).toBe(
      'Você ainda não é um herói registrado. Comece pelo canal <#300000000000000001>.',
    );
  });

  it('asks an ephemeral question with 4 buttons and pays XP for a right answer', async () => {
    t = await setupJarvis();
    const m = await addMember(t, U);
    const id = await ask(t, 'quadrinhos');
    const q = t.gateway.lastReply(id);
    expect(q?.ephemeral).toBe(true);
    expect(q?.embeds?.[0]?.title).toBe('🧠 Trivia de Quadrinhos');
    expect(q?.components?.[0]).toHaveLength(4);
    const { customId, attemptId, question } = await answerIndex(t, id, true);
    t.clock.advance(4_000); // 16 s of 20 left → speed bonus floor(5 * 16/20) = 4
    const a = await t.interact({ kind: 'component', userId: U, customId });
    const base = { facil: 10, normal: 15, dificil: 25 }[question?.difficulty as 'facil'];
    const res = t.gateway.lastReply(a);
    expect(t.gateway.repliesTo(a)[0]?.kind).toBe('updateMessage');
    expect(res?.embeds?.[0]?.description).toContain('✅ Correto!');
    expect(res?.embeds?.[0]?.description).toContain(`+${base + 4} XP`);
    expect(res?.embeds?.[0]?.description).toContain('🔥 Sequência de 1 dia(s): +5 XP de bônus');
    expect(await t.runtime.providers.readModels().progress.get(m)).toMatchObject({ xp: base + 4 + 5 });
    expect(await events(t, 'trivia.answered')).toEqual([
      { memberId: m, attemptId, questionId: question?.id, correct: true, msToAnswer: 4000 },
    ]);
  });

  it('a wrong answer gives 0 XP, shows the right answer, and does not count for the streak', async () => {
    t = await setupJarvis();
    const m = await addMember(t, U);
    const id = await ask(t);
    const { customId, question } = await answerIndex(t, id, false);
    const a = await t.interact({ kind: 'component', userId: U, customId });
    const choices = JSON.parse(question?.choices ?? '[]') as string[];
    expect(t.gateway.lastReply(a)?.embeds?.[0]?.description).toContain(
      `Resposta certa: **${choices[question?.answerIndex ?? 0]}**`,
    );
    expect(await servicesOf(t).repo.ledgerFor(m)).toEqual([]);
    expect(await events(t, 'trivia.answered')).toHaveLength(1);
  });

  it('double clicks and replays show the stored result and never pay twice', async () => {
    t = await setupJarvis();
    const m = await addMember(t, U);
    const id = await ask(t);
    const { customId, display, attemptId } = await answerIndex(t, id, true);
    await t.interact({ kind: 'component', userId: U, customId });
    const xp = (await servicesOf(t).repo.progress(m))?.xp;
    const other = `jarvis:v1:trivia:${attemptId}:${(display + 1) % 4}`;
    const again = await t.interact({ kind: 'component', userId: U, customId: other });
    expect(t.gateway.lastReply(again)?.embeds?.[0]?.description).toContain('✅ Correto!');
    expect((await servicesOf(t).repo.progress(m))?.xp).toBe(xp);
    expect(await events(t, 'trivia.answered')).toHaveLength(1);
  });

  it('applies the cooldown and shows an open question again instead of a new one', async () => {
    t = await setupJarvis();
    await addMember(t, U);
    const first = await ask(t);
    const again = await ask(t);
    expect(t.gateway.lastReply(again)?.embeds?.[0]?.description).toBe(
      t.gateway.lastReply(first)?.embeds?.[0]?.description,
    );
    const { customId } = await answerIndex(t, first, true);
    await t.interact({ kind: 'component', userId: U, customId });
    t.clock.advance(5_000);
    const early = await t.interact({ kind: 'component', userId: U, customId: 'jarvis:v1:trivia-next' });
    expect(t.gateway.lastReply(early)?.content).toMatch(/^Calma, agente\. Próxima pergunta em \d+s\.$/);
    t.clock.advance(30_000);
    const next = await t.interact({ kind: 'component', userId: U, customId: 'jarvis:v1:trivia-next' });
    expect(t.gateway.lastReply(next)?.components?.[0]).toHaveLength(4);
  });

  it('expires after the time limit with 0 XP', async () => {
    t = await setupJarvis();
    const m = await addMember(t, U);
    const id = await ask(t);
    const { customId } = await answerIndex(t, id, true);
    t.clock.advance(21_000);
    const a = await t.interact({ kind: 'component', userId: U, customId });
    expect(t.gateway.lastReply(a)?.embeds?.[0]?.description).toContain('⏱️ Tempo esgotado.');
    expect((await servicesOf(t).repo.progress(m))?.xp ?? 0).toBe(0);
    expect(await events(t, 'trivia.answered')).toHaveLength(0);
  });

  it("refuses someone else's question", async () => {
    t = await setupJarvis();
    await addMember(t, U);
    await addMember(t, '222');
    const id = await ask(t);
    const { customId } = await answerIndex(t, id, true);
    const x = await t.interact({ kind: 'component', userId: '222', customId });
    expect(t.gateway.lastReply(x)?.content).toBe('Esta pergunta é de outra pessoa. Use /trivia para a sua.');
  });

  it('stops paying at the daily cap but still counts the day for the streak', async () => {
    t = await setupJarvis({ jarvis: { trivia: { dailyXpCap: 12, cooldownSeconds: 1 } } });
    const m = await addMember(t, U);
    const s = servicesOf(t);
    for (let k = 0; k < 2; k++) {
      const id = await ask(t);
      const { customId } = await answerIndex(t, id, true);
      await t.interact({ kind: 'component', userId: U, customId });
      t.clock.advance(2_000);
    }
    const ledger = (await s.repo.ledgerFor(m)).filter((l) => l.reason === 'trivia').map((l) => l.amount);
    expect(ledger.reduce((a, b) => a + b, 0)).toBe(12);
    // next day: first answer is above nothing (cap resets) — and a capped-only day still counts
    t.clock.advance(24 * 3600_000);
    await s.repo.updateProgress(m, { triviaXpToday: 12, triviaXpDay: s.xp.today() }); // already capped today
    const id = await ask(t);
    const { customId } = await answerIndex(t, id, true);
    const a = await t.interact({ kind: 'component', userId: U, customId });
    expect(t.gateway.lastReply(a)?.embeds?.[0]?.description).toContain(
      'Você já ganhou o máximo de XP de trivia hoje (12)',
    );
    expect((await s.repo.progress(m))?.currentStreak).toBe(2);
  });

  it('survives a restart mid-question: the answer still works and nothing is duplicated', async () => {
    t = await setupJarvis();
    const m = await addMember(t, U);
    const id = await ask(t);
    const { customId } = await answerIndex(t, id, true);
    // a new process on the same DB and Discord
    const rt = new CoreRuntime({
      config: t.config,
      db: t.db,
      gateway: t.gateway,
      clock: t.clock,
      random: new FakeRandomSource(9),
      log: silentLogger(),
      guildId: t.gateway.guildId,
      roleGuard: 'throw',
    });
    await rt.loadBots([cerebro, jarvis]);
    const base = {
      guildId: t.gateway.guildId,
      channelId: 'c',
      userId: U,
      memberRoleIds: [],
      isGuildOwner: false,
      locale: null,
    };
    await rt.router.handle({ ...base, id: 'r1', kind: 'component', customId });
    await rt.router.handle({ ...base, id: 'r2', kind: 'component', customId });
    await rt.bus.drain();
    expect(t.gateway.lastReply('r1')?.embeds?.[0]?.description).toContain('✅ Correto!');
    expect(await events(t, 'trivia.answered')).toHaveLength(1);
    expect((await servicesOf(t).repo.ledgerFor(m)).filter((l) => l.reason === 'trivia')).toHaveLength(1);
    // the bundled content reload on the second boot changed nothing
    expect((await servicesOf(t).repo.allQuestions()).filter((q) => q.active === 1)).toHaveLength(30);
  });

  it('end to end: /trivia → right answer → rank up → Cérebro gives the Agente role', async () => {
    t = await setupJarvis();
    await t.runtime.ready({ startPolling: false });
    const m = await addMember(t, U);
    await servicesOf(t).repo.ensureProgress(m);
    await servicesOf(t).repo.updateProgress(m, { xp: 495, rank: 'recruta', level: 4 });
    const id = await ask(t);
    const { customId } = await answerIndex(t, id, true);
    await t.interact({ kind: 'component', userId: U, customId });
    expect((await events(t, 'rank.changed')).map((e) => `${e.from}>${e.to}`)).toEqual(['recruta>agente']);
    expect(t.gateway.memberRoleNames(U)).toContain('Agente');
    expect(t.gateway.memberRoleNames(U)).not.toContain('Recruta');
  });

  it('says so when a category has no questions', async () => {
    t = await setupJarvis({ jarvis: { trivia: { categories: ['quadrinhos', 'rivals', 'geral', 'vazia'] } } });
    await addMember(t, U);
    const id = await ask(t, 'vazia');
    expect(t.gateway.lastReply(id)?.content).toBe(
      'Não há perguntas disponíveis (vazia) agora. Avise a staff.',
    );
  });
});
