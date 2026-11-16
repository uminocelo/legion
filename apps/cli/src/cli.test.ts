import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cerebro } from '@legion/bot-cerebro';
import { createTestDb } from '@legion/core';
import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { doctorExitCode, formatDoctor, runDoctor } from './doctor.js';
import { configFile, isSnowflake, writeInitFiles } from './init.js';
import { invitePermissions, inviteUrl } from './invite.js';
import { channelPermissions } from './permissions.js';
import { type ApiChannel, type ApiRole, type DiscordRest, RestError } from './rest.js';

const GUILD = '100000000000000001';
const BOT = '200000000000000001';
const APP = '123456789012345678';
const CH = { welcome: '300000000000000001', rules: '300000000000000002' };
const P = PermissionFlagsBits;
const basic = (P.ViewChannel | P.SendMessages | P.EmbedLinks).toString();

function fakeRest(
  over: Partial<{
    tokenOk: boolean;
    flags: number;
    inGuild: boolean;
    rolePerms: string;
    channels: ApiChannel[];
    roles: ApiRole[];
  }> = {},
): DiscordRest {
  const o = { tokenOk: true, flags: 1 << 15, inGuild: true, rolePerms: basic, ...over };
  const roles: ApiRole[] = o.roles ?? [
    { id: GUILD, name: '@everyone', permissions: '0', position: 0, managed: false, color: 0 },
    { id: '900', name: 'Legion', permissions: o.rolePerms, position: 100, managed: true, color: 0 },
  ];
  const channels: ApiChannel[] = o.channels ?? [
    { id: CH.welcome, name: 'boas-vindas', type: 0, permission_overwrites: [] },
    { id: CH.rules, name: 'regras', type: 0, permission_overwrites: [] },
  ];
  return {
    me: async () => {
      if (!o.tokenOk) throw new RestError(401, 'unauthorized');
      return { id: BOT, username: 'Legion' };
    },
    application: async () => ({ id: APP, name: 'Legion', flags: o.flags }),
    guild: async () => ({ id: GUILD, name: 'Teste', owner_id: '1' }),
    guildMember: async (_g, u) =>
      o.inGuild && u === BOT ? { roles: ['900'], user: { id: BOT, bot: true } } : null,
    guildRoles: async () => roles,
    guildChannels: async () => channels,
    putGuildCommands: async () => {},
  };
}

const tmp = () => mkdtempSync(join(tmpdir(), 'legion-cli-'));
function configAt(dir: string, extra = '') {
  const path = join(dir, 'legion.config.yaml');
  writeFileSync(
    path,
    `bots: [cerebro]\nchannels:\n  welcome: '${CH.welcome}'\n  rules: '${CH.rules}'\n${extra}`,
  );
  return path;
}
const envOk = {
  DISCORD_TOKEN: 'x',
  DISCORD_CLIENT_ID: APP,
  DISCORD_GUILD_ID: GUILD,
  DATABASE_URL: 'file::memory:',
};
const doctor = (
  rest: DiscordRest,
  envSource: Record<string, string | undefined> = envOk,
  configPath = configAt(tmp()),
) => runDoctor({ locale: 'pt-BR', envSource, configPath, rest: () => rest, openDb: () => createTestDb() });
const status = (rs: Awaited<ReturnType<typeof runDoctor>>) =>
  Object.fromEntries(rs.map((r) => [r.id, r.status]));

describe('legion doctor', () => {
  it('passes when everything is set up (roles missing are only warnings)', async () => {
    const rs = await doctor(fakeRest());
    const s = status(rs);
    expect(s).toMatchObject({
      env: 'ok',
      config: 'ok',
      token: 'ok',
      app: 'ok',
      intents: 'ok',
      guild: 'ok',
      channels: 'ok',
    });
    expect(rs.filter((r) => r.status === 'fail')).toEqual([]);
    expect(doctorExitCode(rs)).toBe(0);
    expect(s.db).toBe('warn'); // fresh DB: migrations pending, applied on start
  });

  it('missing env skips Discord checks and exits 1 with a fix', async () => {
    const rs = await doctor(fakeRest(), {});
    expect(status(rs)).toMatchObject({ env: 'fail', token: 'skip', guild: 'skip', db: 'skip' });
    const out = formatDoctor(rs, 'pt-BR');
    expect(out).toContain('❌ Arquivo .env e variáveis');
    expect(out).toContain('→ Copie .env.example');
    expect(doctorExitCode(rs)).toBe(1);
  });

  it('explains a rejected token, a wrong client id and the members intent', async () => {
    expect(status(await doctor(fakeRest({ tokenOk: false })))).toMatchObject({ token: 'fail', app: 'skip' });
    const wrongApp = await doctor(fakeRest(), { ...envOk, DISCORD_CLIENT_ID: '999999999999999999' });
    expect(wrongApp.find((r) => r.id === 'app')?.message).toContain('999999999999999999');
    const noIntent = await doctor(fakeRest({ flags: 0 }));
    expect(noIntent.find((r) => r.id === 'intents')).toMatchObject({
      status: 'fail',
      fix: expect.stringContaining('Server Members Intent'),
    });
  });

  it('bot not in the guild points to invite-url', async () => {
    const rs = await doctor(fakeRest({ inGuild: false }));
    expect(rs.find((r) => r.id === 'guild')?.fix).toContain('legion invite-url');
    expect(status(rs).channels).toBe('skip');
  });

  it('reports missing channels and missing permissions per channel', async () => {
    const hidden: ApiChannel = {
      id: CH.rules,
      name: 'regras',
      type: 0,
      permission_overwrites: [{ id: '900', type: 0, allow: '0', deny: P.SendMessages.toString() }],
    };
    const rs = await doctor(fakeRest({ channels: [hidden] }));
    const msgText = rs.find((r) => r.id === 'channels')?.message ?? '';
    expect(msgText).toContain(`channels.welcome (${CH.welcome}) não existe`);
    expect(msgText).toContain('channels.rules (#regras): faltam Enviar mensagens');
  });

  it('reports invalid config lines', async () => {
    const dir = tmp();
    const rs = await doctor(fakeRest(), envOk, configAt(dir, 'cerebro:\n  welcomePing: talvez\n'));
    expect(rs.find((r) => r.id === 'config')).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('cerebro.welcomePing'),
    });
  });

  it('runs the bot checks (Cérebro hierarchy warning)', async () => {
    const rs = await doctor(fakeRest());
    expect(rs.some((r) => r.id.startsWith('cerebro.'))).toBe(true);
  });
});

describe('channelPermissions', () => {
  const roles: ApiRole[] = [
    {
      id: GUILD,
      name: '@everyone',
      permissions: P.ViewChannel.toString(),
      position: 0,
      managed: false,
      color: 0,
    },
    { id: 'r1', name: 'A', permissions: P.SendMessages.toString(), position: 1, managed: false, color: 0 },
  ];
  const ch = (ows: ApiChannel['permission_overwrites']): ApiChannel => ({
    id: 'c',
    name: 'c',
    type: 0,
    permission_overwrites: ows,
  });
  const m = { id: 'u', roles: ['r1'] };
  it('applies everyone, role and member overwrites in order', () => {
    expect(channelPermissions(GUILD, m, roles, ch([])) & P.SendMessages).toBe(P.SendMessages);
    const denyEveryone = ch([{ id: GUILD, type: 0, allow: '0', deny: P.ViewChannel.toString() }]);
    expect(channelPermissions(GUILD, m, roles, denyEveryone) & P.ViewChannel).toBe(0n);
    const roleAllow = ch([
      ...(denyEveryone.permission_overwrites ?? []),
      { id: 'r1', type: 0, allow: P.ViewChannel.toString(), deny: '0' },
    ]);
    expect(channelPermissions(GUILD, m, roles, roleAllow) & P.ViewChannel).toBe(P.ViewChannel);
    const memberDeny = ch([
      ...(roleAllow.permission_overwrites ?? []),
      { id: 'u', type: 1, allow: '0', deny: P.ViewChannel.toString() },
    ]);
    expect(channelPermissions(GUILD, m, roles, memberDeny) & P.ViewChannel).toBe(0n);
  });
  it('administrator bypasses overwrites', () => {
    const admin = [{ ...roles[1], permissions: P.Administrator.toString() } as ApiRole, roles[0] as ApiRole];
    expect(
      channelPermissions(
        GUILD,
        m,
        admin,
        ch([{ id: 'r1', type: 0, allow: '0', deny: P.ViewChannel.toString() }]),
      ) & P.ViewChannel,
    ).toBe(P.ViewChannel);
  });
});

describe('legion init', () => {
  const answers = {
    token: ' tok ',
    clientId: APP,
    guildId: GUILD,
    locale: 'pt-BR' as const,
    bots: ['cerebro' as const, 'ultron' as const],
  };
  it('writes .env (0600) and a config with only available bots', async () => {
    const dir = tmp();
    const r = await writeInitFiles(dir, answers, async () => false);
    expect(r.every((x) => x.written)).toBe(true);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('DISCORD_TOKEN=tok\n');
    expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600);
    expect(configFile(answers)).toContain('bots:\n  - cerebro\n');
  });
  it('keeps existing files unless confirmed', async () => {
    const dir = tmp();
    writeFileSync(join(dir, '.env'), 'OLD=1');
    const r = await writeInitFiles(dir, answers, async (f) => f !== '.env');
    expect(r).toEqual([
      { file: '.env', written: false },
      { file: 'legion.config.yaml', written: true },
    ]);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('OLD=1');
  });
  it('validates snowflakes', () => {
    expect(isSnowflake(APP)).toBe(true);
    expect(isSnowflake('abc')).toBe(false);
  });
});

describe('legion invite-url', () => {
  it('asks for the union of bot permissions and both scopes', () => {
    const url = new URL(inviteUrl(APP, [cerebro]));
    expect(url.searchParams.get('client_id')).toBe(APP);
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
    const perms = BigInt(url.searchParams.get('permissions') ?? '0');
    expect(perms).toBe(invitePermissions([cerebro]));
    expect(perms & P.ManageRoles).toBe(P.ManageRoles);
    expect(perms & P.Administrator).toBe(0n);
  });
});
