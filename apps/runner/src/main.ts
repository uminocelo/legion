#!/usr/bin/env node
import type { Server } from 'node:http';
import {
  ConfigError,
  type CoreRuntime,
  createLogger,
  cryptoRandomSource,
  DiscordJsGateway,
  parseEnv,
  planApps,
  startHealthServer,
  systemClock,
} from '@legion/core';
import { type Client, Events } from 'discord.js';
import { createClient, wireClient } from './discord.js';
import {
  buildRuntime,
  DEFAULT_CONFIG_PATH,
  describeBootError,
  loadConfigAndBots,
  loadDotEnv,
} from './runtime.js';

async function main(): Promise<void> {
  loadDotEnv();
  let log = createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    pretty: Boolean(process.stdout.isTTY) && process.env.NODE_ENV !== 'production',
  });
  let runtime: CoreRuntime | null = null;
  let server: Server | null = null;
  let ready = false;

  const fatal = (err: unknown): never => {
    log.fatal(describeBootError(err));
    process.exit(1);
  };

  const { config, bots } = await loadConfigAndBots(process.env.LEGION_CONFIG ?? DEFAULT_CONFIG_PATH).catch(
    fatal,
  );
  const env = (() => {
    try {
      return parseEnv(process.env, config.locale);
    } catch (err) {
      return fatal(err);
    }
  })();
  log = createLogger({
    level: env.LOG_LEVEL,
    pretty: Boolean(process.stdout.isTTY) && process.env.NODE_ENV !== 'production',
  });

  const plan = planApps(
    env,
    bots.map((b) => b.id),
  );
  if (plan.errors.length) fatal(new ConfigError(plan.errors.map((e) => `.env → ${e}`)));
  // One discord.js client per app; `main` (Cérebro's app) is first.
  const apps = plan.apps.map((a) => {
    const appBots = bots.filter((b) => a.bots.includes(b.id));
    const client = createClient(appBots);
    return { ...a, client, gateway: new DiscordJsGateway(client, env.DISCORD_GUILD_ID) };
  });
  const main = apps.find((a) => a.key === 'main') ?? apps[0];
  if (!main) return fatal(new Error('nenhum bot ligado'));
  log.info({ apps: apps.map((a) => ({ discordApp: a.key, bots: a.bots })) }, 'discord apps planned');

  runtime = await buildRuntime({
    env,
    config,
    bots,
    gateway: main.gateway,
    apps: apps.filter((a) => a !== main).map((a) => ({ key: a.key, gateway: a.gateway, bots: a.bots })),
    log,
    clock: systemClock,
    random: cryptoRandomSource,
    localesOverrideDir: 'locales',
  }).catch(fatal);
  for (const a of apps) wireClient(a.client, a.gateway, () => runtime, env.DISCORD_GUILD_ID, log, a.key);

  const connected = new Set<string>();
  for (const a of apps)
    a.client.once(Events.ClientReady, async (c) => {
      log.info({ discordApp: a.key, user: c.user.tag }, 'connected to Discord');
      if (!c.guilds.cache.has(env.DISCORD_GUILD_ID))
        log.error(
          { discordApp: a.key, guildId: env.DISCORD_GUILD_ID },
          'this app is not in the guild; invite it with "legion invite-url"',
        );
      connected.add(a.key);
      if (connected.size < apps.length) return;
      try {
        await runtime?.ready();
        ready = true;
        log.info('Legion is ready');
      } catch (err) {
        log.error({ err }, 'ready sequence failed');
      }
    });

  server = await startHealthServer(env.HEALTH_PORT, {
    dbOk: async () => (runtime ? runtime.db.ping() : false),
    discordReady: () => ready && apps.every((a) => a.client.isReady()),
  }).catch((err) => {
    log.warn({ err, port: env.HEALTH_PORT }, 'health server not started');
    return null;
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutting down');
    await runtime?.stop(10_000);
    await Promise.all(apps.map((a) => a.client.destroy()));
    server?.close();
    await runtime?.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled rejection'));

  for (const a of apps) await login(a.client, a.token, a.tokenVar, fatal);
}

/** Logs in one app with readable errors that name its env var (never the token). */
async function login(client: Client, token: string, tokenVar: string, fatal: (err: unknown) => never) {
  try {
    await client.login(token);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'TokenInvalid')
      fatal(
        new Error(
          `${tokenVar} inválido. Gere um novo token no Developer Portal (Bot → Reset Token) e atualize o .env.`,
        ),
      );
    if (String((err as Error).message).includes('disallowed intents'))
      fatal(
        new Error(
          `Intents privilegiadas não liberadas para ${tokenVar}. No Developer Portal → Bot, ligue "Server Members Intent".`,
        ),
      );
    fatal(err);
  }
}

main().catch((err) => {
  console.error(describeBootError(err));
  process.exit(1);
});
