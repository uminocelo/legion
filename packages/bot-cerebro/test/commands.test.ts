import { GatewayError, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { CerebroRepo, PERSISTENT_WELCOME_KEY } from '../src/index.js';
import { CH, events, join, register, setupCerebro, USER } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const repoOf = (tc: TestContext) => new CerebroRepo(tc.db, tc.gateway.guildId, tc.clock, tc.runtime.newId);
const staffRoleId = (tc: TestContext) => tc.gateway.roleByName('Conselho da Legião')?.id ?? '';

describe('opt-ins', () => {
  it('toggles roles, stores optIns and emits player.optins_changed', async () => {
    t = await setupCerebro();
    await register(t);
    const a = await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:optin:live_ping' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:optin:rivals_duelist' });
    expect(t.gateway.memberRoleNames(USER)).toContain('Aviso de Live');
    expect(t.gateway.memberRoleNames(USER)).toContain('Duelista');
    expect(t.gateway.lastReply(a)?.components?.[0]?.[0]).toMatchObject({
      label: '✅ Aviso de Live',
      style: 'success',
    });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:optin:live_ping' });
    expect(t.gateway.memberRoleNames(USER)).not.toContain('Aviso de Live');
    const member = await t.runtime.providers.readModels().members.getByDiscordId(USER);
    expect(member?.optIns).toEqual(['rivals_duelist']);
    expect((await events(t, 'player.optins_changed')).map((e) => e.optIns)).toEqual([
      ['live_ping'],
      ['live_ping', 'rivals_duelist'],
      ['rivals_duelist'],
    ]);
  });

  it('refuses keys outside optInRoles and unregistered members', async () => {
    t = await setupCerebro();
    await register(t);
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:optin:staff_owner' });
    expect(t.gateway.memberRoleNames(USER)).not.toContain('Professor X');
    await join(t, '400000000000000009');
    const id = await t.interact({
      kind: 'command',
      userId: '400000000000000009',
      commandName: 'cerebro',
      subcommand: 'preferencias',
    });
    expect(t.gateway.lastReply(id)?.content).toContain('ainda não é um mutante registrado');
  });

  it('/cerebro preferencias shows the current state', async () => {
    t = await setupCerebro();
    await register(t);
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:optin:rivals_strategist' });
    const id = await t.interact({
      kind: 'command',
      userId: USER,
      commandName: 'cerebro',
      subcommand: 'preferencias',
    });
    const labels = t.gateway.lastReply(id)?.components?.[0]?.map((b) => ('label' in b ? b.label : ''));
    expect(labels).toEqual(['⬜ Aviso de Live', '⬜ Vanguarda', '⬜ Duelista', '✅ Estrategista']);
  });
});

describe('rank.changed', () => {
  it('swaps rank roles, updates members.rank, and is idempotent', async () => {
    t = await setupCerebro();
    await register(t);
    const member = await repoOf(t).memberByDiscordId(USER);
    const emit = () =>
      t?.runtime.bus.forSource('jarvis').transaction((tx) =>
        t?.runtime.bus.forSource('jarvis').emit(tx, 'rank.changed', {
          memberId: member?.id ?? '',
          discordUserId: USER,
          from: 'recruta',
          to: 'agente',
        }),
      );
    await emit();
    await t.runtime.bus.drain();
    expect(t.gateway.memberRoleNames(USER)).toEqual(['Agente', 'Mutante Registrado', 'X-Men']);
    expect((await repoOf(t).memberByDiscordId(USER))?.rank).toBe('agente');
    const writes = () =>
      t?.gateway.calls.filter((c) => c.method === 'addMemberRole' || c.method === 'removeMemberRole').length;
    const before = writes();
    await emit();
    await t.runtime.bus.drain();
    expect(writes()).toBe(before);
  });

  it('ignores unknown members', async () => {
    t = await setupCerebro();
    const bus = t.runtime.bus.forSource('jarvis');
    await bus.transaction((tx) =>
      bus.emit(tx, 'rank.changed', { memberId: 'nope', discordUserId: '1', from: 'recruta', to: 'agente' }),
    );
    await t.runtime.bus.drain();
    expect(await events(t, 'rank.changed')).toHaveLength(1);
  });
});

describe('role failures', () => {
  it('keeps the DB state and lets the reconcile job fix roles later', async () => {
    t = await setupCerebro();
    await join(t);
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:start' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:rules' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:faction', values: ['xmen'] });
    await t.interact({
      kind: 'component',
      userId: USER,
      customId: 'cerebro:v1:archetype',
      values: ['Elemental'],
    });
    t.gateway.failNext('addMemberRole', new GatewayError('Missing Permissions', 50013));
    const id = await t.interact({
      kind: 'modal',
      userId: USER,
      customId: 'cerebro:v1:mutant',
      fields: { codinome: 'Raio Azul', poder: 'Raios', origem: 'Caiu um raio.' },
    });
    expect(t.gateway.lastReply(id)?.content).toContain('Não consegui ajustar seus cargos');
    expect((await repoOf(t).memberByDiscordId(USER))?.onboardingStep).toBe('registered');
    t.clock.advance(5_000);
    await t.settle();
    expect(t.gateway.memberRoleNames(USER)).toEqual(['Mutante Registrado', 'Recruta', 'X-Men']);
  });
});

describe('/perfil', () => {
  it('shows the card ephemerally with a share button that posts publicly', async () => {
    t = await setupCerebro();
    await register(t);
    t.runtime.profile.add('jarvis', async () => [{ name: 'Nível', value: '3' }]);
    const id = await t.interact({ kind: 'command', userId: USER, commandName: 'perfil', options: {} });
    const reply = t.gateway.lastReply(id);
    expect(reply?.ephemeral).toBe(true);
    expect(reply?.embeds?.[0]?.title).toBe('🧬 Faísca Rubra');
    expect(reply?.embeds?.[0]?.fields?.map((f) => f.name)).toEqual([
      'Arquétipo',
      'Facção',
      'Rank',
      'Poder',
      'Origem',
      'Nível',
    ]);
    const share = reply?.components?.[0]?.[0];
    const shareId = share && 'customId' in share ? (share.customId ?? '') : '';
    await t.interact({ kind: 'component', userId: USER, customId: shareId, channelId: CH.general });
    const posted = t.gateway.messages.find((m) => m.channelId === CH.general);
    expect(posted?.msg.embeds?.[0]?.title).toBe('🧬 Faísca Rubra');
    expect(posted?.msg.ephemeral).toBeFalsy();
  });

  it('answers not registered for others and points self to the welcome channel', async () => {
    t = await setupCerebro();
    await join(t);
    const self = await t.interact({ kind: 'command', userId: USER, commandName: 'perfil', options: {} });
    expect(t.gateway.lastReply(self)?.content).toBe(
      `Você ainda não é um mutante registrado. Comece pelo canal <#${CH.welcome}>.`,
    );
    const other = await t.interact({
      kind: 'command',
      userId: USER,
      commandName: 'perfil',
      options: { membro: '777' },
    });
    expect(t.gateway.lastReply(other)?.content).toBe('Esse membro ainda não é um mutante registrado.');
  });
});

describe('/cerebro setup and status', () => {
  it('refuses non-staff members', async () => {
    t = await setupCerebro();
    t.gateway.addMember({ userId: '11' });
    const id = await t.interact({
      kind: 'command',
      userId: '11',
      commandName: 'cerebro',
      subcommand: 'setup',
      options: {},
    });
    expect(t.gateway.lastReply(id)?.content).toContain('Apenas a staff');
  });

  it('dry-runs by default, applies channel visibility on request, and is a no-op the second time', async () => {
    t = await setupCerebro();
    t.gateway.addChannel({
      id: '300000000000000010',
      name: 'staff',
      overwrites: [{ id: t.gateway.guildId, type: 'role', allow: [], deny: ['ViewChannel'] }],
    });
    t.gateway.addMember({ userId: '12', roleIds: [staffRoleId(t)] });
    const dry = await t.interact({
      kind: 'command',
      userId: '12',
      commandName: 'cerebro',
      subcommand: 'setup',
      options: { canais: true },
    });
    const dryText = t.gateway.lastReply(dry)?.content ?? '';
    expect(dryText).toContain('Simulação');
    expect(dryText).toContain('#general: esconder de @everyone');
    expect(dryText).not.toContain('#staff');
    expect(dryText).not.toContain('#welcome');
    expect(t.gateway.callsOf('setChannelPermissionOverwrite')).toHaveLength(0);

    const apply = await t.interact({
      kind: 'command',
      userId: '12',
      commandName: 'cerebro',
      subcommand: 'setup',
      options: { aplicar: true, canais: true },
    });
    expect(t.gateway.lastReply(apply)?.content).toContain('Mensagem fixa de boas-vindas: publicada');
    expect(t.gateway.channels.get(CH.general)?.overwrites.map((o) => o.deny.concat(o.allow))).toEqual([
      ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'],
      ['ViewChannel'],
      ['ViewChannel'],
    ]);
    expect(await t.runtime.kv.get(PERSISTENT_WELCOME_KEY)).toMatchObject({ channelId: CH.welcome });

    const again = await t.interact({
      kind: 'command',
      userId: '12',
      commandName: 'cerebro',
      subcommand: 'setup',
      options: { aplicar: true, canais: true },
    });
    const text = t.gateway.lastReply(again)?.content ?? '';
    expect(text).toContain('Cargos: nada a mudar.');
    expect(text).toContain('Canais: nada a mudar.');
    expect(text).toContain('Mensagem fixa de boas-vindas: atualizada');
  });

  it('never hides a channel from @everyone after an earlier step failed, and reports a failed welcome post', async () => {
    t = await setupCerebro();
    t.gateway.addMember({ userId: '12', roleIds: [staffRoleId(t)] });
    t.gateway.failNext('setChannelPermissionOverwrite', new GatewayError('Missing Access', 50001));
    t.gateway.failNext('sendMessage', new GatewayError('Missing Access', 50001));
    const id = await t.interact({
      kind: 'command',
      userId: '12',
      commandName: 'cerebro',
      subcommand: 'setup',
      options: { aplicar: true, canais: true },
    });
    const text = t.gateway.lastReply(id)?.content ?? '';
    expect(text).toContain('⚠️ #registry: Missing Access');
    expect(text).toContain('Mensagem fixa de boas-vindas: ⚠️ Missing Access');
    const everyoneDeny = (id: string) =>
      t?.gateway.channels.get(id)?.overwrites.find((o) => o.id === t?.gateway.guildId)?.deny ?? [];
    expect(everyoneDeny(CH.registry)).not.toContain('ViewChannel'); // stopped after the failure
    expect(everyoneDeny(CH.general)).toContain('ViewChannel'); // other channels still applied
  });

  it('the guild owner can run setup without a staff role, and status reports steps and missing roles', async () => {
    t = await setupCerebro();
    await register(t);
    const reg = t.gateway.roleByName('Mutante Registrado')?.id;
    const m = t.gateway.members.get(USER);
    if (m) m.roleIds = m.roleIds.filter((r) => r !== reg); // an admin removed it by hand
    t.gateway.addMember({ userId: '13' });
    const st = await t.interact({
      kind: 'command',
      userId: '13',
      commandName: 'cerebro',
      subcommand: 'status',
      isGuildOwner: true,
    });
    const fields = t.gateway.lastReply(st)?.embeds?.[0]?.fields ?? [];
    expect(fields[0]?.value).toContain('registered: **1**');
    expect(fields.find((f) => f.name.startsWith('Registrados sem'))?.value).toBe('1');
    await t.interact({
      kind: 'command',
      userId: '13',
      commandName: 'cerebro',
      subcommand: 'setup',
      options: { aplicar: true },
      isGuildOwner: true,
    });
    expect(t.gateway.memberRoleNames(USER)).toContain('Mutante Registrado');
  });

  it('warns about the role hierarchy', async () => {
    t = await setupCerebro();
    const xmen = t.gateway.roleByName('X-Men');
    if (xmen) xmen.position = 500;
    t.gateway.addMember({ userId: '13' });
    const st = await t.interact({
      kind: 'command',
      userId: '13',
      commandName: 'cerebro',
      subcommand: 'status',
      isGuildOwner: true,
    });
    expect(t.gateway.lastReply(st)?.content).toContain('Meu cargo está abaixo destes cargos');
    expect(t.gateway.lastReply(st)?.content).toContain('X-Men');
  });
});

describe('role sync on ready', () => {
  it('creates the role set once and never the TikTok role', async () => {
    t = await setupCerebro();
    expect(t.gateway.roleByName('Mutante Registrado')).toBeDefined();
    expect(t.gateway.roleByName('Assinante TikTok')).toBeUndefined();
    const creates = t.gateway.callsOf('createRole').length;
    await t.runtime.ready({ startPolling: false });
    expect(t.gateway.callsOf('createRole')).toHaveLength(creates);
  });
});
