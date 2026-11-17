import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addMember,
  CH,
  emit,
  events,
  messagesTo,
  playerCreated,
  servicesOf,
  setupHerbie,
  xpLedger,
} from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});
const cmd = (
  tc: TestContext,
  memberId: string,
  discordUserId: string,
  command: string,
  subcommand: string | null = null,
) =>
  emit(
    tc,
    'command.executed',
    {
      discordUserId,
      memberId,
      bot: command === 'perfil' || command === 'cerebro' ? 'cerebro' : 'jarvis',
      command,
      subcommand,
    },
    'core',
  );
const trivia = (tc: TestContext, memberId: string, n = 1) =>
  emit(
    tc,
    'trivia.answered',
    { memberId, attemptId: `att-${n}`, questionId: 'q', correct: false, msToAnswer: 1000 },
    'jarvis',
  );

describe('tutorial start and delivery', () => {
  it('sends one DM intro on player.created, even when the event is replayed', async () => {
    t = await setupHerbie();
    const m = await playerCreated(t, '111');
    const msgs = messagesTo(t, '111');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.via).toBe('dm');
    expect(msgs[0]?.msg.embeds?.[0]?.title).toBe('🤖 Oi! Eu sou o H.E.R.B.I.E.');
    expect(msgs[0]?.msg.embeds?.[0]?.description).toContain('Conheça seu mutante');
    // replay: the consumer runs again for the same member
    await servicesOf(t).tutorial.start({ id: m, discordUserId: '111' });
    expect(messagesTo(t, '111')).toHaveLength(1);
  });

  it('falls back to the tutorial channel on DM error 50007 and remembers it', async () => {
    t = await setupHerbie({ config: { channels: { welcome: CH.welcome, tutorial: CH.tutorial } } });
    t.gateway.closedDms.add('111');
    const m = await playerCreated(t, '111');
    expect(messagesTo(t, '111').map((x) => x.via)).toEqual([`channel:${CH.tutorial}`]);
    expect((await servicesOf(t).repo.progress(m))?.deliveryFallback).toBe(1);
    await cmd(t, m, '111', 'perfil');
    // the congrats goes straight to the channel (no second DM attempt)
    expect(t.gateway.callsOf('sendDm')).toHaveLength(1);
    expect(messagesTo(t, '111').at(-1)?.via).toBe(`channel:${CH.tutorial}`);
  });

  it('uses the welcome channel when there is no tutorial channel, and the channel always with delivery: channel', async () => {
    t = await setupHerbie({ config: { herbie: { delivery: 'channel' } } });
    await playerCreated(t, '111');
    expect(messagesTo(t, '111').map((x) => x.via)).toEqual([`channel:${CH.welcome}`]);
    expect(t.gateway.callsOf('sendDm')).toHaveLength(0);
  });

  it('sends nothing to members who left', async () => {
    t = await setupHerbie();
    const m = await playerCreated(t, '111');
    const { CerebroRepo } = await import('@legion/bot-cerebro');
    await new CerebroRepo(t.db, t.gateway.guildId, t.clock, t.runtime.newId).updateMember(m, {
      leftAt: t.clock.now().toISOString(),
    });
    await cmd(t, m, '111', 'perfil');
    expect(messagesTo(t, '111')).toHaveLength(1); // only the intro from before
  });
});

describe('tutorial steps and XP', () => {
  it('completes the chain in order and J.A.R.V.I.S. grants XP exactly once per step', async () => {
    t = await setupHerbie();
    const m = await playerCreated(t, '111');
    await trivia(t, m); // early: does not count
    expect(await servicesOf(t).repo.stepsDone(m)).toEqual([]);
    await cmd(t, m, '111', 'perfil');
    t.clock.advance(1000);
    const again = await cmd(t, m, '111', 'perfil');
    await trivia(t, m, 2);
    t.clock.advance(1000);
    await cmd(t, m, '111', 'cerebro', 'preferencias');
    const done = await servicesOf(t).repo.stepsDone(m);
    expect(done.map((d) => d.stepId)).toEqual(['perfil', 'primeira-trivia', 'preferencias']);
    expect((await servicesOf(t).repo.progress(m))?.status).toBe('completed');
    const quests = await events(t, 'quest.completed');
    expect(quests.map((q) => [q.questId, q.step, q.chainCompleted])).toEqual([
      ['boas-vindas:perfil', 0, false],
      ['boas-vindas:primeira-trivia', 1, false],
      ['boas-vindas:preferencias', 2, true],
    ]);
    const grants = await events(t, 'xp.grant_requested');
    expect(grants.map((g) => [g.amount, g.reason])).toEqual([
      [20, 'tutorial'],
      [30, 'tutorial'],
      [50, 'tutorial'],
      [50, 'tutorial'],
    ]);
    expect(grants.at(-1)?.sourceEventId).toBe(`tutorial:${m}:complete`);
    expect(grants.map((g) => g.sourceEventId)).not.toContain(again.id);
    // J.A.R.V.I.S. consumed every grant once (replaying the consumers changes nothing)
    await t.runtime.bus.replayPending();
    const tutorialXp = (await xpLedger(t, m)).filter(([r]) => r === 'grant');
    expect(tutorialXp.map(([, a]) => a)).toEqual([20, 30, 50, 50]);
    const last = messagesTo(t, '111').at(-1)?.msg.embeds?.[0]?.description ?? '';
    expect(last).toContain('🎉 Tutorial completo!');
    expect(last).toContain('Bônus de conclusão: +50 XP');
  });

  it('the same trigger event delivered twice completes the step once', async () => {
    t = await setupHerbie();
    const m = await playerCreated(t, '111');
    const e = await cmd(t, m, '111', 'perfil');
    await servicesOf(t).tutorial.onEvent(e);
    expect(await events(t, 'quest.completed')).toHaveLength(1);
    expect(await events(t, 'xp.grant_requested')).toHaveLength(1);
  });

  it('without J.A.R.V.I.S.: skips the trivia step, uses the fallback and hides XP', async () => {
    t = await setupHerbie({ jarvis: false });
    const m = await playerCreated(t, '111');
    await cmd(t, m, '111', 'perfil');
    await cmd(t, m, '111', 'cerebro', 'preferencias');
    expect((await servicesOf(t).repo.progress(m))?.status).toBe('completed');
    expect(await events(t, 'xp.grant_requested')).toEqual([]);
    expect(JSON.stringify(messagesTo(t, '111'))).not.toContain('XP');
  });
});

describe('/tutorial', () => {
  it('backfills members registered before H.E.R.B.I.E. and shows the checklist', async () => {
    t = await setupHerbie();
    const m = await addMember(t, '111');
    const id = await t.interact({ kind: 'command', userId: '111', commandName: 'tutorial' });
    const d = t.gateway.lastReply(id)?.embeds?.[0]?.description ?? '';
    expect(d).toContain('Progresso: 0 de 3');
    expect(d).toContain('▶️ Conheça seu mutante · +20 XP');
    expect(d).toContain('⬜ Primeira trivia');
    expect((await servicesOf(t).repo.progress(m))?.status).toBe('active');
  });

  it('skip asks to confirm; reiniciar continues without paying done steps again', async () => {
    t = await setupHerbie();
    const m = await playerCreated(t, '111');
    await cmd(t, m, '111', 'perfil');
    const ask = await t.interact({ kind: 'component', userId: '111', customId: 'herbie:v1:skip' });
    expect(t.gateway.lastReply(ask)?.content).toContain('Tem certeza?');
    await t.interact({ kind: 'component', userId: '111', customId: 'herbie:v1:skip-confirm' });
    expect((await servicesOf(t).repo.progress(m))?.status).toBe('skipped');
    await trivia(t, m);
    expect((await servicesOf(t).repo.stepsDone(m)).map((s) => s.stepId)).toEqual(['perfil']);
    const r = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'tutorial',
      options: { reiniciar: true },
    });
    expect(t.gateway.lastReply(r)?.embeds?.[0]?.description).toContain('✅ Conheça seu mutante');
    await trivia(t, m, 2);
    expect((await events(t, 'xp.grant_requested')).map((g) => g.amount)).toEqual([20, 30]);
  });

  it('refuses unregistered members', async () => {
    t = await setupHerbie();
    t.gateway.addMember({ userId: '222' });
    const id = await t.interact({ kind: 'command', userId: '222', commandName: 'tutorial' });
    expect(t.gateway.lastReply(id)?.content).toBe(
      `Bip! Você ainda não é um mutante registrado. Comece pelo canal <#${CH.welcome}>.`,
    );
  });
});

describe('tutorial content', () => {
  it('a server file overrides the bundled chain; an invalid one keeps the previous chain', async () => {
    t = await setupHerbie();
    const tut = servicesOf(t).tutorial;
    const dir = mkdtempSync(join(tmpdir(), 'herbie-'));
    writeFileSync(
      join(dir, 'tutorial.yaml'),
      'chain: curto\nsteps:\n  - id: so-perfil\n    titleKey: herbie.quest.perfil.title\n    bodyKey: herbie.quest.perfil.body\n    trigger: { event: command.executed, where: { command: perfil } }\n    rewardXp: 5\n',
    );
    expect(tut.reload(dir)).toEqual([]);
    expect(tut.steps().map((s) => s.id)).toEqual(['so-perfil']);
    writeFileSync(join(dir, 'tutorial.yaml'), 'chain: curto\nsteps:\n  - id: X!\n    rewardXp: -1\n');
    const errors = tut.reload(dir);
    expect(errors[0]).toMatch(/tutorial\.yaml → steps\.0\.id: /);
    // the previous (valid) server chain stays loaded
    expect(tut.chainId).toBe('curto');
    expect(tut.steps().map((s) => s.id)).toEqual(['so-perfil']);
  });
});
