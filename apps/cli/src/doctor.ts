import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import {
  type AnyLegionBot,
  type AppPlan,
  CORE_MIGRATIONS_DIR,
  ConfigError,
  CoreRuntime,
  createDb,
  type DoctorStatus,
  type Env,
  FakeRandomSource,
  type LegionConfig,
  type LegionDb,
  type Locale,
  parseEnv,
  planApps,
  silentLogger,
  systemClock,
} from '@legion/core';
import { loadConfigAndBots } from '@legion/runner';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { count } from 'drizzle-orm';
import { integer as pgInteger, pgTable } from 'drizzle-orm/pg-core';
import { integer, sqliteTable } from 'drizzle-orm/sqlite-core';
import { type MessageKey, msg } from './messages.js';
import { channelPermissions, missingPermissions } from './permissions.js';
import { type DiscordRest, RestError } from './rest.js';
import { createRestGateway } from './rest-gateway.js';

export interface CheckResult {
  id: string;
  title: string;
  status: DoctorStatus | 'skip';
  message: string;
  fix?: string;
}

export interface DoctorOptions {
  locale: Locale;
  envSource: Record<string, string | undefined>;
  configPath: string;
  rest: (token: string) => DiscordRest;
  /** Opens the DB without migrating (defaults to createDb). */
  openDb?: (url: string) => Promise<LegionDb>;
}

const GATEWAY_GUILD_MEMBERS = 1 << 14;
const GATEWAY_GUILD_MEMBERS_LIMITED = 1 << 15;
const CHANNEL_PERMS = {
  'Ver canal': PermissionFlagsBits.ViewChannel,
  'Enviar mensagens': PermissionFlagsBits.SendMessages,
  'Inserir links': PermissionFlagsBits.EmbedLinks,
};

/** Number of migrations a package ships vs. how many the DB recorded. */
async function pendingMigrations(db: LegionDb, packageId: string, dir: string): Promise<boolean> {
  const journal = join(dir, db.dialect === 'pg' ? 'pg' : 'sqlite', 'meta', '_journal.json');
  if (!existsSync(journal)) return false;
  const shipped = (JSON.parse(readFileSync(journal, 'utf8')) as { entries: unknown[] }).entries.length;
  const table =
    db.dialect === 'pg'
      ? (pgTable(`__migrations_${packageId}`, { id: pgInteger('id') }) as unknown as ReturnType<
          typeof sqliteTable
        >)
      : sqliteTable(`__migrations_${packageId}`, { id: integer('id') });
  try {
    const [row] = await db.orm.select({ n: count() }).from(table);
    return Number(row?.n ?? 0) < shipped;
  } catch {
    return true; // table does not exist yet
  }
}

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

/** Token, application id, intents and guild membership of one Discord app. */
async function checkApp(
  a: AppPlan,
  rest: DiscordRest,
  allBots: AnyLegionBot[],
  guildId: string,
  t: T,
  appLabel: string | null,
  add: (r: CheckResult) => void,
  skip: (id: string, title: string) => void,
) {
  const sfx = appLabel ? t('check.app_suffix', { app: appLabel, bots: a.bots.join(', ') }) : '';
  const id = (base: string) => (appLabel && appLabel !== 'main' ? `${base}:${appLabel}` : base);
  const title = (k: MessageKey) => `${t(k)}${sfx}`;
  let botUserId: string | null = null;
  let applicationId: string | null = null;
  let inGuild = false;
  try {
    const me = await rest.me();
    botUserId = me.id;
    add({
      id: id('token'),
      title: title('check.token'),
      status: 'ok',
      message: t('check.token.ok', { name: me.username }),
    });
  } catch (err) {
    const status = err instanceof RestError ? err.status : 0;
    add({
      id: id('token'),
      title: title('check.token'),
      status: 'fail',
      message: status === 401 ? `${t('check.token.fail')} (${a.tokenVar})` : (err as Error).message,
      fix: t('check.token.fix'),
    });
  }
  if (!botUserId) {
    skip(id('app'), title('check.app'));
    skip(id('intents'), title('check.intents'));
    skip(id('guild'), title('check.guild'));
    return { botUserId, applicationId, inGuild };
  }
  const app = await rest.application();
  applicationId = app.id;
  if (app.id === a.clientId)
    add({
      id: id('app'),
      title: title('check.app'),
      status: 'ok',
      message: t('check.app.ok', { var: a.clientIdVar }),
    });
  else
    add({
      id: id('app'),
      title: title('check.app'),
      status: 'fail',
      message: t('check.app.fail', { var: a.clientIdVar, given: a.clientId, actual: app.id }),
      fix: t('check.app.fix'),
    });
  const appBots = allBots.filter((b) => a.bots.includes(b.id));
  const needsMembers = appBots.some((b) => b.intents.includes(2 /* GuildMembers */));
  const hasMembers = ((app.flags ?? 0) & (GATEWAY_GUILD_MEMBERS | GATEWAY_GUILD_MEMBERS_LIMITED)) !== 0;
  if (!needsMembers || hasMembers)
    add({ id: id('intents'), title: title('check.intents'), status: 'ok', message: t('check.intents.ok') });
  else
    add({
      id: id('intents'),
      title: title('check.intents'),
      status: 'fail',
      message: t('check.intents.fail'),
      fix: t('check.intents.fix'),
    });
  const member = await rest.guildMember(guildId, botUserId);
  if (member) {
    inGuild = true;
    const guild = await rest.guild(guildId);
    add({
      id: id('guild'),
      title: title('check.guild'),
      status: 'ok',
      message: t('check.guild.ok', { name: guild.name }),
    });
  } else
    add({
      id: id('guild'),
      title: title('check.guild'),
      status: 'fail',
      message: t('check.guild.fail', { guild: guildId }),
      fix: t('check.guild.fix'),
    });
  return { botUserId, applicationId, inGuild };
}

/** Runs every check and returns the results (✅ ok, ℹ️ info, ⚠️ warn, ❌ fail). Never throws. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True when the port can be bound, or is already served by a Legion dashboard (it serves its CSS). */
async function portUsable(port: number): Promise<boolean> {
  const free = await new Promise<boolean>((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '0.0.0.0', () => srv.close(() => resolve(true)));
  });
  if (free) return true;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/assets/dashboard.css`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok && (res.headers.get('content-type') ?? '').includes('text/css');
  } catch {
    return false;
  }
}

/** ❌ on without the secret or the port taken; ⚠️ publicUrl neither localhost nor https. Never shows the secret. */
export async function dashboardCheck(
  config: LegionConfig,
  env: Env | null,
  t: (k: MessageKey, v?: Record<string, string | number>) => string,
  usable: (port: number) => Promise<boolean> = portUsable,
): Promise<CheckResult> {
  const d = config.dashboard;
  const base = { id: 'dashboard', title: t('check.dashboard') };
  if (!d.enabled) return { ...base, status: 'info', message: t('check.dashboard.off') };
  if (!env?.DASHBOARD_CLIENT_SECRET)
    return {
      ...base,
      status: 'fail',
      message: t('check.dashboard.no_secret'),
      fix: t('check.dashboard.no_secret_fix'),
    };
  if (!(await usable(d.port)))
    return {
      ...base,
      status: 'fail',
      message: t('check.dashboard.port', { port: d.port }),
      fix: t('check.dashboard.port_fix'),
    };
  const url = new URL(d.publicUrl);
  if (url.protocol !== 'https:' && !LOCAL_HOSTS.has(url.hostname))
    return {
      ...base,
      status: 'warn',
      message: t('check.dashboard.insecure', { url: d.publicUrl }),
      fix: t('check.dashboard.insecure_fix'),
    };
  return { ...base, status: 'ok', message: t('check.dashboard.ok', { url: d.publicUrl, port: d.port }) };
}

export async function runDoctor(o: DoctorOptions): Promise<CheckResult[]> {
  const L = o.locale;
  const t = (k: MessageKey, v: Record<string, string | number> = {}) => msg(L, k, v);
  const results: CheckResult[] = [];
  const add = (r: CheckResult) => results.push(r);
  const skip = (id: string, title: string) => add({ id, title, status: 'skip', message: t('skipped') });

  // 1. env
  let env: Env | null = null;
  try {
    env = parseEnv(o.envSource, L);
    if (env.legacyVars.length)
      add({
        id: 'env',
        title: t('check.env'),
        status: 'warn',
        message: t('check.env.legacy', { vars: env.legacyVars.join(', ') }),
        fix: t('check.env.legacy_fix'),
      });
    else add({ id: 'env', title: t('check.env'), status: 'ok', message: t('check.env.ok') });
  } catch (err) {
    const lines = err instanceof ConfigError ? err.lines.join('; ') : String(err);
    add({ id: 'env', title: t('check.env'), status: 'fail', message: lines, fix: t('check.env.fix') });
  }

  // 2. config
  let config: LegionConfig | null = null;
  let bots: AnyLegionBot[] = [];
  try {
    ({ config, bots } = await loadConfigAndBots(o.configPath));
    add({
      id: 'config',
      title: t('check.config'),
      status: 'ok',
      message: t('check.config.ok', { bots: config.bots.join(', ') }),
    });
  } catch (err) {
    const message = err instanceof ConfigError ? err.lines.join('\n') : (err as Error).message;
    add({ id: 'config', title: t('check.config'), status: 'fail', message, fix: t('check.config.fix') });
  }

  if (config) add(await dashboardCheck(config, env, t));

  // 3. Discord, per app: token, application, intents, guild. `main` (Cérebro's app) is used afterwards.
  let botUserId: string | null = null;
  let applicationId: string | null = null;
  let inGuild = false;
  let rest: DiscordRest | null = null;
  const plan = env ? planApps(env, config ? bots.map((b) => b.id) : ['cerebro']) : null;
  if (plan?.errors.length)
    add({
      id: 'apps',
      title: t('check.apps'),
      status: 'fail',
      message: plan.errors.join('\n'),
      fix: t('check.apps.fix'),
    });
  const several = (plan?.apps.length ?? 0) > 1;
  const appInfos: {
    key: string;
    bots: string[];
    rest: DiscordRest;
    botUserId: string | null;
    inGuild: boolean;
  }[] = [];
  if (!env || !plan) {
    for (const [id, k] of [
      ['token', 'check.token'],
      ['app', 'check.app'],
      ['intents', 'check.intents'],
      ['guild', 'check.guild'],
    ] as const)
      skip(id, t(k));
  } else
    for (const a of plan.apps) {
      const appRest = o.rest(a.token);
      const res = await checkApp(
        a,
        appRest,
        bots,
        env.DISCORD_GUILD_ID,
        t,
        several ? a.key : null,
        add,
        skip,
      );
      appInfos.push({
        key: a.key,
        bots: a.bots,
        rest: appRest,
        botUserId: res.botUserId,
        inGuild: res.inGuild,
      });
      if (a.key === 'main') {
        rest = appRest;
        ({ botUserId, applicationId, inGuild } = res);
      }
    }

  // 3b. server-wide permissions of each app's bot role (what its bots ask for in the invite link)
  if (env && config)
    for (const app of appInfos) {
      const suffix = several ? ` — app ${app.key} (${app.bots.join(', ')})` : '';
      if (!app.botUserId || !app.inGuild) {
        skip(`perms:${app.key}`, `${t('check.perms')}${suffix}`);
        continue;
      }
      const [member, roles] = await Promise.all([
        app.rest.guildMember(env.DISCORD_GUILD_ID, app.botUserId),
        app.rest.guildRoles(env.DISCORD_GUILD_ID),
      ]);
      const needed = bots
        .filter((b) => app.bots.includes(b.id))
        .reduce((acc, b) => b.permissions.reduce((x, p) => x | p, acc), 0n);
      const byId = new Map(roles.map((r) => [r.id, r]));
      let have = BigInt(byId.get(env.DISCORD_GUILD_ID)?.permissions ?? '0');
      for (const id of member?.roles ?? []) have |= BigInt(byId.get(id)?.permissions ?? '0');
      const missing =
        have & PermissionFlagsBits.Administrator ? [] : new PermissionsBitField(needed & ~have).toArray();
      const count = new PermissionsBitField(needed).toArray().length;
      add(
        missing.length
          ? {
              id: `perms:${app.key}`,
              title: `${t('check.perms')}${suffix}`,
              status: 'fail',
              message: t('check.perms.missing', { perms: missing.join(', ') }),
              fix: t('check.perms.fix'),
            }
          : {
              id: `perms:${app.key}`,
              title: `${t('check.perms')}${suffix}`,
              status: 'ok',
              message: t('check.perms.ok', { count, bots: app.bots.join(', ') }),
            },
      );
    }

  // 4. channels: config.channels with the main app, plus each bot's own channels with the app hosting it
  if (env && rest && config && botUserId && inGuild) {
    const [channels, roles] = await Promise.all([
      rest.guildChannels(env.DISCORD_GUILD_ID),
      rest.guildRoles(env.DISCORD_GUILD_ID),
    ]);
    const cfg = config;
    const targets: { key: string; id: string; app: (typeof appInfos)[number] | undefined }[] = [];
    const main = appInfos.find((x) => x.key === 'main');
    for (const [key, id] of Object.entries(cfg.channels)) if (id) targets.push({ key, id, app: main });
    // US-34: each team's news channel is posted to by ULTRON.
    const ultronApp = appInfos.find((x) => x.bots.includes('ultron')) ?? main;
    if (cfg.bots.includes('ultron'))
      for (const f of cfg.factions)
        if (f.newsChannelId)
          targets.push({ key: `factions.${f.key}.newsChannelId`, id: f.newsChannelId, app: ultronApp });
    for (const b of bots)
      for (const c of b.doctorChannels?.((cfg as Record<string, unknown>)[b.id]) ?? [])
        if (c.id) targets.push({ key: c.key, id: c.id, app: appInfos.find((x) => x.bots.includes(b.id)) });
    const members = new Map<string, Awaited<ReturnType<DiscordRest['guildMember']>>>();
    const problems: string[] = [];
    for (const { key, id, app } of targets) {
      const ch = channels.find((c) => c.id === id);
      if (!ch) {
        problems.push(t('check.channels.missing', { key, id }));
        continue;
      }
      if (!app?.botUserId || !app.inGuild) continue; // that app's own checks already failed
      if (!members.has(app.key))
        members.set(app.key, await app.rest.guildMember(env.DISCORD_GUILD_ID, app.botUserId));
      const member = members.get(app.key);
      const perms = channelPermissions(
        env.DISCORD_GUILD_ID,
        { ...(member ?? { roles: [] }), id: app.botUserId },
        roles,
        ch,
      );
      const missing = missingPermissions(perms, CHANNEL_PERMS);
      const label = several && app.key !== 'main' ? `${key} (app ${app.key})` : key;
      if (missing.length)
        problems.push(t('check.channels.perms', { key: label, name: ch.name, perms: missing.join(', ') }));
    }
    if (problems.length)
      add({
        id: 'channels',
        title: t('check.channels'),
        status: 'fail',
        message: problems.join('\n'),
        fix: t('check.channels.fix'),
      });
    else
      add({
        id: 'channels',
        title: t('check.channels'),
        status: 'ok',
        message: t('check.channels.ok', { count: targets.length }),
      });
  } else skip('channels', t('check.channels'));

  // 5. database (no migrations are applied here)
  let db: LegionDb | null = null;
  if (env) {
    try {
      db = await (o.openDb ?? createDb)(env.DATABASE_URL);
      const pending: string[] = [];
      if (await pendingMigrations(db, 'core', CORE_MIGRATIONS_DIR)) pending.push('core');
      for (const b of bots)
        if (b.migrationsDir && (await pendingMigrations(db, b.id, b.migrationsDir))) pending.push(b.id);
      add({
        id: 'db',
        title: t('check.db'),
        status: pending.length ? 'warn' : 'ok',
        message: pending.length
          ? t('check.db.pending', { dialect: db.dialect, pkgs: pending.join(', ') })
          : t('check.db.ok', { dialect: db.dialect }),
      });
    } catch (err) {
      add({
        id: 'db',
        title: t('check.db'),
        status: 'fail',
        message: t('check.db.fail', { error: (err as Error).message }),
        fix: t('check.db.fix'),
      });
    }
  } else skip('db', t('check.db'));

  // 6. each enabled bot's own checks (read-only REST gateway; nothing is written to Discord or the DB)
  if (env && rest && config && db && botUserId && applicationId && inGuild) {
    const runtime = new CoreRuntime({
      config,
      db,
      gateway: createRestGateway(rest, env.DISCORD_GUILD_ID, botUserId, applicationId),
      clock: systemClock,
      random: new FakeRandomSource(),
      log: silentLogger(),
      guildId: env.DISCORD_GUILD_ID,
    });
    for (const bot of bots) {
      for (const check of bot.doctorChecks?.(runtime.contextFor(bot)) ?? []) {
        try {
          add({ id: check.id, title: check.title, ...(await check.run()) });
        } catch (err) {
          add({ id: check.id, title: check.title, status: 'fail', message: (err as Error).message });
        }
      }
    }
  }
  await db?.close().catch(() => {});
  return results;
}

const ICON: Record<CheckResult['status'], string> = {
  ok: '✅',
  info: 'ℹ️ ',
  warn: '⚠️ ',
  fail: '❌',
  skip: '⏭️ ',
};

export function formatDoctor(results: CheckResult[], locale: Locale): string {
  const lines = [msg(locale, 'doctor.title'), ''];
  for (const r of results) {
    lines.push(`${ICON[r.status]} ${r.title}: ${r.message.split('\n').join('\n     ')}`);
    if (r.fix && r.status !== 'ok') lines.push(`   → ${r.fix}`);
  }
  const failed = results.filter((r) => r.status === 'fail').length;
  lines.push(
    '',
    failed ? msg(locale, 'doctor.summary_fail', { count: failed }) : msg(locale, 'doctor.summary_ok'),
  );
  return lines.join('\n');
}

export const doctorExitCode = (results: CheckResult[]) => (results.some((r) => r.status === 'fail') ? 1 : 0);
