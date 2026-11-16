#!/usr/bin/env node
import type { Server } from 'node:http';
import {
  type CoreRuntime,
  createLogger,
  cryptoRandomSource,
  DiscordJsGateway,
  parseEnv,
  startHealthServer,
  systemClock,
} from '@legion/core';
import { Events } from 'discord.js';
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

  const client = createClient(bots);
  const gateway = new DiscordJsGateway(client, env.DISCORD_GUILD_ID);
  runtime = await buildRuntime({
    env,
    config,
    bots,
    gateway,
    log,
    clock: systemClock,
    random: cryptoRandomSource,
    localesOverrideDir: 'locales',
  }).catch(fatal);
  wireClient(client, gateway, () => runtime, env.DISCORD_GUILD_ID, log);

  client.once(Events.ClientReady, async (c) => {
    log.info({ user: c.user.tag }, 'connected to Discord');
    if (!c.guilds.cache.has(env.DISCORD_GUILD_ID))
      log.error(
        { guildId: env.DISCORD_GUILD_ID },
        'the bot is not in this guild; invite it with "legion invite-url"',
      );
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
    discordReady: () => ready && client.isReady(),
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
    await client.destroy();
    server?.close();
    await runtime?.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled rejection'));

  try {
    await client.login(env.DISCORD_TOKEN);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'TokenInvalid')
      fatal(
        new Error(
          'DISCORD_TOKEN inválido. Gere um novo token no Developer Portal (Bot → Reset Token) e atualize o .env.',
        ),
      );
    if (String((err as Error).message).includes('disallowed intents'))
      fatal(
        new Error(
          'Intents privilegiadas não liberadas. No Developer Portal → Bot, ligue "Server Members Intent".',
        ),
      );
    fatal(err);
  }
}

main().catch((err) => {
  console.error(describeBootError(err));
  process.exit(1);
});
