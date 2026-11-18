import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CombatService,
  replayCombat,
  roundInput,
  SentinelRepo,
  sentinel,
  startFighter,
} from '../src/index.js';
import {
  actId,
  addMember,
  CH,
  emit,
  enemy,
  events,
  lastPrompt,
  player,
  request,
  servicesOf,
  setupSentinel,
} from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const click = (tc: TestContext, userId: string, combatId: string, round: number, action = 'attack') =>
  tc.interact({ kind: 'component', userId, customId: actId(combatId, round, action) });

/** Plays a combat to the end by having every listed player click attack each round. */
async function playOut(tc: TestContext, combatId: string, users: string[]) {
  const s = servicesOf(tc);
  for (let n = 0; n < 30; n++) {
    const c = await s.repo.combat(combatId);
    if (c?.status !== 'active') return c;
    for (const u of users) await click(tc, u, combatId, c.round + 1);
    await tc.settle();
    tc.clock.advance(1_000); // stay under the component rate limit
  }
  throw new Error('combat did not end');
}

describe('combat sessions', () => {
  it('a fake requester: one combat, a thread, buttons, exactly one combat.resolved, replay ✅', async () => {
    t = await setupSentinel();
    const m = await addMember(t, '111');
    const req = request('cbt-1', [player('p1', m), enemy('e1')]);
    await emit(t, 'combat.requested', req);
    await emit(t, 'combat.requested', req); // duplicate delivery
    const threads = t.gateway.callsOf('createThread');
    expect(threads).toEqual([[CH.combat, '⚔️ Combate #-cbt-1'.replace('#-', '#'), undefined]]);
    const prompt = lastPrompt(t);
    expect(prompt?.msg.embeds?.[0]?.title).toBe('⚔️ Rodada 1/20');
    expect(prompt?.msg.components?.[0]?.map((b) => (b.type === 'button' ? b.label : ''))).toEqual([
      'Atacar',
      'Poder',
      'Defender',
    ]);
    const end = await playOut(t, 'cbt-1', ['111']);
    expect(end?.status).toBe('finished');
    const resolved = await events(t, 'combat.resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      combatId: 'cbt-1',
      requestedBy: 'ultron',
      mode: 'party',
      rounds: end?.round,
      logHash: end?.logHash,
    });
    const final = t.gateway.messages.at(-1)?.msg;
    expect(final?.embeds?.[0]?.title).toBe('🏁 Fim do combate #cbt-1');
    const staff = await t.interact({
      kind: 'command',
      userId: '1',
      isGuildOwner: true,
      commandName: 'sentinel',
      subcommand: 'replay',
      options: { combate: 'cbt-1' },
    });
    expect(t.gateway.lastReply(staff)?.content).toMatch(/^✅ Combate #cbt-1 confere/);
    const log = await t.interact({ kind: 'component', userId: '111', customId: 'sentinel:v1:log:cbt-1:0' });
    expect(t.gateway.lastReply(log)?.embeds?.[0]?.title).toMatch(/^📜 Log do combate #cbt-1 \(1\/\d+\)$/);
  });

  it('a round resolves when every living player chose; choices can change; timeout defaults to attack', async () => {
    t = await setupSentinel();
    const a = await addMember(t, '111');
    const b = await addMember(t, '222');
    await emit(
      t,
      'combat.requested',
      request('cbt-2', [
        player('p1', a),
        player('p2', b),
        enemy('e1', { stats: { hp: 3000, atk: 1, def: 1, spd: 1, foc: 1 } }),
      ]),
    );
    const s = servicesOf(t);
    await click(t, '111', 'cbt-2', 1, 'defend');
    await click(t, '111', 'cbt-2', 1, 'power'); // changed
    expect((await s.repo.combat('cbt-2'))?.round).toBe(0);
    await click(t, '222', 'cbt-2', 1, 'attack');
    await t.settle();
    const r1 = (await s.repo.rounds('cbt-2'))[0];
    expect(JSON.parse(r1?.actions ?? '{}')).toMatchObject({ p1: 'power', p2: 'attack' });
    // Round 2: only p1 chooses; the timeout job resolves it with p2 defaulting to attack.
    await click(t, '111', 'cbt-2', 2, 'defend');
    t.clock.advance(44_000);
    await t.settle();
    expect((await s.repo.combat('cbt-2'))?.round).toBe(1);
    t.clock.advance(2_000);
    await t.settle();
    const r2 = (await s.repo.rounds('cbt-2'))[1];
    expect(JSON.parse(r2?.actions ?? '{}')).toMatchObject({ p1: 'defend', p2: 'attack' });
    expect(r2?.idle).toBe(0);
  });

  it('rejects non-participants, old-round buttons and power on cooldown', async () => {
    t = await setupSentinel();
    const a = await addMember(t, '111');
    await addMember(t, '333');
    await emit(
      t,
      'combat.requested',
      request('cbt-3', [
        player('p1', a, { powerCooldown: 2 }),
        enemy('e1', { stats: { hp: 3000, atk: 1, def: 1, spd: 1, foc: 1 } }),
      ]),
    );
    const other = await click(t, '333', 'cbt-3', 1);
    expect(t.gateway.lastReply(other)?.content).toBe('Você não está neste combate.');
    const cd = await click(t, '111', 'cbt-3', 1, 'power');
    expect(t.gateway.lastReply(cd)?.content).toBe('Seu poder ainda está recarregando.');
    await click(t, '111', 'cbt-3', 1);
    await t.settle();
    const old = await click(t, '111', 'cbt-3', 1);
    expect(t.gateway.lastReply(old)?.content).toBe('Esta rodada já acabou.');
  });

  it('three idle rounds abandon the combat (enemies win)', async () => {
    t = await setupSentinel();
    const a = await addMember(t, '111');
    await emit(
      t,
      'combat.requested',
      request('cbt-4', [
        player('p1', a, { stats: { hp: 3000, atk: 1, def: 1, spd: 1, foc: 1 } }),
        enemy('e1', { stats: { hp: 3000, atk: 1, def: 1, spd: 1, foc: 1 } }),
      ]),
    );
    for (let n = 0; n < 3; n++) {
      t.clock.advance(46_000);
      await t.settle();
    }
    const c = await servicesOf(t).repo.combat('cbt-4');
    expect(c).toMatchObject({ status: 'abandoned', winnerSide: 'enemies', round: 3 });
    expect((await events(t, 'combat.resolved'))[0]?.winnerSide).toBe('enemies');
  });

  it('raid_strike resolves in one round with no buttons', async () => {
    t = await setupSentinel();
    const a = await addMember(t, '111');
    await emit(
      t,
      'combat.requested',
      request(
        'cbt-5',
        [player('p1', a), enemy('e1', { stats: { hp: 3000, atk: 1, def: 1, spd: 1, foc: 1 } })],
        { mode: 'raid_strike', raidId: 'raid-1' },
      ),
    );
    expect(t.gateway.callsOf('createThread')).toHaveLength(0);
    expect(lastPrompt(t)).toBeUndefined();
    const r = await events(t, 'combat.resolved');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ mode: 'raid_strike', raidId: 'raid-1', rounds: 1 });
    expect(JSON.parse((await servicesOf(t).repo.rounds('cbt-5'))[0]?.actions ?? '{}').p1).toBe('power');
  });

  it('rejects invalid stats and emits nothing', async () => {
    t = await setupSentinel();
    const a = await addMember(t, '111');
    await emit(
      t,
      'combat.requested',
      request('cbt-6', [
        player('p1', a, { stats: { hp: 95, atk: 0, def: 6, spd: 9, foc: 10 } }),
        enemy('e1'),
      ]),
    );
    await emit(
      t,
      'combat.requested',
      request('cbt-7', [
        player('p1', a),
        enemy('e1', { stats: { hp: 6000, atk: 1, def: 1, spd: 1, foc: 1 } }),
      ]),
    );
    expect(await servicesOf(t).repo.combat('cbt-6')).toBeNull();
    expect(await servicesOf(t).repo.combat('cbt-7')).toBeNull();
  });

  it('thread creation failing posts in the channel', async () => {
    t = await setupSentinel();
    const a = await addMember(t, '111');
    t.gateway.failNext('createThread');
    await emit(t, 'combat.requested', request('cbt-8', [player('p1', a), enemy('e1')]));
    expect(lastPrompt(t)?.channelId).toBe(CH.combat);
  });

  it('restart mid-round: a fresh service resumes, the timeout comes back, and the outcome replays', async () => {
    t = await setupSentinel();
    const a = await addMember(t, '111');
    await emit(
      t,
      'combat.requested',
      request('cbt-9', [
        player('p1', a),
        enemy('e1', { stats: { hp: 400, atk: 5, def: 5, spd: 7, foc: 6 } }),
      ]),
    );
    await click(t, '111', 'cbt-9', 1, 'power');
    await t.settle();
    await click(t, '111', 'cbt-9', 2, 'defend'); // chosen, then the process "dies"
    // Lost timeout job + a brand-new service on the same database.
    const { coreTables } = await import('@legion/core');
    await t.db.orm.delete(coreTables(t.db).coreScheduledJobs);
    const ctx = t.ctxOf(sentinel);
    const fresh = new CombatService(ctx, new SentinelRepo(t.db, ctx.guildId, ctx.clock, ctx.newId));
    expect(await fresh.recover()).toBe(1);
    t.clock.advance(46_000);
    await t.settle();
    const repo = servicesOf(t).repo;
    expect(JSON.parse((await repo.rounds('cbt-9'))[1]?.actions ?? '{}').p1).toBe('defend');
    await playOut(t, 'cbt-9', ['111']);
    const c = await repo.combat('cbt-9');
    const replay = replayCombat(
      c?.seed ?? 0,
      (await repo.combatants('cbt-9')).map(startFighter),
      (await repo.rounds('cbt-9')).map(roundInput),
      { maxRounds: 20, abandonAfterIdleRounds: 3 },
    );
    expect(replay.logHash).toBe(c?.logHash);
    expect(await events(t, 'combat.resolved')).toHaveLength(1);
  });
});

describe('/treino and /combate', () => {
  it('starts a training fight against the drone, once at a time, with a cooldown', async () => {
    t = await setupSentinel();
    await addMember(t, '111');
    const r = await t.interact({
      kind: 'command',
      userId: '111',
      channelId: '300000000000000099',
      commandName: 'treino',
    });
    expect(t.gateway.lastReply(r)?.content).toBe(
      '🤖 Drone de Treino a caminho! O combate vai abrir num tópico.',
    );
    await t.settle();
    const req = (await events(t, 'combat.requested'))[0];
    expect(req).toMatchObject({ mode: 'training', requestedBy: 'sentinel', channelId: CH.combat });
    const drone = req?.participants.find((p) => p.kind === 'dummy');
    expect(drone).toMatchObject({ name: 'Drone de Treino', stats: { hp: 130, atk: 5, def: 13 } });
    const again = await t.interact({ kind: 'command', userId: '111', commandName: 'treino' });
    expect(t.gateway.lastReply(again)?.content).toMatch(/^Você já está em um combate: <#\d+>$/);
    const status = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'combate',
      subcommand: 'status',
    });
    expect(t.gateway.lastReply(status)?.embeds?.[0]?.title).toBe('⚔️ Seu combate — rodada 1/20');
    await playOut(t, req?.combatId ?? '', ['111']);
    const cd = await t.interact({ kind: 'command', userId: '111', commandName: 'treino' });
    expect(t.gateway.lastReply(cd)?.content).toMatch(/^O drone está recarregando\. Tente de novo em \d+s\.$/);
    t.clock.advance(300_000);
    const ok = await t.interact({ kind: 'command', userId: '111', commandName: 'treino' });
    expect(t.gateway.lastReply(ok)?.content).toMatch(/^🤖/);
    const log = await t.interact({
      kind: 'command',
      userId: '222',
      commandName: 'combate',
      subcommand: 'log',
      options: { id: req?.combatId ?? '' },
    });
    expect(t.gateway.lastReply(log)?.embeds?.[0]?.title).toMatch(/^📜/);
  });

  it('unregistered members cannot train', async () => {
    t = await setupSentinel();
    t.gateway.addMember({ userId: '222' });
    const r = await t.interact({ kind: 'command', userId: '222', commandName: 'treino' });
    expect(t.gateway.lastReply(r)?.content).toBe(
      'Registre seu herói antes de treinar (canal de boas-vindas).',
    );
  });
});
