import { describe, expect, it } from 'vitest';
import { addMember, CH, emit, events, servicesOf, setupUltron } from './helpers.js';

describe('mission combat flow', () => {
  it('mission.started → exactly one combat.requested with the right combatants, even when delivered twice', async () => {
    const t = await setupUltron();
    const a = await addMember(t, '111');
    const b = await addMember(t, '222');
    const payload = {
      missionId: 'm-1',
      missionType: 'combat' as const,
      memberIds: [a, b],
      partyLevel: 5,
      difficulty: 'normal' as const,
      channelId: CH.combat,
    };
    await emit(t, 'mission.started', payload);
    await emit(t, 'mission.started', payload);
    const reqs = (await events(t, 'combat.requested')).filter((r) => r.requestedBy === 'ultron');
    expect(reqs).toHaveLength(1);
    const req = reqs[0];
    expect(req?.mode).toBe('party');
    expect(req?.missionId).toBe('m-1');
    expect(
      req?.participants
        .filter((p) => p.side === 'players')
        .map((p) => p.refId)
        .sort(),
    ).toEqual([a, b].sort());
    const foes = req?.participants.filter((p) => p.side === 'enemies') ?? [];
    expect(foes).toHaveLength(3); // 2 minions + 1 elite at level 5
    expect(foes.every((f) => f.level === 5 && f.id.startsWith('enemy:'))).toBe(true);
    const enc = await servicesOf(t).repo.encounterByMission('m-1');
    expect(enc).toMatchObject({ partyLevel: 5, partySize: 2, difficulty: 'normal', adaptiveMultiplier: 1 });
    expect(JSON.parse(enc?.enemies ?? '[]')).toEqual(foes);
    expect(
      t.gateway.messages.filter((m) => m.channelId === CH.combat && m.msg.persona === 'ultron'),
    ).toHaveLength(1);
    // text missions are ignored
    await emit(t, 'mission.started', { ...payload, missionId: 'm-2', missionType: 'text' });
    expect(await servicesOf(t).repo.encounterByMission('m-2')).toBeNull();
  });

  it('Sentinel resolves the fight and the outcome is stored on the encounter once', async () => {
    const t = await setupUltron();
    const a = await addMember(t, '111');
    await emit(t, 'mission.started', {
      missionId: 'm-1',
      missionType: 'combat',
      memberIds: [a],
      partyLevel: 1,
      difficulty: 'facil',
      channelId: CH.combat,
    });
    const [req] = (await events(t, 'combat.requested')).filter((r) => r.requestedBy === 'ultron');
    expect(req?.mode).toBe('duel');
    // Nobody clicks: Sentinel's round timer plays the fight to its end.
    for (let n = 0; n < 3; n++) {
      t.clock.advance(46_000);
      await t.settle();
    }
    const [res] = await events(t, 'combat.resolved');
    expect(res?.combatId).toBe(req?.combatId);
    const enc = await servicesOf(t).repo.encounterByCombat(req?.combatId ?? '');
    expect(enc?.outcome).toBe('enemies'); // abandoned after 3 idle rounds
    await t.settle();
    expect((await servicesOf(t).repo.encounterByCombat(req?.combatId ?? ''))?.resolvedAt).toBe(
      enc?.resolvedAt,
    );
    expect(enc?.resolvedAt).not.toBeNull();
  });

  it('/ultron spawn is staff only and spawns for the named members', async () => {
    const t = await setupUltron();
    await addMember(t, '111');
    await addMember(t, '222');
    const no = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'ultron',
      subcommand: 'spawn',
      options: { dificuldade: 'normal' },
    });
    expect(t.gateway.lastReply(no)?.content).toBe('Apenas a staff pode usar este comando.');
    const unknown = await t.interact({
      kind: 'command',
      userId: '1',
      isGuildOwner: true,
      commandName: 'ultron',
      subcommand: 'spawn',
      options: { dificuldade: 'normal', membro1: '999' },
    });
    expect(t.gateway.lastReply(unknown)?.content).toBe('<@999> ainda não registrou um mutante.');
    const ok = await t.interact({
      kind: 'command',
      userId: '1',
      isGuildOwner: true,
      commandName: 'ultron',
      subcommand: 'spawn',
      options: { dificuldade: 'dificil', membro1: '111', membro2: '222' },
    });
    await t.runtime.bus.drain();
    expect(t.gateway.lastReply(ok)?.content).toMatch(
      /^🤖 3 inimigo\(s\) enviados para <#300000000000000010>: /,
    );
    const [req] = (await events(t, 'combat.requested')).filter((r) => r.requestedBy === 'ultron');
    expect(req?.missionId).toBeNull();
    expect(req?.participants.filter((p) => p.side === 'players')).toHaveLength(2);
  });

  it('adaptive difficulty uses the stored outcomes when enabled', async () => {
    const t = await setupUltron({ config: { ultron: { adaptive: { enabled: true, minSample: 2 } } } });
    const s = servicesOf(t);
    const a = await addMember(t, '111');
    const b = await addMember(t, '222');
    for (const n of [1, 2]) {
      const r = await s.encounters.spawn({
        missionId: `m${n}`,
        memberIds: [a, b],
        difficulty: 'normal',
        channelId: CH.combat,
      });
      await t.db.transaction((tx) => s.repo.resolveEncounter(r?.combatId ?? '', 'players', tx));
    }
    expect(await s.encounters.currentAdaptive()).toEqual({ multiplier: 1.15, sample: 2 });
    const r3 = await s.encounters.spawn({
      missionId: 'm3',
      memberIds: [a, b],
      difficulty: 'normal',
      channelId: CH.combat,
    });
    expect((await s.repo.encounterByMission('m3'))?.adaptiveMultiplier).toBe(1.15);
    expect(r3?.enemies[0]?.stats.atk).toBeGreaterThan(0);
  });
});

describe('config', () => {
  it('ULTRON without Sentinel fails with a clear message', async () => {
    const { parseConfigText } = await import('@legion/core');
    expect(() => parseConfigText('bots: [cerebro, ultron]')).toThrow(/ULTRON precisa do Sentinel/);
  });
});
