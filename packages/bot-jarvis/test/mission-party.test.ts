import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { addMember, award, events, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const MISSIONS = '300000000000000009';
const [A, B, C, D, E] = ['111', '222', '333', '444', '555'];

async function setup() {
  t = await setupJarvis({ channels: { missions: MISSIONS } });
  t.gateway.addChannel({ id: MISSIONS, name: 'missoes', kind: 'text', parentId: null, overwrites: [] });
  const ids: Record<string, string> = {};
  for (const u of [A, B, C, D, E]) {
    ids[u] = await addMember(t, u, 'xmen', `Agente${u}`);
    await award(t, ids[u] ?? '', 60, `seed:${u}`); // level 2: "sinal-fantasma" needs it
  }
  return { t, ids, s: servicesOf(t) };
}

const startParty = (tc: TestContext, userId = A) =>
  tc.interact({
    kind: 'command',
    userId,
    commandName: 'missao',
    subcommand: 'iniciar',
    options: { missao: 'sinal-fantasma' },
  });
const lobby = (tc: TestContext) =>
  tc.gateway.messages.filter((m) => m.channelId === MISSIONS && m.msg.persona === 'jarvis').at(-1);
const lobbyBtn = (tc: TestContext, action: 'join' | 'leave' | 'start') =>
  (lobby(tc)?.msg.components?.[0] ?? [])
    .map((b) => ('customId' in b ? (b.customId ?? '') : ''))
    .find((c) => c.endsWith(`:${action}`)) ?? '';
const click = (tc: TestContext, customId: string, userId: string) =>
  tc.interact({ kind: 'component', userId, customId });
const sceneButtons = (tc: TestContext) =>
  (
    tc.gateway.messages.filter((m) => m.channelId !== MISSIONS && m.msg.components?.[0]?.length).at(-1)?.msg
      .components?.[0] ?? []
  ).map((b) => ('customId' in b ? (b.customId ?? '') : ''));

describe('party missions', () => {
  it('a lobby forms, the leader starts, votes decide and every member is paid', async () => {
    const { t, ids, s } = await setup();
    const open = await startParty(t);
    expect(t.gateway.lastReply(open)?.content).toMatch(/Grupo aberto em <#300000000000000009>/);
    const join = lobbyBtn(t, 'join');
    await click(t, join, B);
    await click(t, join, C);
    const twice = await click(t, join, C);
    expect(t.gateway.lastReply(twice)?.content).toMatch(/já está neste grupo/);
    t.gateway.addMember({ userId: '999' });
    const anon = await click(t, join, '999');
    expect(t.gateway.lastReply(anon)?.content).toMatch(/não é um herói registrado/);
    const notLeader = await click(t, lobbyBtn(t, 'start'), B);
    expect(t.gateway.lastReply(notLeader)?.content).toMatch(/Só o líder/);

    const start = await click(t, lobbyBtn(t, 'start'), A);
    expect(t.gateway.lastReply(start)?.embeds?.[0]?.description).toMatch(/A missão começou em <#\d+>/);
    const [run] = await s.repo.runsOf(ids[A] ?? '');
    expect(run?.status).toBe('active');
    const [started] = await events(t, 'mission.started');
    expect([...(started?.memberIds ?? [])].sort()).toEqual([ids[A], ids[B], ids[C]].sort());
    const first = t.gateway.messages.find((m) => m.channelId === run?.threadId);
    expect(first?.msg.content).toBe(`<@${A}> <@${B}> <@${C}>`);

    // Majority: B and C pick "write down the numbers" (1), A picks "force the door" (0).
    const opts = sceneButtons(t);
    const voted = await click(t, opts[0] ?? '', A);
    expect(t.gateway.lastReply(voted)?.content).toMatch(/Voto registrado/);
    await click(t, opts[1] ?? '', B);
    await click(t, opts[1] ?? '', C);
    expect((await s.repo.run(run?.id ?? ''))?.sceneId).toBe('numeros');

    // Tie with two voters on the timer: the leader's vote wins.
    const n = sceneButtons(t);
    await click(t, n[0] ?? '', A); // follow the coordinates → success
    await click(t, n[2] ?? '', B);
    t.clock.advance(11 * 60_000);
    await t.settle();
    const done = await s.repo.run(run?.id ?? '');
    expect(done).toMatchObject({ status: 'success', sceneId: 'encontro' });
    for (const u of [A, B, C]) {
      const xp = (await s.repo.ledgerFor(ids[u] ?? ''))
        .filter((l) => l.reason === 'mission')
        .map((l) => l.amount);
      expect(xp).toEqual([120]);
    }
    expect((await events(t, 'mission.completed'))[0]).toMatchObject({
      missionId: run?.id,
      outcome: 'success',
    });

    // Every member used their weekly mission.
    const again = await startParty(t, B);
    expect(t.gateway.lastReply(again)?.content).toMatch(/missão semanal nesta semana/);
  });

  it('a full party refuses more members; leaving frees the spot and passes the lead', async () => {
    const { t, ids, s } = await setup();
    await startParty(t);
    const join = lobbyBtn(t, 'join');
    for (const u of [B, C, D]) await click(t, join, u);
    const full = await click(t, join, E);
    expect(t.gateway.lastReply(full)?.content).toMatch(/grupo está cheio/);
    await click(t, lobbyBtn(t, 'leave'), A);
    const [run] = await s.repo.runsOf(ids[B] ?? '');
    expect(run?.leaderMemberId).toBe(ids[B]);
    await click(t, join, E);
    expect((await s.repo.runMembers(run?.id ?? '')).sort()).toEqual([ids[B], ids[C], ids[D], ids[E]].sort());
    // A is free again and can start another mission.
    expect(await s.missions.openRunOf(ids[A] ?? '')).toBeNull();
  });

  it('a lobby nobody starts closes on its own and does not count toward limits', async () => {
    const { t, ids, s } = await setup();
    await startParty(t);
    const join = lobbyBtn(t, 'join');
    await click(t, join, B);
    t.clock.advance(6 * 60_000);
    await t.settle();
    const [run] = await s.repo.runsOf(ids[A] ?? '');
    expect(run?.status).toBe('cancelled');
    expect(t.gateway.callsOf('editMessage').length).toBeGreaterThan(0);
    expect(lobby(t)?.msg.components ?? []).toEqual([]);
    const late = await click(t, join, C);
    expect(t.gateway.lastReply(late)?.content).toMatch(/Este grupo já foi fechado/);
    const again = await startParty(t);
    expect(t.gateway.lastReply(again)?.content).toMatch(/Grupo aberto/);
  });

  it('a member who leaves the party mid-run is not paid; one who left the server is skipped', async () => {
    const { t, ids, s } = await setup();
    await startParty(t);
    for (const u of [B, C]) await click(t, lobbyBtn(t, 'join'), u);
    await click(t, lobbyBtn(t, 'start'), A);
    const quit = await t.interact({
      kind: 'command',
      userId: C,
      commandName: 'missao',
      subcommand: 'abandonar',
    });
    expect(t.gateway.lastReply(quit)?.content).toMatch(/Você saiu do grupo/);
    const { CerebroRepo } = await import('@legion/bot-cerebro');
    await new CerebroRepo(t.db, t.gateway.guildId, t.clock, t.runtime.newId).updateMember(ids[B] ?? '', {
      leftAt: t.clock.now().toISOString(),
    });
    // A alone votes; B never does: the timer decides with A's vote.
    await click(t, sceneButtons(t)[1] ?? '', A); // numbers
    t.clock.advance(11 * 60_000);
    await t.settle();
    await click(t, sceneButtons(t)[0] ?? '', A); // follow → success (B, gone, does not vote)
    t.clock.advance(11 * 60_000);
    await t.settle();
    const [run] = await s.repo.runsOf(ids[A] ?? '');
    expect(run?.status).toBe('success');
    const paid = async (u: string) =>
      (await s.repo.ledgerFor(ids[u] ?? '')).filter((l) => l.reason === 'mission').length;
    expect([await paid(A), await paid(B), await paid(C)]).toEqual([1, 0, 0]);
  });
});
