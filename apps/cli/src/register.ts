import {
  ConfigError,
  createDb,
  type Env,
  FakeRandomSource,
  planApps,
  silentLogger,
  systemClock,
} from '@legion/core';
import { buildRuntime, loadConfigAndBots } from '@legion/runner';
import type { DiscordRest } from './rest.js';
import { createRestGateway } from './rest-gateway.js';

export interface RegisteredApp {
  app: string;
  names: string[];
}

/**
 * Registers every enabled bot's slash commands now, on its own app (the runner also does it on start
 * when they change). Each app gets exactly its bots' commands, so a bot moved to its own app disappears
 * from the shared one.
 */
export async function registerCommands(
  env: Env,
  configPath: string,
  restFor: (token: string) => DiscordRest,
): Promise<RegisteredApp[]> {
  const { config, bots } = await loadConfigAndBots(configPath);
  const plan = planApps(
    env,
    bots.map((b) => b.id),
  );
  if (plan.errors.length) throw new ConfigError(plan.errors.map((e) => `.env → ${e}`));
  const apps = await Promise.all(
    plan.apps.map(async (a) => {
      const rest = restFor(a.token);
      const me = await rest.me();
      return { ...a, gateway: createRestGateway(rest, env.DISCORD_GUILD_ID, me.id, a.clientId) };
    }),
  );
  const main = apps.find((a) => a.key === 'main') ?? apps[0];
  if (!main) return [];
  // A throwaway in-memory DB: we only need the command JSON, not the real data.
  const db = await createDb('file::memory:');
  const runtime = await buildRuntime({
    env,
    config,
    bots,
    gateway: main.gateway,
    apps: apps.filter((a) => a !== main).map((a) => ({ key: a.key, gateway: a.gateway, bots: a.bots })),
    log: silentLogger(),
    clock: systemClock,
    random: new FakeRandomSource(),
    db,
  });
  const out: RegisteredApp[] = [];
  for (const a of apps) {
    const commands = runtime.router.commandJson(a.key);
    await a.gateway.registerCommands(commands);
    out.push({ app: a.key, names: commands.map((c) => (c as { name: string }).name) });
  }
  await runtime.close();
  return out;
}
