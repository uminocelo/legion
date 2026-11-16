import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import type { z } from 'zod';
import { type Env, envSchema } from './env.js';
import { ConfigError, configMessage, formatIssues } from './errors.js';
import { type BotId, type LegionConfig, LOCALES, type Locale, sharedConfigSchema } from './schema.js';

export type BotSchemas = Partial<Record<BotId, z.ZodType>>;

const guessLocale = (raw: unknown): Locale => {
  const l = (raw as { locale?: unknown } | null)?.locale;
  return (LOCALES as readonly unknown[]).includes(l) ? (l as Locale) : 'pt-BR';
};

/** Validates a parsed config object: shared keys plus every enabled bot's section. */
export function parseConfig(
  raw: unknown,
  botSchemas: BotSchemas = {},
  file = 'legion.config.yaml',
): LegionConfig {
  const locale = guessLocale(raw);
  const shared = sharedConfigSchema.safeParse(raw ?? {});
  if (!shared.success) throw new ConfigError(formatIssues(file, shared.error.issues, locale));
  const config: LegionConfig = { ...shared.data };
  const errors: string[] = [];
  for (const id of shared.data.bots) {
    const schema = botSchemas[id];
    if (!schema) continue;
    const res = schema.safeParse(config[id] ?? {});
    if (res.success) config[id] = res.data;
    else errors.push(...formatIssues(file, res.error.issues, shared.data.locale, [id]));
  }
  if (errors.length) throw new ConfigError(errors);
  return config;
}

export function parseConfigText(text: string, botSchemas: BotSchemas = {}, file = 'legion.config.yaml') {
  let raw: unknown;
  try {
    raw = parseYaml(text) ?? {};
  } catch (err) {
    const where = err instanceof YAMLParseError && err.linePos ? ` (linha ${err.linePos[0].line})` : '';
    throw new ConfigError([
      `${file}${where}: ${configMessage('pt-BR', 'config.yaml_syntax')}: ${(err as Error).message}`,
    ]);
  }
  return parseConfig(raw, botSchemas, file);
}

export function loadConfigFile(path: string, botSchemas: BotSchemas = {}): LegionConfig {
  if (!existsSync(path)) throw new ConfigError([`${path}: ${configMessage('pt-BR', 'config.file_missing')}`]);
  return parseConfigText(readFileSync(path, 'utf8'), botSchemas, path.split('/').pop() ?? path);
}

export function parseEnv(
  source: Record<string, string | undefined> = process.env,
  locale: Locale = 'pt-BR',
): Env {
  const res = envSchema.safeParse(source);
  if (!res.success) throw new ConfigError(formatIssues('.env', res.error.issues, locale));
  return res.data;
}
