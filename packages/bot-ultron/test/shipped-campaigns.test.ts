import { CerebroRepo, cerebro } from '@legion/bot-cerebro';
import {
  type Campaign,
  campaignDirs,
  jarvis,
  jarvisServices,
  type Mission,
  missionDirs,
  readContent,
} from '@legion/bot-jarvis';
import { sentinel, sentinelServices } from '@legion/bot-sentinel';
import { type AnyLegionBot, createTestContext, type TestContext } from '@legion/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { ultron } from '../src/index.js';
import { CH, events } from './helpers.js';

/**
 * D16: every campaign that ships with Legion is played to the end in the harness, with every bot.
 * Choices follow a path to a success ending; fights run through ULTRON and Sentinel with real
 * button clicks, and a lost fight is played again (campaign chapters can be retried until won).
 * Recruitment arcs must put the hero on their team.
 */
let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const U = '111';
const MISSIONS = '300000000000000020';
const shipped = readContent(missionDirs('/nonexistent'), campaignDirs('/nonexistent'));
const campaigns = shipped.campaigns ?? [];
const chaptersOf = (c: Campaign) =>
  shipped.missions
    .filter((m) => m.campaign?.id === c.id)
    .sort((a, b) => (a.campaign?.chapter ?? 0) - (b.campaign?.chapter ?? 0));

async function setup() {
  const bots: AnyLegionBot[] = [cerebro, jarvis, sentinel, ultron];
  t = await createTestContext({
    bots,
    config: { channels: { welcome: CH.welcome, combat: CH.combat, events: CH.events, missions: MISSIONS } },
  });
  for (const [id, name] of [
    [CH.combat, 'combate'],
    [CH.events, 'eventos'],
    [MISSIONS, 'missoes'],
  ] as const)
    t.gateway.addChannel({ id, name, kind: 'text', parentId: null });
  await t.runtime.ready({ startPolling: false }); // Cérebro creates the team roles
  return t;
}

/** A registered Independente hero at `level`. */
async function hero(tc: TestContext, originType = 'mutante', level = 3) {
  tc.gateway.addMember({ userId: U });
  const repo = new CerebroRepo(tc.db, tc.gateway.guildId, tc.clock, tc.runtime.newId);
  const { row } = await repo.ensureMember(U);
  await repo.updateMember(row.id, { onboardingStep: 'registered', faction: 'independent' });
  await repo.insertMutant({
    memberId: row.id,
    codename: 'Faísca',
    codenameNormalized: 'faisca',
    power: 'Raios',
    archetype: 'Elemental',
    origin: 'o',
    originType,
  });
  const js = jarvisServices(tc.ctxOf(jarvis));
  await js.repo.ensureProgress(row.id);
  await tc.db.orm
    .update(js.repo.t.jarvisProgress)
    .set({ level })
    .where(eq(js.repo.t.jarvisProgress.memberId, row.id));
  return row.id;
}

/** The choice index to take in `sceneId` on a shortest path to a success ending (fights won). */
export function successChoice(m: Mission, sceneId: string): number {
  const dist = new Map<string, number>();
  const ends = Object.entries(m.scenes).filter(([, s]) => s.end === 'success');
  for (const [id] of ends) dist.set(id, 0);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [id, s] of Object.entries(m.scenes)) {
      const nexts = s.choices?.map((c) => c.next) ?? (s.combat ? [s.combat.win] : []);
      const best = Math.min(...nexts.map((n) => (dist.get(n) ?? Infinity) + 1));
      if (best < (dist.get(id) ?? Infinity)) {
        dist.set(id, best);
        changed = true;
      }
    }
  }
  const choices = m.scenes[sceneId]?.choices ?? [];
  let pick = -1;
  for (const [i, c] of choices.entries())
    if (pick < 0 || (dist.get(c.next) ?? Infinity) < (dist.get(choices[pick]?.next ?? '') ?? Infinity))
      pick = i;
  if (pick < 0 || !Number.isFinite(dist.get(choices[pick]?.next ?? '') ?? Infinity))
    throw new Error(`${m.id}: no path to success from ${sceneId}`);
  return pick;
}

const jarvisButtons = (tc: TestContext) =>
  (
    tc.gateway.messages.filter((x) => x.msg.persona === 'jarvis' && x.msg.components?.length).at(-1)?.msg
      .components?.[0] ?? []
  ).map((b) => ('customId' in b ? (b.customId ?? '') : ''));

/** Fights for real until Sentinel resolves the combat of this run. */
async function fight(tc: TestContext, runId: string) {
  const s = sentinelServices(tc.ctxOf(sentinel));
  const req = (await events(tc, 'combat.requested')).filter((r) => r.missionId.startsWith(runId)).at(-1);
  const combatId = req?.combatId ?? '';
  for (let n = 0; n < 40; n++) {
    const c = await s.repo.combat(combatId);
    if (c?.status !== 'active') return;
    for (const action of ['power', 'attack'])
      await tc.interact({
        kind: 'component',
        userId: U,
        customId: `sentinel:v1:act:${combatId}:${c.round + 1}:${action}`,
      });
    await tc.settle();
    tc.clock.advance(1_000);
  }
  throw new Error(`combat ${combatId} did not end`);
}

/** Plays one chapter once; returns the run's final status. */
async function playChapter(tc: TestContext, memberId: string, m: Mission): Promise<string> {
  const js = jarvisServices(tc.ctxOf(jarvis));
  const started = await tc.interact({
    kind: 'command',
    userId: U,
    commandName: 'missao',
    subcommand: 'iniciar',
    options: { missao: m.id },
  });
  await tc.settle();
  let [run] = await js.repo.runsOf(memberId, ['lobby', 'active', 'fighting']);
  if (!run) throw new Error(`${m.id} did not start: ${tc.gateway.lastReply(started)?.content}`);
  if (run.status === 'lobby') {
    const lobby = tc.gateway.messages
      .filter((x) => x.msg.persona === 'jarvis' && x.msg.components?.length)
      .at(-1);
    const start = (lobby?.msg.components?.[0] ?? [])
      .map((b) => ('customId' in b ? (b.customId ?? '') : ''))
      .find((c) => c.endsWith('start'));
    await tc.interact({ kind: 'component', userId: U, customId: start ?? '' });
    await tc.settle();
  }
  for (let step = 0; step < 30; step++) {
    run = (await js.repo.run(run.id)) ?? run;
    if (run.status === 'fighting') await fight(tc, run.id);
    else if (run.status === 'active') {
      const pick = successChoice(m, run.sceneId);
      await tc.interact({ kind: 'component', userId: U, customId: jarvisButtons(tc)[pick] ?? '' });
      await tc.settle();
    } else return run.status;
    tc.clock.advance(1_000);
  }
  throw new Error(`${m.id} did not end`);
}

describe('shipped campaigns (D16)', () => {
  it('ships the tutorial, the 8 recruitment arcs and story campaigns, all valid', () => {
    expect(shipped.errors).toEqual([]);
    expect(shipped.warnings ?? []).toEqual([]);
    const recruit = campaigns.filter((c) => c.kind === 'recruitment');
    expect(recruit.map((c) => c.faction).sort()).toEqual(
      [
        'avengers',
        'brotherhood',
        'defenders',
        'guardians',
        'midnight_sons',
        'shield',
        'thunderbolts',
        'xmen',
      ].sort(),
    );
    for (const c of recruit) {
      const ch = chaptersOf(c);
      expect(ch.length, c.id).toBeGreaterThanOrEqual(3);
      expect(ch.length, c.id).toBeLessThanOrEqual(4);
      expect(ch[0]?.requires?.level, c.id).toBe(3);
      expect(ch.at(-1)?.reward?.joinFaction, c.id).toBe(c.faction);
      expect(
        ch.some((m) => Object.values(m.scenes).some((s) => s.combat)),
        c.id,
      ).toBe(true);
    }
    for (const m of shipped.missions)
      for (const [id, s] of Object.entries(m.scenes)) {
        expect(typeof s.text === 'object' && s.text.en, `${m.id}.${id}`).toBeTruthy();
        for (const c of s.choices ?? [])
          expect(typeof c.label === 'object' && c.label.en, `${m.id}.${id}`).toBeTruthy();
      }
  });

  it.each(campaigns.map((c) => [c.id, c] as const))('%s is played to the end', async (_id, c) => {
    const tc = await setup();
    const memberId = await hero(tc);
    for (const m of chaptersOf(c)) {
      let status = '';
      for (let attempt = 0; attempt < 6 && status !== 'success'; attempt++) {
        status = await playChapter(tc, memberId, m);
        tc.clock.advance(60_000);
      }
      expect(status, m.id).toBe('success');
    }
    const repo = new CerebroRepo(tc.db, tc.gateway.guildId, tc.clock, tc.runtime.newId);
    if (c.kind === 'recruitment') {
      expect((await repo.memberByDiscordId(U))?.faction).toBe(c.faction);
      const changed = await events(tc, 'player.faction_changed');
      expect(changed.map((e) => [e.reason, e.to])).toEqual([['arc', c.faction]]);
    } else expect((await repo.memberByDiscordId(U))?.faction).toBe('independent');
  });

  it('the Irmandade arc stays locked for an origin the team does not take', async () => {
    const tc = await setup();
    await hero(tc, 'tecnologia');
    const id = await tc.interact({
      kind: 'command',
      userId: U,
      commandName: 'missao',
      subcommand: 'iniciar',
      options: { missao: 'convite-no-metro-1' },
    });
    expect(tc.gateway.lastReply(id)?.content).toMatch(/Bloqueada: falta ser de origem Mutante, Inumano/);
  });
});
