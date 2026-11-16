import { existsSync, writeFileSync } from 'node:fs';
import type { BotId, Locale } from '@legion/core';
import { AVAILABLE_BOTS } from '@legion/runner';
import { stringify } from 'yaml';

export interface InitAnswers {
  token: string;
  clientId: string;
  guildId: string;
  locale: Locale;
  bots: BotId[];
}

export const isSnowflake = (v: string) => /^\d{17,20}$/.test(v.trim());

export function envFile(a: InitAnswers): string {
  return [
    '# Segredos apenas. O resto vai em legion.config.yaml.',
    `DISCORD_TOKEN=${a.token.trim()}`,
    `DISCORD_CLIENT_ID=${a.clientId.trim()}`,
    `DISCORD_GUILD_ID=${a.guildId.trim()}`,
    'DATABASE_URL=file:./data/legion.db',
    'LOG_LEVEL=info',
    'HEALTH_PORT=8080',
    '',
  ].join('\n');
}

export function configFile(a: InitAnswers): string {
  const doc = {
    locale: a.locale,
    timezone: 'America/Sao_Paulo',
    bots: a.bots.filter((b) => AVAILABLE_BOTS.includes(b)),
    channels: { welcome: null, rules: null, registry: null },
  };
  return `# Gerado por "legion init". Veja docs/CONFIG.md para todas as opções.\n# Preencha os IDs dos canais (modo desenvolvedor → botão direito → Copiar ID).\n${stringify(doc)}`;
}

/** Writes .env and legion.config.yaml; `overwrite(file)` decides for existing files. */
export async function writeInitFiles(
  dir: string,
  a: InitAnswers,
  overwrite: (file: string) => Promise<boolean>,
): Promise<{ file: string; written: boolean }[]> {
  const out = [];
  for (const [file, content] of [
    ['.env', envFile(a)],
    ['legion.config.yaml', configFile(a)],
  ] as const) {
    const path = `${dir}/${file}`;
    const write = !existsSync(path) || (await overwrite(file));
    if (write) writeFileSync(path, content, { mode: file === '.env' ? 0o600 : 0o644 });
    out.push({ file, written: write });
  }
  return out;
}
