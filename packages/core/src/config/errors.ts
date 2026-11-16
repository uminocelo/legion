import type { z } from 'zod';
import type { Locale } from './schema.js';

type Messages = Record<string, string>;

/** Config errors are shown before i18n is loaded, so they carry their own small dictionary. */
const MESSAGES: Record<Locale, Messages> = {
  'pt-BR': {
    'config.hex_color': 'use uma cor hex como "#3498DB"',
    'config.role_key': 'use só letras minúsculas, números e "_", como "rank_agente"',
    'config.snowflake': 'use o ID numérico do Discord entre aspas, como "123456789012345678"',
    'config.timezone': 'use um fuso horário IANA, como "America/Sao_Paulo"',
    'config.cerebro_required':
      'o Cérebro é obrigatório quando qualquer outro bot está ligado; use por exemplo bots: [cerebro, jarvis]',
    'config.duplicate_key': 'esta chave já existe na lista; cada chave deve ser única',
    'config.tiktok_managed':
      'o cargo "tiktok_sub" pertence à integração do TikTok; use managedBy: integration',
    'config.unknown_role': 'nenhum cargo em "roles" tem esta chave',
    'config.env_required': 'obrigatório; preencha no arquivo .env',
    'config.yaml_syntax': 'o YAML é inválido',
    'config.file_missing': 'arquivo não encontrado; copie legion.config.example.yaml para legion.config.yaml',
    invalid_type: 'tipo inválido (esperado {expected})',
    invalid_value: 'valor inválido; use um de: {values}',
    too_small: 'valor muito pequeno (mínimo {minimum})',
    too_big: 'valor muito grande (máximo {maximum})',
    unrecognized_keys: 'chave desconhecida: {keys}',
    invalid_format: 'formato inválido',
    fallback: 'valor inválido',
  },
  en: {
    'config.hex_color': 'use a hex color like "#3498DB"',
    'config.role_key': 'use only lowercase letters, digits and "_", like "rank_agente"',
    'config.snowflake': 'use the numeric Discord ID in quotes, like "123456789012345678"',
    'config.timezone': 'use an IANA timezone like "America/Sao_Paulo"',
    'config.cerebro_required':
      'Cérebro is required when any other bot is enabled; for example bots: [cerebro, jarvis]',
    'config.duplicate_key': 'this key already exists in the list; each key must be unique',
    'config.tiktok_managed':
      'the "tiktok_sub" role belongs to the TikTok integration; use managedBy: integration',
    'config.unknown_role': 'no role in "roles" has this key',
    'config.env_required': 'required; fill it in .env',
    'config.yaml_syntax': 'the YAML is invalid',
    'config.file_missing': 'file not found; copy legion.config.example.yaml to legion.config.yaml',
    invalid_type: 'invalid type (expected {expected})',
    invalid_value: 'invalid value; use one of: {values}',
    too_small: 'value too small (minimum {minimum})',
    too_big: 'value too large (maximum {maximum})',
    unrecognized_keys: 'unknown key: {keys}',
    invalid_format: 'invalid format',
    fallback: 'invalid value',
  },
};

export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else out += out ? `.${String(seg)}` : String(seg);
  }
  return out || '(raiz)';
}

const fill = (tpl: string, vars: Record<string, unknown>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));

export function configMessage(locale: Locale, key: string, vars: Record<string, unknown> = {}): string {
  const dict = MESSAGES[locale];
  return fill(dict[key] ?? MESSAGES['pt-BR'][key] ?? key, vars);
}

/** Turns one zod issue into a readable sentence. */
export function describeIssue(issue: z.core.$ZodIssue, locale: Locale): string {
  const dict = MESSAGES[locale];
  if (issue.message && dict[issue.message]) return configMessage(locale, issue.message);
  const anyIssue = issue as unknown as Record<string, unknown>;
  switch (issue.code) {
    case 'invalid_value':
      return configMessage(locale, 'invalid_value', {
        values: ((anyIssue.values as unknown[]) ?? []).map((v) => JSON.stringify(v)).join(', '),
      });
    case 'unrecognized_keys':
      return configMessage(locale, 'unrecognized_keys', {
        keys: ((anyIssue.keys as string[]) ?? []).join(', '),
      });
    case 'invalid_type':
    case 'too_small':
    case 'too_big':
    case 'invalid_format':
      return configMessage(locale, issue.code, anyIssue);
    default:
      return configMessage(locale, 'fallback');
  }
}

export class ConfigError extends Error {
  constructor(readonly lines: string[]) {
    super(lines.join('\n'));
    this.name = 'ConfigError';
  }
}

export function formatIssues(
  file: string,
  issues: readonly z.core.$ZodIssue[],
  locale: Locale,
  prefix: readonly PropertyKey[] = [],
): string[] {
  return issues.map((i) => `${file} → ${formatPath([...prefix, ...i.path])}: ${describeIssue(i, locale)}`);
}
