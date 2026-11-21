import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type AnyLegionBot,
  type BotId,
  type Clock,
  ConfigError,
  CoreRuntime,
  createDb,
  type DashboardServer,
  type DiscordGateway,
  type Env,
  type LegionConfig,
  type LegionDb,
  type Logger,
  parseConfigText,
  type RandomSource,
  redactUrl,
} from '@legion/core';
import { parse as parseYaml } from 'yaml';
import { loadBotModules } from './bots.js';

export const DEFAULT_CONFIG_PATH = 'legion.config.yaml';

/** Reads which bots are enabled before full validation (their schemas are needed for it). */
export function enabledBotIds(text: string): BotId[] {
  try {
    const raw = parseYaml(text) as { bots?: unknown } | null;
    return Array.isArray(raw?.bots)
      ? (raw.bots.filter((b) => typeof b === 'string') as BotId[])
      : ['cerebro'];
  } catch {
    return ['cerebro'];
  }
}

export interface LoadedConfig {
  config: LegionConfig;
  bots: AnyLegionBot[];
  path: string;
}

/** Loads legion.config.yaml, imports the enabled bots and validates every section. */
export async function loadConfigAndBots(path = DEFAULT_CONFIG_PATH): Promise<LoadedConfig> {
  const full = resolve(path);
  if (!existsSync(full))
    throw new ConfigError([
      `${path}: arquivo não encontrado; copie legion.config.example.yaml para legion.config.yaml (ou rode "legion init")`,
    ]);
  const text = readFileSync(full, 'utf8');
  const bots = await loadBotModules(enabledBotIds(text));
  const schemas = Object.fromEntries(bots.map((b) => [b.id, b.configSchema]));
  const config = parseConfigText(text, schemas, path.split('/').pop() ?? path);
  return { config, bots, path: full };
}

export interface BuildRuntimeOptions {
  env: Env;
  config: LegionConfig;
  bots: AnyLegionBot[];
  gateway: DiscordGateway;
  log: Logger;
  clock: Clock;
  random: RandomSource;
  db?: LegionDb;
  localesOverrideDir?: string;
  /** Extra Discord apps (bots with their own token); `gateway` is the main app. */
  apps?: { key: string; gateway: DiscordGateway; bots: BotId[] }[];
}

/** DB + migrations + core services + enabled bots, ready to connect. */
export async function buildRuntime(o: BuildRuntimeOptions): Promise<CoreRuntime> {
  const db = o.db ?? (await createDb(o.env.DATABASE_URL));
  o.log.info({ databaseUrl: redactUrl(o.env.DATABASE_URL), dialect: db.dialect }, 'database opened');
  const runtime = new CoreRuntime({
    config: o.config,
    db,
    gateway: o.gateway,
    clock: o.clock,
    random: o.random,
    log: o.log,
    guildId: o.env.DISCORD_GUILD_ID,
    ...(o.apps?.length ? { apps: o.apps } : {}),
    ...(o.localesOverrideDir && existsSync(o.localesOverrideDir)
      ? { localesOverrideDir: o.localesOverrideDir }
      : {}),
  });
  await runtime.migrateCore();
  await runtime.loadBots(o.bots);
  o.log.info({ bots: runtime.enabledBotIds() }, 'bots loaded');
  return runtime;
}

/**
 * Starts the staff dashboard when `dashboard.enabled` (US-20). Off, or on without
 * `DASHBOARD_CLIENT_SECRET`, nothing listens (the bots keep running; doctor shows the error).
 */
export async function startDashboard(
  runtime: CoreRuntime,
  env: Env,
  config: LegionConfig,
  log: Logger,
  opts: { host?: string; port?: number } = {},
): Promise<DashboardServer | null> {
  if (!config.dashboard.enabled) return null;
  if (!env.DASHBOARD_CLIENT_SECRET) {
    log.error(
      'dashboard.enabled is true but DASHBOARD_CLIENT_SECRET is not set; the dashboard is off (see docs/DASHBOARD.md)',
    );
    return null;
  }
  const dashboard = runtime.dashboardServer({
    clientId: env.main.clientId,
    clientSecret: env.DASHBOARD_CLIENT_SECRET,
    ...opts,
  });
  try {
    const port = await dashboard.start();
    log.info({ port, publicUrl: config.dashboard.publicUrl }, 'dashboard listening');
    return dashboard;
  } catch (err) {
    log.error({ err, port: opts.port ?? config.dashboard.port }, 'dashboard not started');
    return null;
  }
}

/** Loads `.env` from the working directory if present (Docker passes env vars directly). */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

/** One readable block for fatal boot errors. */
export function describeBootError(err: unknown): string {
  if (err instanceof ConfigError) return `Configuração inválida:\n  ${err.lines.join('\n  ')}`;
  return err instanceof Error ? err.message : String(err);
}

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}
