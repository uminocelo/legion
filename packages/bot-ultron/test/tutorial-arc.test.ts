import { CerebroRepo, cerebro } from '@legion/bot-cerebro';
import { herbie, herbieServices } from '@legion/bot-herbie';
import { jarvis, jarvisServices } from '@legion/bot-jarvis';
import { sentinel, sentinelServices } from '@legion/bot-sentinel';
import { type AnyLegionBot, createTestContext, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ultron } from '../src/index.js';
import { CH, events } from './helpers.js';

/**
 * US-29: the "Primeiro contato" tutorial campaign played end to end with every bot. H.E.R.B.I.E.'s
 * tutorial follows the chapters, the fight runs through ULTRON and Sentinel, and the last message
 * explains the teams and /campanha.
 */
let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const U = '111';
const MISSIONS = '300000000000000020';

async function setup() {
  const bots: AnyLegionBot[] = [cerebro, jarvis, sentinel, ultron, herbie];
  t = await createTestContext({
    bots,
    config: {
      channels: { welcome: CH.welcome, combat: CH.combat, events: CH.events, missions: MISSIONS },
      herbie: { delivery: 'channel' },
    },
  });
  for (const [id, name] of [
    [CH.combat, 'combate'],
    [CH.events, 'eventos'],
    [CH.welcome, 'boas-vindas'],
    [MISSIONS, 'missoes'],
  ] as const)
    t.gateway.addChannel({ id, name, kind: 'text', parentId: null });
  return t;
}

/** A hero as Cérebro's onboarding leaves it, then `player.created` (H.E.R.B.I.E. starts the tutorial). */
async function register(tc: TestContext) {
  tc.gateway.addMember({ userId: U });
  const repo = new CerebroRepo(tc.db, tc.gateway.guildId, tc.clock, tc.runtime.newId);
  const { row } = await repo.ensureMember(U);
  await repo.updateMember(row.id, { onboardingStep: 'registered', faction: 'independent' });
  const mutant = await repo.insertMutant({
    memberId: row.id,
    codename: 'Faísca',
    codenameNormalized: 'faisca',
    power: 'Raios',
    archetype: 'Elemental',
    origin: 'o',
    originType: 'mutante',
  });
  await tc.runtime.bus.forSource('cerebro').emit(tc.db.orm, 'player.created', {
    memberId: row.id,
    discordUserId: U,
    mutantId: mutant?.id ?? 'mut',
    codename: 'Faísca',
    archetype: 'Elemental',
    faction: 'independent',
    originType: 'mutante',
  });
  await tc.settle();
  return row.id;
}

/** H.E.R.B.I.E.'s messages to the member (delivery: channel). */
const herbieLines = (tc: TestContext) =>
  tc.gateway.messages
    .filter((m) => m.msg.persona === 'herbie' && (m.msg.content ?? '').includes(`<@${U}>`))
    .map((m) => [m.msg.embeds?.[0]?.title ?? '', m.msg.embeds?.[0]?.description ?? ''].join('\n'));

const command = (tc: TestContext, commandName: string, options: Record<string, string> = {}) =>
  tc.interact({
    kind: 'command',
    userId: U,
    commandName,
    ...(commandName === 'missao' ? { subcommand: 'iniciar' } : {}),
    options,
  });

const jarvisButtons = (tc: TestContext) =>
  (
    tc.gateway.messages.filter((m) => m.msg.persona === 'jarvis' && m.msg.components?.length).at(-1)?.msg
      .components?.[0] ?? []
  ).map((b) => ('customId' in b ? (b.customId ?? '') : ''));

/** Clicks scene choices by index, settling after each. */
async function choose(tc: TestContext, ...choices: number[]) {
  for (const c of choices) {
    await tc.interact({ kind: 'component', userId: U, customId: jarvisButtons(tc)[c] ?? '' });
    await tc.settle();
  }
}

/** Fights the combat for real: power when ready, attack otherwise, until Sentinel resolves it. */
async function fight(tc: TestContext) {
  const [req] = await events(tc, 'combat.requested');
  const combatId = req?.combatId ?? '';
  const s = sentinelServices(tc.ctxOf(sentinel));
  for (let n = 0; n < 30; n++) {
    const c = await s.repo.combat(combatId);
    if (c?.status !== 'active') break;
    for (const action of ['power', 'attack'])
      await tc.interact({
        kind: 'component',
        userId: U,
        customId: `sentinel:v1:act:${combatId}:${c.round + 1}:${action}`,
      });
    await tc.settle();
    tc.clock.advance(1_000);
  }
  return (await events(tc, 'combat.resolved')).find((r) => r.combatId === combatId);
}

describe('tutorial arc "Primeiro contato" (US-29)', () => {
  it('a new hero plays the 3 chapters to success; H.E.R.B.I.E. follows and ends with teams and /campanha', async () => {
    const tc = await setup();
    const memberId = await register(tc);
    const tutorial = herbieServices(tc.ctxOf(herbie)).tutorial;
    const js = jarvisServices(tc.ctxOf(jarvis));

    // Invite: the campaign, and the profile as the first step.
    const intro = herbieLines(tc)[0] ?? '';
    expect(intro).toContain('Seu tutorial é a campanha **Primeiro contato**: 5 passos');
    expect(intro).toContain('Conheça seu herói');
    expect(tutorial.steps().map((s) => s.id)).toEqual([
      'perfil',
      'capitulo-1',
      'primeira-trivia',
      'capitulo-2',
      'capitulo-3',
    ]);

    await command(tc, 'perfil');
    await tc.settle();
    expect((await tutorial.currentFor(memberId))?.id).toBe('capitulo-1');

    // Chapter 1: choices only. A failure does not count; a success does.
    await command(tc, 'missao', { missao: 'primeiro-contato-1' });
    await choose(tc, 0, 1); // go now → raise the alarm → failure
    expect((await tutorial.currentFor(memberId))?.id).toBe('capitulo-1');
    tc.clock.advance(60_000);
    await command(tc, 'missao', { missao: 'primeiro-contato-1' }); // a lost chapter can be tried again
    await choose(tc, 1, 0); // records → greenhouse → success
    expect((await tutorial.currentFor(memberId))?.id).toBe('primeira-trivia');

    // Trivia: any answer counts.
    const q = await command(tc, 'trivia');
    const btn = tc.gateway.lastReply(q)?.components?.[0]?.[0];
    await tc.interact({
      kind: 'component',
      userId: U,
      customId: btn && 'customId' in btn ? (btn.customId ?? '') : '',
    });
    await tc.settle();
    expect((await tutorial.currentFor(memberId))?.id).toBe('capitulo-2');

    // Chapter 2: a group mission the leader starts alone.
    await command(tc, 'missao', { missao: 'primeiro-contato-2' });
    const lobby = tc.gateway.messages
      .filter((m) => m.msg.embeds?.[0]?.title?.startsWith('Primeiro contato 2'))
      .at(-1);
    const start = (lobby?.msg.components?.[0] ?? [])
      .map((b) => ('customId' in b ? (b.customId ?? '') : ''))
      .find((c) => c.endsWith('start'));
    await tc.interact({ kind: 'component', userId: U, customId: start ?? '' });
    await tc.settle();
    await choose(tc, 1, 1); // antenna → copy the data → success
    expect((await tutorial.currentFor(memberId))?.id).toBe('capitulo-3');

    // Chapter 3: the fight, through ULTRON (encounter) and Sentinel (combat).
    await command(tc, 'missao', { missao: 'primeiro-contato-3' });
    await choose(tc, 0); // straight into the fight
    const [run] = await js.repo.runsOf(memberId, ['fighting']);
    expect(run?.missionId).toBe('primeiro-contato-3');
    const result = await fight(tc);
    expect(result?.winnerSide).toBe('players');
    await tc.settle();
    expect((await js.repo.run(run?.id ?? ''))?.status).toBe('success');

    // Done: every step once, the final message about teams and /campanha.
    const progress = await herbieServices(tc.ctxOf(herbie)).repo.progress(memberId);
    expect(progress?.status).toBe('completed');
    const done = await herbieServices(tc.ctxOf(herbie)).repo.stepsDone(memberId);
    expect(done.map((d) => d.stepId).sort()).toEqual(
      ['perfil', 'capitulo-1', 'primeira-trivia', 'capitulo-2', 'capitulo-3'].sort(),
    );
    const last = herbieLines(tc).at(-1) ?? '';
    expect(last).toContain('🎉 Tutorial completo!');
    expect(last).toContain('/campanha');
    expect(last).toContain('os arcos abrem no nível 3');
    const camp = await command(tc, 'campanha', { campanha: 'primeiro-contato' });
    expect(tc.gateway.lastReply(camp)?.embeds?.[0]?.title).toBe('Primeiro contato · 3/3 capítulos');
  });
});
