import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { addMember, events, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const U = '111';
const MISSIONS_CH = '300000000000000009';

async function setup(config: Record<string, unknown> = {}) {
  t = await setupJarvis({ channels: { missions: MISSIONS_CH }, ...config });
  t.gateway.addChannel({ id: MISSIONS_CH, name: 'missoes', kind: 'text', parentId: null, overwrites: [] });
  const memberId = await addMember(t, U, 'xmen', 'Pulso');
  return { t, memberId, s: servicesOf(t) };
}

const start = (tc: TestContext, missao = 'patrulha-noturna', userId = U) =>
  tc.interact({ kind: 'command', userId, commandName: 'missao', subcommand: 'iniciar', options: { missao } });

/** Scene messages posted in threads, oldest first. */
const scenes = (tc: TestContext) =>
  tc.gateway.messages.filter((m) => m.msg.persona === 'jarvis' && (m.msg.components?.[0]?.length ?? 0) > 0);
const lastButtons = (tc: TestContext) =>
  (scenes(tc).at(-1)?.msg.components?.[0] ?? []).map((b) => ('customId' in b ? (b.customId ?? '') : ''));
const click = (tc: TestContext, customId: string, userId = U) =>
  tc.interact({ kind: 'component', userId, customId });
const ledger = async (tc: TestContext, memberId: string) =>
  (await servicesOf(tc).repo.ledgerFor(memberId)).filter((l) => l.reason === 'mission');

describe('solo missions', () => {
  it('plays a text mission to success in a thread and pays XP once', async () => {
    const { t, memberId, s } = await setup();
    const id = await start(t);
    expect(t.gateway.lastReply(id)?.content).toMatch(/Missão iniciada em <#\d+>/);
    const [[parent, name]] = t.gateway.callsOf('createThread') as [string, string][];
    expect(parent).toBe(MISSIONS_CH);
    expect(name).toMatch(/^Missão: Patrulha noturna #/);
    const first = scenes(t)[0];
    expect(first?.msg.content).toBe(`<@${U}>`);
    expect(first?.msg.embeds?.[0]?.description).toMatch(/O porto está quieto/);

    const [run] = await s.repo.runsOf(memberId);
    const [started] = await events(t, 'mission.started');
    expect(started).toMatchObject({
      missionId: run?.id,
      missionType: 'text',
      memberIds: [memberId],
      difficulty: 'facil',
    });

    await click(t, lastButtons(t)[1] ?? ''); // follow the footprints
    expect(scenes(t)).toHaveLength(2);
    await click(t, lastButtons(t)[0] ?? ''); // talk calmly → success
    const done = await s.repo.run(run?.id ?? '');
    expect(done).toMatchObject({ status: 'success', sceneId: 'aliada' });
    expect((await ledger(t, memberId)).map((l) => [l.amount, l.note, l.sourceKey])).toEqual([
      [40, 'patrulha-noturna', `mission:${run?.id}:${memberId}`],
    ]);
    expect(await events(t, 'mission.completed')).toEqual([
      { missionId: run?.id, memberIds: [memberId], outcome: 'success' },
    ]);
    const result = t.gateway.messages.at(-1)?.msg.embeds?.[0]?.description ?? '';
    expect(result).toMatch(/Faísca/);
    expect(result).toMatch(/Missão cumprida! \+40 XP/);
  });

  it('a failure ending pays the failure XP', async () => {
    const { t, memberId } = await setup();
    await start(t);
    await click(t, lastButtons(t)[0] ?? ''); // container
    await click(t, lastButtons(t)[0] ?? ''); // switch the tracker off → failure
    expect((await ledger(t, memberId)).map((l) => l.amount)).toEqual([10]);
    expect((await events(t, 'mission.completed'))[0]?.outcome).toBe('failure');
  });

  it('double clicks, old buttons and other people change nothing', async () => {
    const { t, memberId, s } = await setup();
    await addMember(t, '222');
    await start(t);
    const firstButtons = lastButtons(t);
    const other = await click(t, firstButtons[0] ?? '', '222');
    expect(t.gateway.lastReply(other)?.content).toMatch(/outra equipe/);
    await click(t, firstButtons[1] ?? '');
    const again = await click(t, firstButtons[1] ?? '');
    expect(t.gateway.lastReply(again)?.content).toMatch(/já passou/);
    const old = await click(t, firstButtons[0] ?? '');
    expect(t.gateway.lastReply(old)?.content).toMatch(/já passou/);
    const [run] = await s.repo.runsOf(memberId);
    expect(run?.sceneId).toBe('armazem');
    expect(scenes(t)).toHaveLength(2);
  });

  it('daily and story limits come from the config; one open run at a time', async () => {
    const { t } = await setup();
    await start(t);
    const busy = await start(t, 'patrulha-noturna');
    expect(t.gateway.lastReply(busy)?.content).toMatch(/já tem uma missão em andamento/);
    await click(t, lastButtons(t)[1] ?? '');
    await click(t, lastButtons(t)[0] ?? '');
    const limited = await start(t);
    expect(t.gateway.lastReply(limited)?.content).toMatch(/missão diária hoje/);
    t.clock.advance(24 * 3600_000);
    const tomorrow = await start(t);
    expect(t.gateway.lastReply(tomorrow)?.content).toMatch(/Missão iniciada/);
  });

  it('config values change the XP paid and the limits', async () => {
    const { t, memberId } = await setup({
      jarvis: { missions: { rewards: { daily: { successXp: 55 } }, limits: { dailyPerMember: 2 } } },
    });
    for (let n = 0; n < 2; n++) {
      const id = await start(t);
      expect(t.gateway.lastReply(id)?.content).toMatch(/Missão iniciada/);
      await click(t, lastButtons(t)[1] ?? '');
      await click(t, lastButtons(t)[0] ?? '');
    }
    expect((await ledger(t, memberId)).map((l) => l.amount)).toEqual([55, 55]);
    const third = await start(t);
    expect(t.gateway.lastReply(third)?.content).toMatch(/missão diária hoje/);
  });

  it('missions above the member level are blocked', async () => {
    const { t } = await setup();
    const id = await start(t, 'sinal-fantasma');
    expect(t.gateway.lastReply(id)?.content).toMatch(/Precisa do nível 2/);
  });

  it('no answer within choiceTimeoutMinutes → abandoned without XP; a stale timer does nothing', async () => {
    const { t, memberId, s } = await setup();
    await start(t);
    await click(t, lastButtons(t)[1] ?? ''); // moves the run: the first timer is now stale
    t.clock.advance(6 * 60_000);
    await t.settle();
    const [run] = await s.repo.runsOf(memberId);
    expect(run?.status).toBe('active');
    t.clock.advance(5 * 60_000);
    await t.settle();
    expect((await s.repo.run(run?.id ?? ''))?.status).toBe('abandoned');
    expect(await events(t, 'mission.completed')).toEqual([
      { missionId: run?.id, memberIds: [memberId], outcome: 'abandoned' },
    ]);
    expect(await ledger(t, memberId)).toEqual([]);
    expect(t.gateway.messages.at(-1)?.msg.embeds?.[0]?.description).toMatch(/abandonada/);
    const late = await click(t, lastButtons(t)[0] ?? '');
    expect(t.gateway.lastReply(late)?.content).toMatch(/já passou/);
  });

  it('/missao abandonar ends the run without XP', async () => {
    const { t, memberId, s } = await setup();
    await start(t);
    const id = await t.interact({
      kind: 'command',
      userId: U,
      commandName: 'missao',
      subcommand: 'abandonar',
    });
    expect(t.gateway.lastReply(id)?.content).toBe('Missão abandonada.');
    expect((await s.repo.runsOf(memberId))[0]?.status).toBe('abandoned');
    expect(await ledger(t, memberId)).toEqual([]);
  });

  it('after a restart, a committed but unposted scene is posted once and the timer is re-armed', async () => {
    const { t, memberId, s } = await setup();
    await start(t);
    await click(t, lastButtons(t)[1] ?? '');
    const [run] = await s.repo.runsOf(memberId);
    // Crash between the commit and the post: the new scene is not in the thread yet.
    await s.repo.markRun(run?.id ?? '', { postedScene: 'porto' });
    const before = scenes(t).length;
    expect(await s.missions.recover()).toBe(1);
    expect(await s.missions.recover()).toBe(1);
    expect(scenes(t)).toHaveLength(before + 1);
    expect(scenes(t).at(-1)?.msg.embeds?.[0]?.description).toMatch(/armazém 7/);
    t.clock.advance(11 * 60_000);
    await t.settle();
    expect((await s.repo.run(run?.id ?? ''))?.status).toBe('abandoned');
    expect((await events(t, 'mission.completed')).length).toBe(1);
  });

  it('lists missions with what the member can play; fights stay hidden for now; unregistered members are told to register', async () => {
    const { t } = await setup();
    const id = await t.interact({ kind: 'command', userId: U, commandName: 'missao', subcommand: 'lista' });
    const fields = t.gateway.lastReply(id)?.embeds?.[0]?.fields ?? [];
    expect(fields.map((f) => f.name)).toEqual(['Patrulha noturna · Diária', 'Sinal fantasma · Semanal']);
    expect(fields[1]?.value).toMatch(/🔒 Precisa do nível 2/);
    t.gateway.addMember({ userId: '999' });
    const anon = await start(t, 'patrulha-noturna', '999');
    expect(t.gateway.lastReply(anon)?.content).toMatch(/ainda não é um mutante registrado/);
  });

  it('autocomplete offers only what the member can start', async () => {
    const { t } = await setup();
    const id = await t.interact({
      kind: 'autocomplete',
      userId: U,
      commandName: 'missao',
      focused: { name: 'missao', value: '' },
    });
    const calls = t.gateway.callsOf('respondAutocomplete') as [string, { value: string }[]][];
    const res = calls.find((c) => c[0] === id)?.[1] ?? [];
    expect(res.map((c) => c.value)).toEqual(['patrulha-noturna']);
  });
});
