import { createDb, type Env, FakeRandomSource, silentLogger, systemClock } from '@legion/core';
import { buildRuntime, loadConfigAndBots } from '@legion/runner';
import type { DiscordRest } from './rest.js';
import { createRestGateway } from './rest-gateway.js';

/** Registers every enabled bot's slash commands now (the runner also does it on start when they change). */
export async function registerCommands(env: Env, configPath: string, rest: DiscordRest): Promise<string[]> {
  const { config, bots } = await loadConfigAndBots(configPath);
  const me = await rest.me();
  const gateway = createRestGateway(rest, env.DISCORD_GUILD_ID, me.id, env.DISCORD_CLIENT_ID);
  // A throwaway in-memory DB: we only need the command JSON, not the real data.
  const db = await createDb('file::memory:');
  const runtime = await buildRuntime({
    env,
    config,
    bots,
    gateway,
    log: silentLogger(),
    clock: systemClock,
    random: new FakeRandomSource(),
    db,
  });
  const commands = runtime.router.commandJson();
  await gateway.registerCommands(commands);
  await runtime.close();
  return commands.map((c) => (c as { name: string }).name);
}
