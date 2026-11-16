import { CoreRuntime, FakeRandomSource, silentLogger, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { CerebroRepo, cerebro } from '../src/index.js';
import { CH, events, FIELDS, join, register, setupCerebro, USER } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const repoOf = (tc: TestContext) => new CerebroRepo(tc.db, tc.gateway.guildId, tc.clock, tc.runtime.newId);

describe('onboarding', () => {
  it('walks join → rules → faction → archetype → modal → registered', async () => {
    t = await setupCerebro();
    await join(t);
    expect(t.gateway.memberRoleNames(USER)).toEqual(['Sinal Detectado']);
    const welcome = t.gateway.messages.find((m) => m.channelId === CH.welcome);
    expect(welcome?.msg.content).toBe(`<@${USER}>`);
    expect(welcome?.msg.allowedMentions).toEqual({ parse: [], users: [USER] });
    expect(await events(t, 'member.joined')).toEqual([
      { discordUserId: USER, accountCreatedAt: '2020-01-01T00:00:00.000Z', isRejoin: false },
    ]);

    const s = await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:start' });
    expect(t.gateway.lastReply(s)).toMatchObject({ ephemeral: true });
    expect(t.gateway.lastReply(s)?.components?.[0]?.[0]).toMatchObject({ customId: 'cerebro:v1:rules' });

    const r = await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:rules' });
    expect(t.gateway.repliesTo(r)[0]?.kind).toBe('updateMessage');
    expect(t.gateway.lastReply(r)?.components?.[0]?.[0]).toMatchObject({ customId: 'cerebro:v1:faction' });

    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:faction', values: ['xmen'] });
    const a = await t.interact({
      kind: 'component',
      userId: USER,
      customId: 'cerebro:v1:archetype',
      values: ['Elemental'],
    });
    expect(t.gateway.repliesTo(a)[0]?.modal?.inputs.map((x) => x.customId)).toEqual([
      'codinome',
      'poder',
      'origem',
    ]);

    const m = await t.interact({
      kind: 'modal',
      userId: USER,
      customId: 'cerebro:v1:mutant',
      fields: FIELDS,
    });
    expect(t.gateway.repliesTo(m).map((x) => x.kind)).toEqual(['deferReply', 'editReply']);
    expect(t.gateway.lastReply(m)?.embeds?.[0]?.title).toBe('✅ Mutante registrado!');
    expect(t.gateway.memberRoleNames(USER)).toEqual(['Mutante Registrado', 'Recruta', 'X-Men']);

    const member = await t.runtime.providers.readModels().members.getByDiscordId(USER);
    expect(member).toMatchObject({ onboardingStep: 'registered', faction: 'xmen', rank: 'recruta' });
    const [created] = await events(t, 'player.created');
    expect(created).toMatchObject({
      discordUserId: USER,
      codename: 'Faísca Rubra',
      archetype: 'Elemental',
      faction: 'xmen',
    });
    const card = t.gateway.messages.find((x) => x.channelId === CH.registry);
    expect(card?.msg.embeds?.[0]?.description).toContain('Faísca Rubra');
  });

  it('a double-submitted modal creates one mutant and one player.created', async () => {
    t = await setupCerebro();
    await register(t);
    const again = await t.interact({
      kind: 'modal',
      userId: USER,
      customId: 'cerebro:v1:mutant',
      fields: { ...FIELDS, codinome: 'Outro Nome' },
    });
    expect(await events(t, 'player.created')).toHaveLength(1);
    const repo = repoOf(t);
    const row = await repo.memberByDiscordId(USER);
    expect((await repo.mutantByMemberId(row?.id ?? ''))?.codename).toBe('Faísca Rubra');
    expect(t.gateway.lastReply(again)?.embeds?.[0]?.title).toContain('Faísca Rubra');
  });

  it('old buttons from an earlier step show the current step instead', async () => {
    t = await setupCerebro();
    await join(t);
    const early = await t.interact({
      kind: 'component',
      userId: USER,
      customId: 'cerebro:v1:faction',
      values: ['xmen'],
    });
    expect(t.gateway.lastReply(early)?.content).toBe('Vamos continuar de onde você parou:');
    expect(t.gateway.lastReply(early)?.components?.[0]?.[0]).toMatchObject({ customId: 'cerebro:v1:rules' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:rules' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:rules' }); // double click
    const row = await repoOf(t).memberByDiscordId(USER);
    expect(row?.onboardingStep).toBe('rules_accepted');
    const sub = await t.interact({
      kind: 'modal',
      userId: USER,
      customId: 'cerebro:v1:mutant',
      fields: FIELDS,
    });
    expect(t.gateway.lastReply(sub)?.components?.[0]?.[0]).toMatchObject({ customId: 'cerebro:v1:faction' });
    expect(await events(t, 'player.created')).toHaveLength(0);
  });

  it('resumes after a restart: the archetype is stored and the modal reopens', async () => {
    t = await setupCerebro();
    await join(t);
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:start' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:rules' });
    await t.interact({
      kind: 'component',
      userId: USER,
      customId: 'cerebro:v1:faction',
      values: ['brotherhood'],
    });
    await t.interact({
      kind: 'component',
      userId: USER,
      customId: 'cerebro:v1:archetype',
      values: ['Tanque'],
    });

    // A new process: same DB and Discord, fresh runtime and bot services.
    const rt = new CoreRuntime({
      config: t.config,
      db: t.db,
      gateway: t.gateway,
      clock: t.clock,
      random: new FakeRandomSource(1),
      log: silentLogger(),
      guildId: t.gateway.guildId,
      roleGuard: 'throw',
    });
    await rt.loadBots([cerebro]);
    const route = async (i: Parameters<typeof rt.router.handle>[0]) => {
      await rt.router.handle(i);
      await rt.bus.drain();
    };
    const base = {
      guildId: t.gateway.guildId,
      channelId: CH.welcome,
      userId: USER,
      memberRoleIds: [],
      isGuildOwner: false,
      locale: null,
    };
    await route({ ...base, id: 'r1', kind: 'component', customId: 'cerebro:v1:start' });
    expect(t.gateway.lastReply('r1')?.components?.[1]?.[0]).toMatchObject({ customId: 'cerebro:v1:reopen' });
    await route({ ...base, id: 'r2', kind: 'component', customId: 'cerebro:v1:reopen' });
    expect(t.gateway.repliesTo('r2')[0]?.kind).toBe('showModal');
    await route({ ...base, id: 'r3', kind: 'modal', customId: 'cerebro:v1:mutant', fields: FIELDS });
    expect(t.gateway.memberRoleNames(USER)).toEqual(['Irmandade', 'Mutante Registrado', 'Recruta']);
    const [created] = await events(t, 'player.created');
    expect(created).toMatchObject({ archetype: 'Tanque', faction: 'brotherhood' });
  });

  it('ends with exactly one faction role, whatever was picked or given by hand before', async () => {
    t = await setupCerebro();
    await join(t);
    const irmandade = t.gateway.roleByName('Irmandade');
    t.gateway.members.get(USER)?.roleIds.push(irmandade?.id ?? '');
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:start' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:rules' });
    for (const f of ['brotherhood', 'independent', 'xmen', 'independent'])
      await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:faction', values: [f] });
    await t.interact({
      kind: 'component',
      userId: USER,
      customId: 'cerebro:v1:archetype',
      values: ['Velocista'],
    });
    await t.interact({ kind: 'modal', userId: USER, customId: 'cerebro:v1:mutant', fields: FIELDS });
    expect(t.gateway.memberRoleNames(USER)).toEqual(['Independente', 'Mutante Registrado', 'Recruta']);
  });

  it('rejects canon names with a reopen button, and flags 3 attempts in 10 minutes once', async () => {
    t = await setupCerebro();
    await join(t);
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:start' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:rules' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:faction', values: ['xmen'] });
    await t.interact({
      kind: 'component',
      userId: USER,
      customId: 'cerebro:v1:archetype',
      values: ['Telepata'],
    });
    let last = '';
    for (const name of ['W0lverine', 'tempestade', 'Jean  Grey', 'Mística']) {
      last = await t.interact({
        kind: 'modal',
        userId: USER,
        customId: 'cerebro:v1:mutant',
        fields: { ...FIELDS, codinome: name },
      });
      t.clock.advance(60_000);
    }
    const reply = t.gateway.lastReply(last);
    expect(reply?.content).toContain('**Mística** parece nome de um personagem da Marvel');
    expect(reply?.components?.[0]?.[0]).toMatchObject({ customId: 'cerebro:v1:reopen' });
    const flags = await events(t, 'report.flagged');
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      reporter: 'cerebro',
      subjectDiscordUserId: USER,
      reason: 'canon_name_attempts',
      severity: 'low',
    });
    expect(await events(t, 'player.created')).toHaveLength(0);
  });

  it('codename uniqueness ignores case and accents', async () => {
    t = await setupCerebro();
    await register(t, USER, { fields: { codinome: 'Faísca Rubra' } });
    const other = '400000000000000002';
    const id = await register(t, other, { fields: { codinome: '  faisca   RUBRA ' } });
    expect(t.gateway.lastReply(id)?.content).toBe(
      'O codinome **faisca RUBRA** já pertence a outro mutante. Escolha outro.',
    );
    expect(await events(t, 'player.created')).toHaveLength(1);
  });

  it('validates power and origin lengths', async () => {
    t = await setupCerebro();
    const id = await register(t, USER, { fields: { poder: 'x'.repeat(101) } });
    expect(t.gateway.lastReply(id)?.content).toBe('Descreva seu poder em até 100 caracteres.');
  });
});

describe('rejoin', () => {
  it('restores registered, faction, rank and opt-in roles with no new rows', async () => {
    t = await setupCerebro();
    await register(t);
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:optin:live_ping' });
    await t.runtime.guildEvents.memberRemoved(USER);
    const left = await repoOf(t).memberByDiscordId(USER);
    expect(left?.leftAt).not.toBeNull();
    const m = t.gateway.members.get(USER);
    if (m) m.roleIds = []; // Discord drops roles when a member leaves
    await join(t);
    expect(t.gateway.memberRoleNames(USER)).toEqual([
      'Aviso de Live',
      'Mutante Registrado',
      'Recruta',
      'X-Men',
    ]);
    const repo = repoOf(t);
    const row = await repo.memberByDiscordId(USER);
    expect(row?.leftAt).toBeNull();
    expect(await repo.listRegistered()).toHaveLength(1);
    expect(await events(t, 'player.rejoined')).toEqual([{ memberId: row?.id, discordUserId: USER }]);
    expect((await events(t, 'member.joined')).map((e) => e.isRejoin)).toEqual([false, true]);
    expect(t.gateway.messages.at(-1)?.msg.content).toContain('Bem-vindo de volta, **Faísca Rubra**');
  });

  it('an unregistered member who rejoins keeps their step', async () => {
    t = await setupCerebro();
    await join(t);
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:start' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:rules' });
    await t.runtime.guildEvents.memberRemoved(USER);
    await join(t);
    expect((await repoOf(t).memberByDiscordId(USER))?.onboardingStep).toBe('rules_accepted');
    expect(t.gateway.memberRoleNames(USER)).toEqual(['Sinal Detectado']);
  });

  it('ignores bots joining', async () => {
    t = await setupCerebro();
    t.gateway.addMember({ userId: '500', isBot: true });
    await join(t, '500');
    expect(await repoOf(t).memberByDiscordId('500')).toBeNull();
  });
});
