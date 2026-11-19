import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CerebroRepo } from '@legion/bot-cerebro';
import { formatIssues, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ultronConfigSchema } from '../src/config.js';
import { ULTRON_LOCALES_DIR, ultron, ultronTables } from '../src/index.js';
import { addMember, CH, emit, events, servicesOf, setupUltron } from './helpers.js';

let t: TestContext;
afterEach(async () => t?.close());

const DAY = 86_400_000;
const quiet = (war: Record<string, unknown> = {}) => ({
  ultron: { invasion: { enabled: false }, war },
});

async function boot(opts: { start?: string; war?: Record<string, unknown>; jarvis?: boolean } = {}) {
  t = await setupUltron({
    ...(opts.start ? { start: opts.start } : {}),
    ...(opts.jarvis === false ? { jarvis: false } : {}),
    config: quiet(opts.war),
  });
  await ultron.onReady?.(t.ctxOf(ultron));
  return servicesOf(t);
}

async function ledger(tc: TestContext) {
  const p = ultronTables(tc.db).ultronWarPoints;
  return tc.db.orm.select().from(p);
}

const staff = (
  tc: TestContext,
  subcommand: string,
  options: Record<string, string | number> = {},
  userId = '1',
) =>
  tc.interact({
    kind: 'command',
    userId,
    isGuildOwner: true,
    commandName: 'ultron',
    subcommand,
    options,
  });

describe('ultron.war config', () => {
  it('defaults to a month and rejects a bad length with the config path', () => {
    expect(ultronConfigSchema.parse({}).war).toEqual({
      enabled: true,
      length: 'month',
      points: { missionSuccess: 10, missionFailure: 3, strike: 2, participation: 5 },
    });
    const bad = ultronConfigSchema.safeParse({ war: { length: 3 } });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    const lines = formatIssues('legion.config.yaml', bad.error.issues, 'pt-BR', ['ultron']);
    expect(lines.join('\n')).toMatch(/legion\.config\.yaml → ultron\.war\.length: .*mínimo 7/);
    expect(ultronConfigSchema.safeParse({ war: { length: 'week' } }).success).toBe(false);
    expect(ultronConfigSchema.parse({ war: { length: 14 } }).war.length).toBe(14);
  });
});

describe('war lifecycle', () => {
  it('a month war starts on the 1st, including a boot a minute after midnight', async () => {
    const s = await boot({ start: '2026-03-15T15:00:00.000Z' });
    const scheduled = await s.war.repo.findStatus('scheduled');
    expect(scheduled).toMatchObject({
      startsAt: '2026-04-01T03:00:00.000Z',
      endsAt: '2026-05-01T03:00:00.000Z',
      status: 'scheduled',
    });
    await t.close();
    const late = await boot({ start: '2026-05-01T03:01:00.000Z' });
    expect(await late.war.repo.findStatus('scheduled')).toMatchObject({
      startsAt: '2026-05-01T03:00:00.000Z',
      endsAt: '2026-06-01T03:00:00.000Z',
    });
  });

  it('a number of days starts now and the next war starts when the previous ends', async () => {
    const s = await boot({ start: '2026-03-15T15:00:00.000Z', war: { length: 14 } });
    await t.settle();
    const active = await s.war.repo.findStatus('active');
    expect(active?.startsAt).toBe('2026-03-15T15:00:00.000Z');
    expect(active?.endsAt).toBe('2026-03-29T15:00:00.000Z');
    t.clock.set(new Date('2026-03-29T15:03:00.000Z'));
    await t.settle();
    await t.settle();
    expect(await s.war.repo.war(active?.id ?? '')).toMatchObject({ status: 'ended' });
    const next = await s.war.repo.findStatus('active');
    expect(next?.startsAt).toBe('2026-03-29T15:00:00.000Z');
    expect(next?.endsAt).toBe(new Date(Date.parse('2026-03-29T15:00:00.000Z') + 14 * DAY).toISOString());
  });

  it('a late end on the 1st does not skip the next month', async () => {
    await boot({ start: '2026-03-15T15:00:00.000Z' });
    t.clock.set(new Date('2026-05-01T03:03:00.000Z'));
    await t.settle();
    await t.settle();
    const rows = await t.db.orm.select().from(ultronTables(t.db).ultronWars);
    const ended = rows.find((r) => r.status === 'ended');
    const open = rows.find((r) => r.status === 'active' || r.status === 'scheduled');
    expect(ended).toMatchObject({ startsAt: '2026-04-01T03:00:00.000Z', endsAt: '2026-05-01T03:00:00.000Z' });
    expect(open?.startsAt).toBe('2026-05-01T03:00:00.000Z');
    expect(open?.endsAt).toBe('2026-06-01T03:00:00.000Z');
    expect(await events(t, 'war.ended')).toHaveLength(1);
  });

  it('a tie makes every tied faction win, nobody scoring has no winner, and end emits once', async () => {
    const s = await boot();
    const a = await addMember(t, '111', 'xmen');
    const b = await addMember(t, '222', 'brotherhood');
    expect(await s.war.staffStart()).toBe('started');
    await s.war.score(a, 10, 'mission', 'war:mission:r1:a');
    await s.war.score(b, 10, 'mission', 'war:mission:r1:b');
    const active = await s.war.repo.findStatus('active');
    if (!active) throw new Error('no war');
    await s.war.end(active.id);
    const ended = await events(t, 'war.ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]?.winners).toEqual(['brotherhood', 'xmen']);
    expect(ended[0]?.winnerMemberIds.sort()).toEqual([a, b].sort());
    await s.war.end(active.id);
    expect(await events(t, 'war.ended')).toHaveLength(1);

    await t.close();
    const none = await boot();
    expect(await none.war.staffStart()).toBe('started');
    const empty = await none.war.repo.findStatus('active');
    if (!empty) throw new Error('no war');
    await none.war.end(empty.id);
    const [event] = await events(t, 'war.ended');
    expect(event?.winners).toEqual([]);
    expect(event?.winnerMemberIds).toEqual([]);
    const posted = t.gateway.messages.filter((m) => m.channelId === CH.events);
    expect(posted.map((m) => m.msg.embeds?.[0]?.description).join('\n')).toContain('Sem vencedor');
  });

  it('a crash after the end commits still posts once, and does not emit again', async () => {
    const s = await boot();
    const a = await addMember(t, '111', 'xmen');
    await s.war.staffStart();
    await s.war.score(a, 10, 'mission', 'war:mission:r:a');
    const active = await s.war.repo.findStatus('active');
    if (!active) throw new Error('no war');
    t.gateway.failNext('sendMessage');
    await expect(s.war.end(active.id)).rejects.toThrow(/Missing Permissions/);
    expect((await s.war.repo.war(active.id))?.status).toBe('ended');
    expect((await s.war.repo.war(active.id))?.resultMessageId).toBeNull();
    expect(await events(t, 'war.ended')).toHaveLength(1);
    await s.war.end(active.id);
    await s.war.end(active.id);
    const posts = t.gateway.messages.filter((m) => m.channelId === CH.events);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.msg.embeds?.[0]?.description).toContain('X-Men');
    expect(posts[0]?.msg.embeds?.[0]?.title).toBe('Guerra de facções encerrada');
    expect(await events(t, 'war.ended')).toHaveLength(1);
    expect((await s.war.repo.war(active.id))?.resultMessageId).toBe(posts[0]?.messageId);
  });
});

describe('war scoring', () => {
  it('scores each source once, keeps the faction of that moment, and skips independents and members who left', async () => {
    const s = await boot();
    const hero = await addMember(t, '111', 'xmen');
    const other = await addMember(t, '222', 'brotherhood');
    const indie = await addMember(t, '333', 'independent');
    const gone = await addMember(t, '444', 'avengers');
    await s.war.staffStart();
    const repo = new CerebroRepo(t.db, t.gateway.guildId, t.clock, t.runtime.newId);
    await repo.updateMember(gone, { leftAt: '2026-11-16T16:00:00.000Z' });

    await emit(t, 'mission.completed', {
      missionId: 'm',
      runId: 'run-1',
      memberIds: [hero, indie, gone],
      outcome: 'success',
    });
    await emit(t, 'mission.completed', {
      missionId: 'm',
      runId: 'run-1',
      memberIds: [hero, indie, gone],
      outcome: 'success',
    });
    await emit(t, 'mission.completed', {
      missionId: 'm',
      runId: 'run-fail',
      memberIds: [hero],
      outcome: 'failure',
    });
    await emit(t, 'mission.completed', {
      missionId: 'm',
      runId: 'run-drop',
      memberIds: [hero],
      outcome: 'abandoned',
    });
    await repo.updateMember(hero, { faction: 'brotherhood' });
    await emit(t, 'mission.completed', {
      missionId: 'm',
      runId: 'run-2',
      memberIds: [hero],
      outcome: 'success',
    });

    await t.db.transaction((tx) =>
      s.eventsRepo.startStrike(
        {
          eventId: 'raid-1',
          memberId: other,
          faction: 'brotherhood',
          combatId: 'strike-1',
          nextStrikeAt: new Date(t.clock.now().getTime() + 60_000).toISOString(),
        },
        tx,
      ),
    );
    const resolved = {
      id: 'evt',
      type: 'combat.resolved',
      source: 'sentinel',
      payload: {
        combatId: 'strike-1',
        requestedBy: 'ultron',
        mode: 'raid_strike',
        missionId: null,
        raidId: 'raid-1',
        seed: 1,
        winnerSide: 'players',
        rounds: 1,
        damageBySide: { players: 4, enemies: 1 },
        survivors: [`player:${other}`],
        logHash: 'h',
      },
    } as never;
    await s.world.onStrikeResolved(resolved);
    await s.world.onStrikeResolved(resolved);

    const raid = await s.world.schedule({
      kind: 'raid',
      startsAt: new Date(t.clock.now().getTime() + 3_600_000),
      scheduledBy: '1',
    });
    if (!raid.ok) throw new Error(raid.error);
    await t.db.transaction((tx) =>
      s.eventsRepo.startStrike(
        {
          eventId: raid.event.id,
          memberId: other,
          faction: 'brotherhood',
          combatId: 'strike-raid',
          nextStrikeAt: new Date(t.clock.now().getTime() + 60_000).toISOString(),
        },
        tx,
      ),
    );
    await s.world.end(raid.event.id, 'victory');
    await s.world.end(raid.event.id, 'victory');

    const rows = await ledger(t);
    const of = (memberId: string) => rows.filter((r) => r.memberId === memberId);
    expect(of(indie)).toEqual([]);
    expect(of(gone)).toEqual([]);
    const heroRows = of(hero).sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
    expect(heroRows.map((r) => [r.reason, r.faction, r.points, r.sourceKey])).toEqual([
      ['mission', 'xmen', 10, `war:mission:run-1:${hero}`],
      ['mission', 'brotherhood', 10, `war:mission:run-2:${hero}`],
      ['mission', 'xmen', 3, `war:mission:run-fail:${hero}`],
    ]);
    expect(
      of(other)
        .map((r) => [r.reason, r.points, r.sourceKey])
        .sort(),
    ).toEqual([
      ['participation', 5, `war:event:${raid.event.id}:${other}`],
      ['strike', 2, 'war:strike:strike-1'],
    ]);
  });

  it('a mission after the war ended scores the next active war, or nothing', async () => {
    const s = await boot();
    const hero = await addMember(t, '111');
    await s.war.staffStart();
    const first = (await s.war.repo.findStatus('active'))?.id;
    await s.war.staffEnd();
    await emit(t, 'mission.completed', {
      missionId: 'm',
      runId: 'late',
      memberIds: [hero],
      outcome: 'success',
    });
    expect(await ledger(t)).toEqual([]);
    await s.war.staffStart();
    const second = (await s.war.repo.findStatus('active'))?.id;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    await emit(t, 'mission.completed', {
      missionId: 'm',
      runId: 'next',
      memberIds: [hero],
      outcome: 'success',
    });
    const rows = await ledger(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ warId: second, faction: 'xmen', points: 10 });
  });

  it('concurrent strikes score once per combat id', async () => {
    const s = await boot();
    const a = await addMember(t, '111', 'xmen');
    const b = await addMember(t, '222', 'brotherhood');
    await s.war.staffStart();
    await Promise.all([
      s.war.score(a, 2, 'strike', 'war:strike:same'),
      s.war.score(b, 2, 'strike', 'war:strike:other'),
      s.war.score(a, 2, 'strike', 'war:strike:same'),
    ]);
    const scores = await s.war.repo.scores((await s.war.repo.findStatus('active'))?.id ?? '');
    expect(scores.sort((x, y) => x.faction.localeCompare(y.faction))).toEqual([
      { faction: 'brotherhood', points: 2, members: 1 },
      { faction: 'xmen', points: 2, members: 1 },
    ]);
  });

  it('does not score when the war is disabled', async () => {
    const s = await boot({ war: { enabled: false } });
    const hero = await addMember(t, '111');
    expect(await s.war.staffStart()).toBe('disabled');
    expect(await s.war.score(hero, 10, 'mission', 'war:mission:x:y')).toBe(false);
    expect(await ledger(t)).toEqual([]);
  });
});

describe('/guerra and /ultron guerra', () => {
  it('shows the scoreboard in the member locale, and the next start when nothing is active', async () => {
    const s = await boot();
    const hero = await addMember(t, '111', 'xmen');
    const id = await t.interact({ kind: 'command', userId: '111', commandName: 'guerra' });
    expect(t.gateway.lastReply(id)?.content).toMatch(
      /^Não há guerra ativa\. A próxima começa em <t:\d+:F>\.$/,
    );
    expect(t.gateway.lastReply(await staff(t, 'guerra iniciar'))?.content).toMatch(
      /^Guerra iniciada\. Termina <t:\d+:F>\.$/,
    );
    await s.war.score(hero, 10, 'mission', 'k');
    t.runtime.i18n.setResolver(async (userId) => (userId === '111' ? 'en' : null));
    const en = await t.interact({ kind: 'command', userId: '111', commandName: 'guerra' });
    const text = t.gateway.lastReply(en)?.content ?? '';
    expect(text).toContain('Scoreboard');
    expect(text).toContain('Your points: 10');
    expect(text).toContain('🔵 X-Men: 10');
    expect(text).toMatch(/Ends <t:\d+:R>\./);
  });

  it('refuses non-staff, an active war, no war, and bad point adjustments', async () => {
    await boot();
    const denied = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'ultron',
      subcommand: 'guerra iniciar',
    });
    expect(t.gateway.lastReply(denied)?.content).toBe('Apenas a staff pode usar este comando.');
    expect(t.gateway.lastReply(await staff(t, 'guerra encerrar'))?.content).toBe(
      'Não há guerra ativa para encerrar.',
    );
    await addMember(t, '111', 'xmen');
    await addMember(t, '222', 'independent');
    const left = await addMember(t, '333', 'avengers');
    const repo = new CerebroRepo(t.db, t.gateway.guildId, t.clock, t.runtime.newId);
    await repo.updateMember(left, { leftAt: '2026-11-16T16:00:00.000Z' });
    await staff(t, 'guerra iniciar');
    expect(t.gateway.lastReply(await staff(t, 'guerra iniciar'))?.content).toBe(
      'Já existe uma guerra ativa.',
    );
    expect(
      t.gateway.lastReply(await staff(t, 'guerra pontos', { membro: '111', pontos: 0, motivo: 'x' }))
        ?.content,
    ).toBe('Zero não altera o placar.');
    expect(
      t.gateway.lastReply(await staff(t, 'guerra pontos', { membro: '111', pontos: 1001, motivo: 'x' }))
        ?.content,
    ).toMatch(/-1000 a 1000/);
    expect(
      t.gateway.lastReply(await staff(t, 'guerra pontos', { membro: '222', pontos: 5, motivo: 'x' }))
        ?.content,
    ).toBe('Independentes não pontuam na guerra.');
    expect(
      t.gateway.lastReply(await staff(t, 'guerra pontos', { membro: '333', pontos: 5, motivo: 'x' }))
        ?.content,
    ).toBe('Quem saiu do servidor não pontua.');
    expect(
      t.gateway.lastReply(
        await staff(t, 'guerra pontos', { membro: '111', pontos: -20, motivo: '  recuo  ' }),
      )?.content,
    ).toBe('Ajuste registrado: -20 para <@111> (🔵 X-Men).');
    const [row] = await ledger(t);
    expect(row).toMatchObject({
      points: -20,
      reason: 'staff',
      faction: 'xmen',
      createdBy: '1',
      note: 'recuo',
    });
    expect(t.gateway.lastReply(await staff(t, 'guerra encerrar'))?.content).toBe('Guerra encerrada.');
    const posts = t.gateway.messages.filter((m) => m.channelId === CH.events);
    expect(posts).toHaveLength(1);
    await staff(t, 'guerra encerrar');
    expect(t.gateway.messages.filter((m) => m.channelId === CH.events)).toHaveLength(1);
  });

  it('posts the English result when the server locale is English and jarvis is off', async () => {
    t = await setupUltron({
      jarvis: false,
      config: { locale: 'en', ultron: { invasion: { enabled: false } } },
    });
    const s = servicesOf(t);
    const hero = await addMember(t, '111', 'xmen');
    await s.war.staffStart();
    await s.war.score(hero, 10, 'mission', 'war:mission:en:h');
    expect(t.gateway.lastReply(await staff(t, 'guerra encerrar'))?.content).toBe('War ended.');
    const post = t.gateway.messages.find((m) => m.channelId === CH.events);
    expect(post?.msg.embeds?.[0]?.title).toBe('Faction war ended');
    expect(post?.msg.embeds?.[0]?.description).toContain('Winners:');
    expect(JSON.stringify(post?.msg.embeds)).toContain('economy is off');
  });
});

describe('locale files', () => {
  it('pt-BR and en have the same keys', () => {
    const flat = (o: Record<string, unknown>, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === 'object' ? flat(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`],
      );
    const pt = flat(JSON.parse(readFileSync(join(ULTRON_LOCALES_DIR, 'pt-BR.json'), 'utf8'))).sort();
    const en = flat(JSON.parse(readFileSync(join(ULTRON_LOCALES_DIR, 'en.json'), 'utf8'))).sort();
    expect(en).toEqual(pt);
  });
});
