import { combatMissionId, jarvis, jarvisDoctorChecks, jarvisServices } from '@legion/bot-jarvis';
import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { addMember, CH, emit, events, servicesOf, setupUltron } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const MISSIONS = '300000000000000020';
const U = '111';

async function setup(config: Record<string, unknown> = {}) {
  t = await setupUltron({ config: { channels: { missions: MISSIONS }, ...config } });
  t.gateway.addChannel({ id: MISSIONS, name: 'missoes', kind: 'text', parentId: null });
  const memberId = await addMember(t, U);
  return { t, memberId, js: jarvisServices(t.ctxOf(jarvis)) };
}

const buttons = (tc: TestContext) =>
  (
    tc.gateway.messages.filter((m) => m.msg.persona === 'jarvis' && m.msg.components?.[0]?.length).at(-1)?.msg
      .components?.[0] ?? []
  ).map((b) => ('customId' in b ? (b.customId ?? '') : ''));

/** Starts "primeiro-contato" and walks into its fight. Returns the run. */
async function intoFight(tc: TestContext, js: ReturnType<typeof jarvisServices>, memberId: string) {
  await tc.interact({
    kind: 'command',
    userId: U,
    commandName: 'missao',
    subcommand: 'iniciar',
    options: { missao: 'primeiro-contato' },
  });
  await tc.interact({ kind: 'component', userId: U, customId: buttons(tc)[0] ?? '' });
  const [run] = await js.repo.runsOf(memberId);
  return run;
}

const missionXp = async (js: ReturnType<typeof jarvisServices>, memberId: string) =>
  (await js.repo.ledgerFor(memberId)).filter((l) => l.reason === 'mission').map((l) => l.amount);

describe('J.A.R.V.I.S. mission fights through ULTRON and Sentinel', () => {
  it('a combat scene spawns one encounter in the mission thread and the lose branch continues the story', async () => {
    const { t, memberId, js } = await setup();
    const run = await intoFight(t, js, memberId);
    expect(run).toMatchObject({ status: 'fighting', sceneId: 'confronto' });
    const mid = combatMissionId(run?.id ?? '', 'confronto');
    const started = (await events(t, 'mission.started')).filter((e) => e.missionType === 'combat');
    expect(started).toEqual([
      expect.objectContaining({
        missionId: mid,
        memberIds: [memberId],
        difficulty: 'facil',
        channelId: run?.threadId,
      }),
    ]);
    // ULTRON spawns once even when the event is delivered twice.
    await emit(t, 'mission.started', started[0] as never);
    const enc = await servicesOf(t).repo.encounterByMission(mid);
    expect(enc).not.toBeNull();
    const reqs = (await events(t, 'combat.requested')).filter((r) => r.missionId === mid);
    expect(reqs).toHaveLength(1);
    // Sentinel stays in the mission thread (a thread cannot hold another thread).
    expect(
      t.gateway.messages.some((m) => m.channelId === run?.threadId && m.msg.persona === 'sentinel'),
    ).toBe(true);

    // Nobody acts: Sentinel's round timer ends the fight for the enemies.
    for (let n = 0; n < 4; n++) {
      t.clock.advance(46_000);
      await t.settle();
    }
    const [res] = (await events(t, 'combat.resolved')).filter((r) => r.missionId === mid);
    expect(res?.winnerSide).toBe('enemies');
    const done = await js.repo.run(run?.id ?? '');
    expect(done).toMatchObject({ status: 'failure', sceneId: 'derrota' });
    expect(await missionXp(js, memberId)).toEqual([20]);
    // Sentinel's own "fight over" message may land after the story (separate consumers), so look in the thread.
    const story = t.gateway.messages.filter((m) => m.channelId === run?.threadId);
    expect(story.some((m) => /A unidade escapa/.test(m.msg.embeds?.[0]?.description ?? ''))).toBe(true);

    // A duplicate result changes nothing.
    await emit(t, 'combat.resolved', res as never, 'sentinel');
    expect(await missionXp(js, memberId)).toEqual([20]);
    expect((await events(t, 'mission.completed')).filter((e) => e.missionId === run?.id)).toHaveLength(1);
  });

  it('a players win takes the win branch, once', async () => {
    const { t, memberId, js } = await setup();
    const run = await intoFight(t, js, memberId);
    const mid = combatMissionId(run?.id ?? '', 'confronto');
    const win = {
      combatId: 'c-win',
      requestedBy: 'ultron' as const,
      mode: 'duel' as const,
      missionId: mid,
      raidId: null,
      seed: 1,
      winnerSide: 'players' as const,
      rounds: 3,
      damageBySide: { players: 50, enemies: 10 },
      survivors: [`player:${memberId}`],
      logHash: 'x',
    };
    await emit(t, 'combat.resolved', win, 'sentinel');
    await emit(t, 'combat.resolved', win, 'sentinel');
    expect(await js.repo.run(run?.id ?? '')).toMatchObject({ status: 'success', sceneId: 'vitoria' });
    expect(await missionXp(js, memberId)).toEqual([80]);
  });

  it('no fight result within combatTimeoutMinutes → failure; a late result is ignored', async () => {
    const { t, memberId, js } = await setup({ jarvis: { missions: { combatTimeoutMinutes: 1 } } });
    const run = await intoFight(t, js, memberId);
    // Hold Sentinel's rounds: only the mission timer is due.
    const mid = combatMissionId(run?.id ?? '', 'confronto');
    t.clock.advance(61_000);
    await js.missions.onTimeout({
      runId: run?.id ?? '',
      version: (await js.repo.run(run?.id ?? ''))?.version ?? -1,
    });
    expect((await js.repo.run(run?.id ?? ''))?.status).toBe('failure');
    expect(
      t.gateway.messages.some((m) => m.msg.embeds?.[0]?.description?.includes('não terminou a tempo')),
    ).toBe(true);
    await emit(
      t,
      'combat.resolved',
      {
        combatId: 'late',
        requestedBy: 'ultron',
        mode: 'duel',
        missionId: mid,
        raidId: null,
        seed: 1,
        winnerSide: 'players',
        rounds: 1,
        damageBySide: { players: 1, enemies: 0 },
        survivors: [],
        logHash: 'x',
      },
      'sentinel',
    );
    expect((await js.repo.run(run?.id ?? ''))?.status).toBe('failure');
    expect(await missionXp(js, memberId)).toEqual([20]);
  });

  it('a restart during a fight posts the fight scene once and keeps waiting for the result', async () => {
    const { t, memberId, js } = await setup();
    const run = await intoFight(t, js, memberId);
    await js.repo.markRun(run?.id ?? '', { postedScene: 'alerta' });
    const count = () =>
      t.gateway.messages.filter((m) => m.msg.embeds?.[0]?.footer?.text?.startsWith('⚔️')).length;
    const before = count();
    await js.missions.recover();
    await js.missions.recover();
    expect(count()).toBe(before + 1);
    expect((await js.repo.run(run?.id ?? ''))?.status).toBe('fighting');
    expect((await events(t, 'mission.started')).filter((e) => e.missionType === 'combat')).toHaveLength(1);
  });

  it('fight missions are listed when ULTRON and Sentinel run, hidden (with a doctor warning) when not', async () => {
    const { t } = await setup();
    const id = await t.interact({ kind: 'command', userId: U, commandName: 'missao', subcommand: 'lista' });
    const names = (t.gateway.lastReply(id)?.embeds?.[0]?.fields ?? []).map((f) => f.name);
    expect(names).toContain('Primeiro contato · História');
    const ok = await jarvisDoctorChecks(t.ctxOf(jarvis))[0]?.run();
    expect(ok?.status).toBe('ok');
  });
});

describe('without ULTRON and Sentinel', () => {
  it('hides fight missions and doctor warns', async () => {
    const { createTestContext } = await import('@legion/core');
    const { cerebro } = await import('@legion/bot-cerebro');
    t = await createTestContext({ bots: [cerebro, jarvis], config: { channels: { combat: CH.combat } } });
    const s = jarvisServices(t.ctxOf(jarvis));
    expect((await s.missions.missions()).map((m) => m.id).sort()).toEqual([
      'patrulha-noturna',
      'sinal-fantasma',
    ]);
    const res = await jarvisDoctorChecks(t.ctxOf(jarvis))[0]?.run();
    expect(res).toMatchObject({ status: 'warn' });
    expect(res?.message).toMatch(/2 missão\(ões\) com luta ficam escondidas/);
  });
});
