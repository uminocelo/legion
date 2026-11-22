import { CerebroRepo } from '@legion/bot-cerebro';
import { formatIssues, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { jarvisConfigSchema } from '../src/config.js';
import { monthStartAtOrAfter, nextSeasonWindow, zonedMidnight } from '../src/domain/season-window.js';
import { jarvis, jarvisTables } from '../src/index.js';
import { addMember, award, events, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  const current = t;
  t = undefined;
  await current?.close();
});

const DAY = 86_400_000;
const TZ = 'America/Sao_Paulo';

async function boot(opts: { start?: string; season?: Record<string, unknown> } = {}) {
  const tc = await setupJarvis({ jarvis: { season: { enabled: true, ...opts.season } } }, opts.start);
  t = tc;
  await jarvis.onReady?.(tc.ctxOf(jarvis));
  return { tc, s: servicesOf(tc) };
}

describe('jarvis.season config', () => {
  it('defaults to off, month length, season_score reset, top 3', () => {
    expect(jarvisConfigSchema.parse({}).season).toEqual({
      enabled: false,
      length: 'month',
      reset: 'season_score',
      rewards: { top: 3 },
    });
    const bad = jarvisConfigSchema.safeParse({ season: { length: 3 } });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    const lines = formatIssues('legion.config.yaml', bad.error.issues, 'pt-BR', ['jarvis']);
    expect(lines.join('\n')).toMatch(/legion\.config\.yaml → jarvis\.season\.length: .*mínimo 7/);
    expect(jarvisConfigSchema.safeParse({ season: { length: 'week' } }).success).toBe(false);
    expect(jarvisConfigSchema.parse({ season: { length: 14 } }).season.length).toBe(14);
  });
});

describe('season window', () => {
  it('reads a calendar midnight in the server timezone', () => {
    expect(zonedMidnight('2026-04-01', TZ).toISOString()).toBe('2026-04-01T03:00:00.000Z');
  });

  it('starts a month season on the next 1st, and the following one on the 1st it ends', () => {
    const mid = new Date('2026-03-15T15:00:00.000Z');
    const first = nextSeasonWindow({ length: 'month', timeZone: TZ, now: mid, previousEndsAt: null });
    expect(first.startsAt.toISOString()).toBe('2026-04-01T03:00:00.000Z');
    expect(first.endsAt.toISOString()).toBe('2026-05-01T03:00:00.000Z');
    const next = nextSeasonWindow({
      length: 'month',
      timeZone: TZ,
      now: new Date(first.endsAt.getTime() + 5_000),
      previousEndsAt: first.endsAt,
    });
    expect(next.startsAt.toISOString()).toBe('2026-05-01T03:00:00.000Z');
    expect(next.endsAt.toISOString()).toBe('2026-06-01T03:00:00.000Z');
  });

  it('keeps the 1st when the end job runs a minute late', () => {
    const late = new Date('2026-05-01T03:01:00.000Z');
    expect(monthStartAtOrAfter(late, TZ).toISOString()).toBe('2026-05-01T03:00:00.000Z');
  });

  it('a number of days starts now and the next season starts when that one ends', () => {
    const now = new Date('2026-03-15T15:00:00.000Z');
    const first = nextSeasonWindow({ length: 14, timeZone: TZ, now, previousEndsAt: null });
    expect(first.startsAt.toISOString()).toBe(now.toISOString());
    expect(first.endsAt.toISOString()).toBe('2026-03-29T15:00:00.000Z');
    const next = nextSeasonWindow({
      length: 14,
      timeZone: TZ,
      now: first.endsAt,
      previousEndsAt: first.endsAt,
    });
    expect(next.startsAt.toISOString()).toBe(first.endsAt.toISOString());
    expect(next.endsAt.getTime() - next.startsAt.getTime()).toBe(14 * DAY);
  });
});

describe('season lifecycle', () => {
  it('schedules → activates → ranks XP in the window → ends once → schedules next', async () => {
    const { tc, s } = await boot({
      start: '2026-03-15T15:00:00.000Z',
      season: { length: 14, rewards: { top: 2 } },
    });
    const scheduled = await s.season.repo.findStatus('scheduled');
    expect(scheduled).toMatchObject({
      startsAt: '2026-03-15T15:00:00.000Z',
      endsAt: '2026-03-29T15:00:00.000Z',
      status: 'scheduled',
    });

    tc.clock.set(new Date('2026-03-15T15:00:00.000Z'));
    await tc.settle();
    expect((await s.season.repo.findStatus('active'))?.id).toBe(scheduled?.id);

    const a = await addMember(tc, '111', 'xmen', 'Storm');
    const b = await addMember(tc, '222', 'brotherhood', 'Mystique');
    const c = await addMember(tc, '333', 'avengers', 'Wasp');
    await award(tc, a, 100, 's:a', 'grant');
    await award(tc, b, 50, 's:b', 'grant');
    await award(tc, c, 75, 's:c', 'grant');

    const viewId = await tc.interact({ kind: 'command', userId: '111', commandName: 'temporada' });
    const reply = tc.gateway.lastReply(viewId);
    const desc = reply?.embeds?.[0]?.description ?? '';
    expect(desc).toContain('Storm');
    expect(desc).toContain('Wasp');
    expect(desc).toContain('Mystique');
    expect(desc).toMatch(/Termina <t:\d+:R>\./);
    expect(desc).toMatch(/1º/);

    const active = await s.season.repo.findStatus('active');
    if (!active) throw new Error('no active season');
    tc.clock.set(new Date(active.endsAt));
    await Promise.all([s.season.end(active.id), s.season.end(active.id)]);
    const ended = await events(tc, 'season.ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({
      seasonId: active.id,
      endsAt: active.endsAt,
    });
    // Grant + first-of-day streak bonus (+5) land in the season window.
    expect(ended[0]?.winners).toEqual([
      { memberId: a, place: 1, xp: 105 },
      { memberId: c, place: 2, xp: 80 },
    ]);

    const next = await s.season.repo.findStatus('scheduled');
    expect(next?.startsAt).toBe(active.endsAt);
    expect(next?.endsAt).toBe(new Date(Date.parse(active.endsAt) + 14 * DAY).toISOString());
    expect((await s.season.repo.season(active.id))?.status).toBe('ended');
  });

  it('hides members who left from the board and empty board still ends', async () => {
    const { tc, s } = await boot({ season: { length: 14 } });
    expect(await s.season.staffStart()).toBe('started');
    const gone = await addMember(tc, '444', 'xmen', 'Gone');
    await award(tc, gone, 40, 's:gone', 'grant');
    const repo = new CerebroRepo(tc.db, tc.gateway.guildId, tc.clock, tc.runtime.newId);
    await repo.updateMember(gone, { leftAt: tc.clock.now().toISOString() });

    const id = await tc.interact({ kind: 'command', userId: '1', commandName: 'temporada' });
    const desc = tc.gateway.lastReply(id)?.embeds?.[0]?.description ?? '';
    expect(desc).not.toContain('Gone');
    expect(desc).toMatch(/Ninguém ganhou XP/);

    const active = await s.season.repo.findStatus('active');
    if (!active) throw new Error('no season');
    await s.season.end(active.id);
    expect(await events(tc, 'season.ended')).toEqual([
      expect.objectContaining({ seasonId: active.id, winners: [] }),
    ]);
  });

  it('XP outside the window does not count toward season score', async () => {
    const tc = await setupJarvis(
      { jarvis: { season: { enabled: true, length: 14 } } },
      '2026-03-01T12:00:00.000Z',
    );
    t = tc;
    const s = servicesOf(tc);
    const early = await addMember(tc, '111', 'xmen', 'Early');
    await award(tc, early, 200, 'before', 'grant');
    tc.clock.set(new Date('2026-03-02T12:00:00.000Z'));
    await jarvis.onReady?.(tc.ctxOf(jarvis));
    expect(await s.season.staffStart()).toBe('started');
    const late = await addMember(tc, '222', 'xmen', 'Late');
    await award(tc, late, 30, 'during', 'grant');

    const active = await s.season.repo.findStatus('active');
    if (!active) throw new Error('no season');
    const board = await s.season.repo.scoreboard(active.startsAt, active.endsAt);
    // Late grant + streak; early XP (before startsAt) is excluded.
    expect(board).toEqual([{ memberId: late, xp: 35 }]);
  });
});

describe('/temporada when seasons are off', () => {
  it('says seasons are disabled and does not schedule', async () => {
    const tc = await setupJarvis({ jarvis: { season: { enabled: false } } });
    t = tc;
    await jarvis.onReady?.(tc.ctxOf(jarvis));
    const s = servicesOf(tc);
    expect(await s.season.repo.findStatus('scheduled')).toBeNull();
    expect(await s.season.repo.findStatus('active')).toBeNull();
    const id = await tc.interact({ kind: 'command', userId: '1', commandName: 'temporada' });
    expect(tc.gateway.lastReply(id)?.content).toMatch(/jarvis\.season\.enabled: false/);
    expect(await s.season.staffStart()).toBe('disabled');
  });

  it('default config leaves seasons off', async () => {
    const tc = await setupJarvis();
    t = tc;
    await jarvis.onReady?.(tc.ctxOf(jarvis));
    const rows = await tc.db.orm.select().from(jarvisTables(tc.db).jarvisSeasons);
    expect(rows).toEqual([]);
  });
});

const staff = (tc: TestContext, subcommand: string) =>
  tc.interact({
    kind: 'command',
    userId: '999',
    isGuildOwner: true,
    commandName: 'jarvis',
    subcommand,
  });

describe('season rewards and staff (US-22 stream 2)', () => {
  it('grants badges once, keeps lifetime XP, and archives the board', async () => {
    const { tc, s } = await boot({ season: { length: 14, rewards: { top: 2 } } });
    expect(await s.season.staffStart()).toBe('started');
    const a = await addMember(tc, '111', 'xmen', 'Storm');
    const b = await addMember(tc, '222', 'brotherhood', 'Mystique');
    const c = await addMember(tc, '333', 'avengers', 'Wasp');
    await award(tc, a, 100, 's:a', 'grant');
    await award(tc, b, 50, 's:b', 'grant');
    await award(tc, c, 75, 's:c', 'grant');
    const xpBefore = (await s.repo.progress(a))?.xp ?? 0;
    expect(xpBefore).toBeGreaterThan(0);

    const active = await s.season.repo.findStatus('active');
    if (!active) throw new Error('no active season');
    await s.season.end(active.id);
    await tc.runtime.bus.drain();
    await s.season.end(active.id);
    await tc.runtime.bus.drain();

    const badges = await s.season.repo.badgesForSeason(active.id);
    expect(badges).toHaveLength(2);
    expect(badges.map((x) => ({ memberId: x.memberId, place: x.place }))).toEqual([
      { memberId: a, place: 1 },
      { memberId: c, place: 2 },
    ]);
    expect((await s.repo.progress(a))?.xp).toBe(xpBefore);

    const ended = await s.season.repo.season(active.id);
    const archive = JSON.parse(ended?.archive ?? 'null') as {
      board: { memberId: string; place: number; xp: number; codename?: string }[];
    };
    expect(archive.board).toEqual([
      expect.objectContaining({ memberId: a, place: 1, codename: 'Storm', xp: 105 }),
      expect.objectContaining({ memberId: c, place: 2, codename: 'Wasp', xp: 80 }),
      expect.objectContaining({ memberId: b, place: 3, codename: 'Mystique', xp: 55 }),
    ]);

    const [event] = await events(tc, 'season.ended');
    await tc.runtime.bus.forSource('jarvis').emit(tc.db.orm, 'season.ended', event);
    await tc.runtime.bus.drain();
    expect(await s.season.repo.badgesForSeason(active.id)).toHaveLength(2);

    const viewId = await tc.interact({ kind: 'command', userId: '111', commandName: 'temporada' });
    const reply = tc.gateway.lastReply(viewId);
    const text = reply?.embeds?.[0]?.description ?? reply?.content ?? '';
    expect(text).toMatch(/Suas medalhas: 1 \(melhor: 1º\)/);
  });

  it('staff start/end refusals and happy path', async () => {
    const { tc, s } = await boot({ season: { length: 14 } });
    tc.gateway.addMember({ userId: '999' });

    const denied = await tc.interact({
      kind: 'command',
      userId: '111',
      commandName: 'jarvis',
      subcommand: 'temporada iniciar',
    });
    expect(tc.gateway.lastReply(denied)?.content).toBe('Apenas a staff pode usar este comando.');

    expect(tc.gateway.lastReply(await staff(tc, 'temporada encerrar'))?.content).toBe(
      'Não há temporada ativa para encerrar.',
    );
    expect(tc.gateway.lastReply(await staff(tc, 'temporada iniciar'))?.content).toMatch(
      /^Temporada iniciada\. Termina <t:\d+:F>\.$/,
    );
    expect(tc.gateway.lastReply(await staff(tc, 'temporada iniciar'))?.content).toBe(
      'Já existe uma temporada ativa.',
    );
    expect(tc.gateway.lastReply(await staff(tc, 'temporada encerrar'))?.content).toBe('Temporada encerrada.');
    await tc.runtime.bus.drain();
    expect(await s.season.repo.findStatus('active')).toBeNull();
    expect(await s.season.staffEnd()).toBe('none');
  });

  it('staff start refuses when seasons are disabled', async () => {
    const tc = await setupJarvis({ jarvis: { season: { enabled: false } } });
    t = tc;
    await jarvis.onReady?.(tc.ctxOf(jarvis));
    tc.gateway.addMember({ userId: '999' });
    expect(tc.gateway.lastReply(await staff(tc, 'temporada iniciar'))?.content).toMatch(
      /jarvis\.season\.enabled: false/,
    );
    expect(tc.gateway.lastReply(await staff(tc, 'temporada encerrar'))?.content).toMatch(
      /jarvis\.season\.enabled: false/,
    );
  });
});
