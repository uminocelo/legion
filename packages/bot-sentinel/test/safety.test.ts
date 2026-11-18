import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { sentinel } from '../src/index.js';
import { addMember, CH, emit, events, servicesOf, setupSentinel } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});
const OWNER = { isGuildOwner: true };
const queuePosts = (tc: TestContext) => tc.gateway.callsOf('sendMessage').filter((c) => c[0] === CH.modQueue);
const xp = (memberId: string, amount: number, reason = 'trivia') => ({
  memberId,
  amount,
  reason,
  totalXp: 0,
  level: 1,
  sourceKey: `k${Math.random()}`,
});

describe('DB rate limiter', () => {
  it('limits every bot with fixed windows; staff are never limited', async () => {
    t = await setupSentinel();
    await addMember(t, '111');
    const replies: (string | undefined)[] = [];
    for (let n = 0; n < 21; n++) {
      // Mix commands of three bots: one shared per-member budget.
      const name = ['combate', 'perfil', 'sequencia'][n % 3] as string;
      const id = await t.interact({
        kind: 'command',
        userId: '111',
        commandName: name,
        ...(name === 'combate' ? { subcommand: 'status' } : {}),
      });
      replies.push(t.gateway.lastReply(id)?.content);
    }
    expect(replies.at(-1)).toMatch(/^Calma, herói! Tente de novo em \d+s\.$/);
    expect(replies.slice(0, 20).every((r) => !r?.startsWith('Calma'))).toBe(true);
    t.clock.advance(60_000);
    const next = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'combate',
      subcommand: 'status',
    });
    expect(t.gateway.lastReply(next)?.content).not.toMatch(/^Calma/);
    for (let n = 0; n < 30; n++) {
      const id = await t.interact({
        kind: 'command',
        userId: '1',
        ...OWNER,
        commandName: 'sentinel',
        subcommand: 'denuncias',
      });
      expect(t.gateway.lastReply(id)?.content ?? '').not.toMatch(/^Calma/);
    }
  });

  it('repeated violations flag rate_limit once per hour into the staff queue', async () => {
    t = await setupSentinel({ config: { sentinel: { rateLimits: { commandsPerMinute: 1 } } } });
    await addMember(t, '111');
    for (let n = 0; n < 12; n++)
      await t.interact({ kind: 'command', userId: '111', commandName: 'combate', subcommand: 'status' });
    await t.settle();
    const flags = (await events(t, 'report.flagged')).filter((f) => f.reason === 'rate_limit');
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ reporter: 'sentinel', subjectDiscordUserId: '111', severity: 'medium' });
    expect(queuePosts(t)).toHaveLength(1);
    t.clock.advance(3_600_000);
    for (let n = 0; n < 7; n++)
      await t.interact({ kind: 'command', userId: '111', commandName: 'combate', subcommand: 'status' });
    await t.settle();
    expect((await events(t, 'report.flagged')).filter((f) => f.reason === 'rate_limit')).toHaveLength(2);
  });

  it('the daily prune removes old windows and violations', async () => {
    t = await setupSentinel();
    const s = servicesOf(t);
    await s.safety.consume('cmd:111', 1, 60_000);
    await s.safety.consume('cmd:111', 1, 60_000); // violation
    t.clock.advance(8 * 86_400_000);
    await s.safety.prune();
    expect(await t.db.orm.select().from(s.safetyRepo.t.sentinelRateBuckets)).toEqual([]);
    expect(await t.db.orm.select().from(s.safetyRepo.t.sentinelViolations)).toEqual([]);
  });
});

describe('anti-cheat watchers', () => {
  it('flags XP anomalies once per hour, ignoring staff adjustments', async () => {
    t = await setupSentinel();
    const m = await addMember(t, '111');
    await emit(t, 'xp.awarded', xp(m, 500, 'admin_adjust'), 'jarvis');
    await emit(t, 'xp.awarded', xp(m, 400), 'jarvis');
    expect(await events(t, 'report.flagged')).toHaveLength(0);
    await emit(t, 'xp.awarded', xp(m, 250), 'jarvis');
    await emit(t, 'xp.awarded', xp(m, 250), 'jarvis');
    const flags = await events(t, 'report.flagged');
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      reason: 'xp_anomaly',
      subjectDiscordUserId: '111',
      details: '650 XP na última hora (limite 600).',
    });
  });

  it('flags young accounts as a low-severity signal', async () => {
    t = await setupSentinel();
    await emit(
      t,
      'member.joined',
      { discordUserId: '555', accountCreatedAt: '2026-11-14T15:00:00.000Z', isRejoin: false },
      'core',
    );
    await emit(
      t,
      'member.joined',
      { discordUserId: '556', accountCreatedAt: '2025-01-01T00:00:00.000Z', isRejoin: false },
      'core',
    );
    const flags = await events(t, 'report.flagged');
    expect(flags.map((f) => [f.subjectDiscordUserId, f.reason, f.severity])).toEqual([
      ['555', 'new_account', 'low'],
    ]);
  });
});

describe('reports and the moderation queue', () => {
  it('/denunciar files a report; a second one within the hour is grouped; self, bots and the hourly limit are refused', async () => {
    t = await setupSentinel();
    await addMember(t, '111');
    await addMember(t, '222');
    await addMember(t, '333');
    const r1 = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'denunciar',
      options: { membro: '222', motivo: 'assedio', detalhes: 'xingou no chat' },
    });
    expect(t.gateway.lastReply(r1)?.content).toBe('Denúncia enviada para a staff. Obrigado!');
    await t.settle();
    expect(queuePosts(t)).toHaveLength(1);
    const embed = (
      queuePosts(t)[0]?.[1] as
        | { embeds: { title: string; fields: { name: string; value: string }[] }[] }
        | undefined
    )?.embeds[0];
    expect(embed?.title).toBe('🚨 Denúncia de membro');
    expect(embed?.fields.find((f) => f.name === 'Detalhes')?.value).toBe(
      '[Assédio ou ofensa] xingou no chat',
    );
    await t.interact({
      kind: 'command',
      userId: '333',
      commandName: 'denunciar',
      options: { membro: '222', motivo: 'conteudo' },
    });
    await t.settle();
    expect(queuePosts(t)).toHaveLength(1);
    const [report] = await servicesOf(t).safetyRepo.reports({ subject: '222' });
    expect(report?.count).toBe(2);
    expect(t.gateway.callsOf('editMessage').length).toBeGreaterThan(0);
    const self = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'denunciar',
      options: { membro: '111', motivo: 'spam' },
    });
    expect(t.gateway.lastReply(self)?.content).toBe('Você não pode denunciar a si mesmo(a).');
    const bot = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'denunciar',
      options: { membro: t.gateway.botUserId, motivo: 'spam' },
    });
    expect(t.gateway.lastReply(bot)?.content).toBe('Bots não podem ser denunciados.');
    await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'denunciar',
      options: { membro: '333', motivo: 'spam' },
    });
    await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'denunciar',
      options: { membro: '333', motivo: 'spam' },
    });
    const limited = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'denunciar',
      options: { membro: '333', motivo: 'spam' },
    });
    expect(t.gateway.lastReply(limited)?.content).toMatch(
      /^Você já enviou muitas denúncias\. Tente de novo em \d+ min\.$/,
    );
  });

  it('"Denunciar mensagem" opens a modal and stores the message link', async () => {
    t = await setupSentinel();
    await addMember(t, '111');
    await addMember(t, '222');
    const target = { messageId: '700000000000000001', channelId: '300000000000000050', authorId: '222' };
    const menu = await t.interact({
      kind: 'context_menu',
      userId: '111',
      commandName: 'Denunciar mensagem',
      target,
    });
    const modal = t.gateway.callsOf('showModal').find((c) => c[0] === menu)?.[1] as { customId: string };
    expect(modal.customId).toBe(`sentinel:v1:report-msg:${target.channelId}:${target.messageId}:222`);
    await t.interact({
      kind: 'modal',
      userId: '111',
      customId: modal.customId,
      fields: { motivo: 'link suspeito' },
    });
    await t.settle();
    const [report] = await servicesOf(t).safetyRepo.reports({ subject: '222' });
    expect(JSON.parse(report?.refs ?? '{}').message).toBe(
      `https://discord.com/channels/${t.gateway.guildId}/${target.channelId}/${target.messageId}`,
    );
    expect(report?.details).toBe('[Outro] link suspeito');
  });

  it('staff buttons: staff only, every action logged, warn falls back on closed DMs, timeouts, history', async () => {
    t = await setupSentinel();
    await addMember(t, '111');
    await addMember(t, '222');
    await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'denunciar',
      options: { membro: '222', motivo: 'spam' },
    });
    await t.settle();
    const [report] = await servicesOf(t).safetyRepo.reports({ subject: '222' });
    const id = report?.id ?? '';
    const btn = (userId: string, action: string, extra = {}) =>
      t?.interact({
        kind: 'component',
        userId,
        customId: `sentinel:v1:mod:${id}:${action}`,
        ...extra,
      }) as Promise<string>;
    expect(t.gateway.lastReply(await btn('111', 'resolve'))?.content).toBe(
      'Apenas a staff pode usar este comando.',
    );
    t.gateway.closedDms.add('222');
    expect(t.gateway.lastReply(await btn('1', 'warn', OWNER))?.content).toBe(
      'DM fechada: aviso registrado, mas não entregue.',
    );
    expect(t.gateway.lastReply(await btn('1', 't0', OWNER))?.content).toBe('Timeout de 10 min aplicado.');
    expect(t.gateway.callsOf('timeoutMember')[0]?.slice(0, 2)).toEqual(['222', 600_000]);
    expect(t.gateway.lastReply(await btn('1', 'resolve', OWNER))?.content).toBe(
      'Denúncia marcada como Resolvida.',
    );
    expect(t.gateway.lastReply(await btn('1', 'ignore', OWNER))?.content).toBe(
      'Esta denúncia já está Resolvida.',
    );
    const acts = await servicesOf(t).safetyRepo.actionsFor([id]);
    expect(acts.map((a) => [a.action, a.note, a.staffDiscordUserId]).reverse()).toEqual([
      ['warn', 'DM fechada', '1'],
      ['timeout', '10 min', '1'],
      ['resolve', null, '1'],
    ]);
    const lastEdit = t.gateway.callsOf('editMessage').at(-1)?.[2] as {
      embeds: { fields: { name: string; value: string }[] }[];
    };
    expect(lastEdit.embeds[0]?.fields.find((f) => f.name === 'Situação')?.value).toBe(
      'Resolvida\nResolvida por <@1>',
    );
    const hist = t.gateway.lastReply(await btn('1', 'history', OWNER));
    expect(hist?.embeds?.[0]?.description).toContain('warn (DM fechada) — <@1>');
    const list = await t.interact({
      kind: 'command',
      userId: '1',
      ...OWNER,
      commandName: 'sentinel',
      subcommand: 'denuncias',
      options: { status: 'resolved' },
    });
    expect(t.gateway.lastReply(list)?.embeds?.[0]?.title).toBe('📋 Denúncias: Resolvida (1)');
    const h = await t.interact({
      kind: 'command',
      userId: '1',
      ...OWNER,
      commandName: 'sentinel',
      subcommand: 'historico',
      options: { membro: '222' },
    });
    expect(t.gateway.lastReply(h)?.embeds?.[0]?.title).toBe('📋 Histórico de denúncias');
  });

  it('doctor warns when the mod queue is visible to everyone', async () => {
    t = await setupSentinel();
    const res = await sentinel.doctorChecks?.(t.ctxOf(sentinel))[0]?.run();
    expect(res).toMatchObject({
      status: 'warn',
      message: 'channels.modQueue está visível para @everyone: deixe só a staff ver',
    });
  });
});

describe('locales', () => {
  it('pt-BR and en have the same keys and placeholders', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { SENTINEL_LOCALES_DIR } = await import('../src/index.js');
    const flat = (o: Record<string, unknown>, p = ''): Record<string, string> =>
      Object.entries(o).reduce(
        (acc, [k, v]) =>
          Object.assign(
            acc,
            typeof v === 'object' && v
              ? flat(v as Record<string, unknown>, `${p}${k}.`)
              : { [`${p}${k}`]: String(v) },
          ),
        {} as Record<string, string>,
      );
    const pt = flat(JSON.parse(readFileSync(join(SENTINEL_LOCALES_DIR, 'pt-BR.json'), 'utf8')));
    const en = flat(JSON.parse(readFileSync(join(SENTINEL_LOCALES_DIR, 'en.json'), 'utf8')));
    expect(Object.keys(en).sort()).toEqual(Object.keys(pt).sort());
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(pt)) expect([k, vars(en[k] ?? '')]).toEqual([k, vars(pt[k] ?? '')]);
  });
});

describe('timeout pre-checks', () => {
  async function withReport(tc: TestContext, subjectRoles: string[]) {
    await addMember(tc, '111');
    await addMember(tc, '222');
    const m = tc.gateway.members.get('222');
    if (m) m.roleIds = subjectRoles;
    await tc.interact({
      kind: 'command',
      userId: '111',
      commandName: 'denunciar',
      options: { membro: '222', motivo: 'spam' },
    });
    await tc.settle();
    const [report] = await servicesOf(tc).safetyRepo.reports({ subject: '222' });
    return (action: string) =>
      tc.interact({
        kind: 'component',
        userId: '1',
        isGuildOwner: true,
        customId: `sentinel:v1:mod:${report?.id}:${action}`,
      });
  }
  const setPerms = (tc: TestContext, id: string, permissions: string[], position?: number) => {
    const r = tc.gateway.roles.get(id);
    if (r) Object.assign(r, { permissions, ...(position === undefined ? {} : { position }) });
  };

  it('explains a missing permission, an admin target and the role order before calling Discord', async () => {
    t = await setupSentinel();
    const g = t.gateway;
    setPerms(t, g.guildId, []);
    setPerms(t, '900000000000000099', ['SendMessages']);
    const admin = g.addRole({ name: 'Admin', position: 50, permissions: ['Administrator'] });
    const high = g.addRole({ name: 'Alto', position: 150, permissions: [] });
    const press = await withReport(t, [high.id]);
    expect(g.lastReply(await press('t0'))?.content).toMatch(
      /^O cargo do Sentinel não tem a permissão "Moderar membros"/,
    );
    setPerms(t, '900000000000000099', ['ModerateMembers']);
    expect(g.lastReply(await press('t0'))?.content).toMatch(/^O cargo mais alto deste membro está acima/);
    const m = g.members.get('222');
    if (m) m.roleIds = [admin.id];
    expect(g.lastReply(await press('t0'))?.content).toBe(
      'Não dá para aplicar timeout em administradores nem no dono do servidor.',
    );
    if (m) m.roleIds = [];
    expect(g.lastReply(await press('t0'))?.content).toBe('Timeout de 10 min aplicado.');
    expect(g.callsOf('timeoutMember')).toHaveLength(1);
  });
});

describe('finding combats and the registered commands', () => {
  it('replay and log accept the short id people see; autocomplete lists recent combats', async () => {
    t = await setupSentinel();
    await addMember(t, '111');
    await t.interact({ kind: 'command', userId: '111', commandName: 'treino' });
    await t.settle();
    const s = servicesOf(t);
    const [c] = await s.repo.recentCombats();
    const id = c?.id ?? '';
    await s.combat.resolve(id, 1); // finish quickly: the drone only needs to exist; force rounds to the end
    for (let n = 2; n <= 20 && (await s.repo.combat(id))?.status === 'active'; n++)
      await s.combat.resolve(id, n);
    const short = `#${id.slice(-6).toLowerCase()}`;
    const rep = await t.interact({
      kind: 'command',
      userId: '1',
      isGuildOwner: true,
      commandName: 'sentinel',
      subcommand: 'replay',
      options: { combate: short },
    });
    expect(t.gateway.lastReply(rep)?.content).toMatch(new RegExp(`^✅ Combate #${id.slice(-6)} confere`));
    const log = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'combate',
      subcommand: 'log',
      options: { id: id.slice(-6) },
    });
    expect(t.gateway.lastReply(log)?.embeds?.[0]?.title).toMatch(/^📜/);
    const ac = await t.interact({
      kind: 'autocomplete',
      userId: '1',
      isGuildOwner: true,
      commandName: 'sentinel',
      focused: { name: 'combate', value: id.slice(-4) },
    });
    const choices = t.gateway.callsOf('respondAutocomplete').find((x) => x[0] === ac)?.[1] as {
      name: string;
      value: string;
    }[];
    expect(choices[0]).toMatchObject({ value: id });
    expect(choices[0]?.name).toMatch(new RegExp(`^#${id.slice(-6)} · Treino · `));
  });

  it('registers every subcommand Discord should show', async () => {
    t = await setupSentinel();
    const json = t.runtime.router.commandJson() as {
      name: string;
      type?: number;
      options?: { name: string; type: number }[];
    }[];
    const sub = (n: string) =>
      json
        .find((c) => c.name === n)
        ?.options?.filter((o) => o.type === 1)
        .map((o) => o.name);
    expect(sub('sentinel')).toEqual(['replay', 'denuncias', 'historico']);
    expect(sub('combate')).toEqual(['status', 'log']);
    expect(json.find((c) => c.name === 'Denunciar mensagem')?.type).toBe(3);
    expect(json.map((c) => c.name)).toEqual(expect.arrayContaining(['treino', 'denunciar']));
  });
});
