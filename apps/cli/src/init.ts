import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  type BotId,
  botClientIdVar,
  botTokenVar,
  DEFAULT_FACTIONS,
  type Locale,
  parseConfig,
  parseEnv,
} from '@legion/core';
import { AVAILABLE_BOTS } from '@legion/runner';
import { parse as parseYaml, stringify } from 'yaml';
import {
  type ChannelFillExisting,
  type ChannelFillResult,
  type FactionFill,
  fillChannelIds,
} from './channel-fill.js';
import type { DiscordRest } from './rest.js';
import { RestError } from './rest.js';

export interface InitAnswers {
  token: string;
  clientId: string;
  guildId: string;
  locale: Locale;
  bots: BotId[];
  /** Bots with their own Discord app (optional). */
  ownApps?: Partial<Record<BotId, { token: string; clientId: string }>>;
}

export const isSnowflake = (v: string) => /^\d{17,20}$/.test(v.trim());

/** YAML integers as bigint so unquoted Discord IDs keep every digit (same as parseConfigText). */
function unbigint(v: unknown): unknown {
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (Array.isArray(v)) return v.map(unbigint);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unbigint(x)]));
  return v;
}

export function envFile(a: InitAnswers): string {
  return [
    '# Segredos apenas. O resto vai em legion.config.yaml.',
    `CEREBRO_TOKEN=${a.token.trim()}`,
    `CEREBRO_CLIENT_ID=${a.clientId.trim()}`,
    `DISCORD_GUILD_ID=${a.guildId.trim()}`,
    ...Object.entries(a.ownApps ?? {}).flatMap(([bot, app]) => [
      `# ${bot}: app própria no Discord`,
      `${botTokenVar(bot as BotId)}=${app.token.trim()}`,
      `${botClientIdVar(bot as BotId)}=${app.clientId.trim()}`,
    ]),
    'DATABASE_URL=file:./data/legion.db',
    'LOG_LEVEL=info',
    'HEALTH_PORT=8080',
    '',
  ].join('\n');
}

export function factionsForWrite(fill: ChannelFillResult): Record<string, unknown>[] {
  const byKey = new Map(fill.factions.map((f) => [f.key, f]));
  return DEFAULT_FACTIONS.map((def) => {
    const f = byKey.get(def.key);
    return {
      key: def.key,
      roleKey: def.roleKey,
      emoji: def.emoji,
      ...(def.origins ? { origins: [...def.origins] } : {}),
      ...(f?.categoryId ? { categoryId: f.categoryId } : {}),
      ...(f?.newsChannelId ? { newsChannelId: f.newsChannelId } : {}),
      ...(f?.squadChannelId ? { squadChannelId: f.squadChannelId } : {}),
    };
  });
}

/** D44 config object: locale, bots, full channels.*, DEFAULT_FACTIONS + area IDs, optional herbie tips. */
export function configDoc(a: InitAnswers, fill: ChannelFillResult): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    locale: a.locale,
    timezone: 'America/Sao_Paulo',
    bots: a.bots.filter((b) => AVAILABLE_BOTS.includes(b)),
    channels: fill.channels,
    factions: factionsForWrite(fill),
  };
  if (fill.herbieTipsChannelId) {
    doc.herbie = { tips: { channelId: fill.herbieTipsChannelId } };
  }
  return doc;
}

export function stringifyConfig(doc: unknown): string {
  return stringify(doc, { lineWidth: 0 });
}

export function configFile(a: InitAnswers, fill: ChannelFillResult = fillChannelIds([])): string {
  return (
    '# Gerado por "legion init". Veja docs/CONFIG.md para todas as opções.\n' +
    '# IDs preenchidos pelos nomes do modelo; confira o relatório e rode "legion doctor".\n' +
    stringifyConfig(configDoc(a, fill))
  );
}

function tipChannelId(raw: Record<string, unknown>): string | null {
  const herbie = raw.herbie;
  if (!herbie || typeof herbie !== 'object') return null;
  const tips = (herbie as { tips?: { channelId?: string | null } }).tips;
  const id = tips?.channelId;
  return id == null || id === '' ? null : String(id);
}

export function existingFromRaw(raw: Record<string, unknown>): ChannelFillExisting {
  const cfg = parseConfig(raw);
  const factions: FactionFill[] = cfg.factions.map((f) => ({
    key: f.key,
    roleKey: f.roleKey,
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.newsChannelId ? { newsChannelId: f.newsChannelId } : {}),
    ...(f.squadChannelId ? { squadChannelId: f.squadChannelId } : {}),
  }));
  return {
    channels: { ...cfg.channels },
    factions,
    herbieTipsChannelId: tipChannelId(raw),
  };
}

function patchFactionRow(
  row: Record<string, unknown>,
  filled: FactionFill | undefined,
): Record<string, unknown> {
  const next = { ...row };
  for (const key of ['categoryId', 'newsChannelId', 'squadChannelId'] as const) {
    const id = filled?.[key];
    if (id) next[key] = id;
    else delete next[key];
  }
  return next;
}

/** Patch channels / factions / herbie tips on a raw YAML doc (keeps other keys). */
export function applyFillToRaw(
  raw: Record<string, unknown>,
  fill: ChannelFillResult,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  const prevChannels =
    raw.channels && typeof raw.channels === 'object' && !Array.isArray(raw.channels)
      ? (raw.channels as Record<string, unknown>)
      : {};
  out.channels = { ...prevChannels, ...fill.channels };

  const byKey = new Map(fill.factions.map((f) => [f.key, f]));
  if (Array.isArray(raw.factions) && raw.factions.length > 0) {
    out.factions = raw.factions.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const key = (row as { key?: string }).key;
      return patchFactionRow(row as Record<string, unknown>, key ? byKey.get(key) : undefined);
    });
  } else {
    out.factions = factionsForWrite(fill);
  }

  if (fill.herbieTipsChannelId) {
    const prevHerbie =
      raw.herbie && typeof raw.herbie === 'object' && !Array.isArray(raw.herbie)
        ? (raw.herbie as Record<string, unknown>)
        : {};
    const prevTips =
      prevHerbie.tips && typeof prevHerbie.tips === 'object' && !Array.isArray(prevHerbie.tips)
        ? (prevHerbie.tips as Record<string, unknown>)
        : {};
    out.herbie = { ...prevHerbie, tips: { ...prevTips, channelId: fill.herbieTipsChannelId } };
  }

  return out;
}

export function fillWouldOverwrite(
  channels: Parameters<typeof fillChannelIds>[0],
  existing: ChannelFillExisting,
): boolean {
  const kept = fillChannelIds(channels, existing, { overwrite: false });
  const forced = fillChannelIds(channels, existing, { overwrite: true });
  return (
    JSON.stringify(kept.channels) !== JSON.stringify(forced.channels) ||
    JSON.stringify(kept.factions) !== JSON.stringify(forced.factions) ||
    kept.herbieTipsChannelId !== forced.herbieTipsChannelId
  );
}

export function formatRestFillError(err: unknown): string {
  if (err instanceof RestError) {
    const hint =
      err.status === 401 ? 'token' : err.status === 403 ? 'access' : err.status === 404 ? 'guild' : 'http';
    return `HTTP ${err.status} (${hint}): ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function writeOne(
  path: string,
  content: string,
  mode: number,
  overwrite: () => Promise<boolean>,
): Promise<boolean> {
  const write = !existsSync(path) || (await overwrite());
  if (write) writeFileSync(path, content, { mode });
  return write;
}

/** Writes .env and legion.config.yaml; `overwrite(file)` decides for existing files. */
export async function writeInitFiles(
  dir: string,
  a: InitAnswers,
  overwrite: (file: string) => Promise<boolean>,
  fill: ChannelFillResult = fillChannelIds([]),
): Promise<{ file: string; written: boolean }[]> {
  const out = [];
  for (const [file, content, mode] of [
    ['.env', envFile(a), 0o600],
    ['legion.config.yaml', configFile(a, fill), 0o644],
  ] as const) {
    const path = `${dir}/${file}`;
    const written = await writeOne(path, content, mode, () => overwrite(file));
    out.push({ file, written });
  }
  return out;
}

export type FreshInitFillResult =
  | { ok: true; envWritten: boolean; configWritten: boolean; report: string[] }
  | { ok: false; envWritten: boolean; error: string };

/** Fresh init: write .env, REST guildChannels → fill → write D44 YAML (or abort YAML on REST error). */
export async function runFreshInitFill(opts: {
  dir: string;
  answers: InitAnswers;
  overwrite: (file: string) => Promise<boolean>;
  createRest: (token: string) => DiscordRest;
}): Promise<FreshInitFillResult> {
  const envPath = `${opts.dir}/.env`;
  const envWritten = await writeOne(envPath, envFile(opts.answers), 0o600, () => opts.overwrite('.env'));

  let fill: ChannelFillResult;
  try {
    const rest = opts.createRest(opts.answers.token.trim());
    const channels = await rest.guildChannels(opts.answers.guildId.trim());
    fill = fillChannelIds(channels);
  } catch (err) {
    return { ok: false, envWritten, error: formatRestFillError(err) };
  }

  const configPath = `${opts.dir}/legion.config.yaml`;
  const configWritten = await writeOne(configPath, configFile(opts.answers, fill), 0o644, () =>
    opts.overwrite('legion.config.yaml'),
  );
  return { ok: true, envWritten, configWritten, report: fill.report };
}

export type FillChannelsResult = { ok: true; report: string[] } | { ok: false; error: string };

/** `--fill-channels`: load .env + YAML, fill nulls (or force), confirm if replacing. */
export async function runFillChannels(opts: {
  dir: string;
  force: boolean;
  confirmReplace: () => Promise<boolean>;
  createRest: (token: string) => DiscordRest;
  envSource?: Record<string, string | undefined>;
  configPath?: string;
}): Promise<FillChannelsResult> {
  const configPath = opts.configPath ?? `${opts.dir}/legion.config.yaml`;
  if (!existsSync(configPath)) {
    return { ok: false, error: `${configPath}: arquivo não encontrado` };
  }

  let envSource = opts.envSource;
  if (!envSource) {
    const envPath = `${opts.dir}/.env`;
    if (existsSync(envPath)) process.loadEnvFile(envPath);
    envSource = process.env;
  }
  const env = parseEnv(envSource);

  let raw: Record<string, unknown>;
  try {
    raw = (unbigint(parseYaml(readFileSync(configPath, 'utf8'), { intAsBigInt: true })) ?? {}) as Record<
      string,
      unknown
    >;
    parseConfig(raw);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const existing = existingFromRaw(raw);
  let channels: Awaited<ReturnType<DiscordRest['guildChannels']>>;
  try {
    channels = await opts.createRest(env.main.token).guildChannels(env.DISCORD_GUILD_ID);
  } catch (err) {
    return { ok: false, error: formatRestFillError(err) };
  }

  let overwrite = opts.force;
  if (!overwrite && fillWouldOverwrite(channels, existing)) {
    overwrite = await opts.confirmReplace();
  }

  const fill = fillChannelIds(channels, existing, { overwrite });
  const patched = applyFillToRaw(raw, fill);
  writeFileSync(
    configPath,
    `# Atualizado por "legion init --fill-channels". Veja docs/CONFIG.md.\n${stringifyConfig(patched)}`,
    { mode: 0o644 },
  );
  return { ok: true, report: fill.report };
}
