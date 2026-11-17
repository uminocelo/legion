import { z } from 'zod';
import { BOT_IDS, type BotId } from './schema.js';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const snowflake = z.string().regex(/^\d{5,25}$/, { message: 'config.snowflake' });

/** Optional per-bot app: `<BOT>_TOKEN` and `<BOT>_CLIENT_ID` (e.g. `JARVIS_TOKEN`). */
const perBot = Object.fromEntries(
  BOT_IDS.flatMap((b) => [
    [`${b.toUpperCase()}_TOKEN`, optional],
    [`${b.toUpperCase()}_CLIENT_ID`, optional.pipe(snowflake.optional())],
  ]),
) as Record<string, typeof optional>;

export const envSchema = z.object({
  ...perBot,
  DISCORD_TOKEN: z.string().min(1, { message: 'config.env_required' }),
  DISCORD_CLIENT_ID: z.string().regex(/^\d{5,25}$/, { message: 'config.snowflake' }),
  DISCORD_GUILD_ID: z.string().regex(/^\d{5,25}$/, { message: 'config.snowflake' }),
  DATABASE_URL: optional.transform((v) => v ?? 'file:./data/legion.db'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  AI_BASE_URL: optional,
  AI_API_KEY: optional,
  AI_MODEL: optional,
});
export type Env = z.infer<typeof envSchema>;

export const botTokenVar = (bot: BotId) => `${bot.toUpperCase()}_TOKEN`;
export const botClientIdVar = (bot: BotId) => `${bot.toUpperCase()}_CLIENT_ID`;

/** One Discord application the runner connects as. */
export interface AppPlan {
  /** `main` for the app hosting Cérebro (roles, member events); otherwise the first bot's id. */
  key: string;
  token: string;
  clientId: string;
  /** Env var names, for messages (never the values). */
  tokenVar: string;
  clientIdVar: string;
  bots: BotId[];
}

/**
 * Groups the enabled bots into Discord apps. A bot with `<BOT>_TOKEN` uses its own app; the others
 * share `DISCORD_TOKEN`. Bots with the same token share an app. The app hosting Cérebro is `main`.
 * Returns errors for half-configured pairs (token without client id or the reverse).
 */
export function planApps(env: Env, enabled: readonly BotId[]): { apps: AppPlan[]; errors: string[] } {
  const e = env as unknown as Record<string, string | undefined>;
  const errors: string[] = [];
  const byToken = new Map<string, AppPlan>();
  const order = [...enabled].sort((a, b) => (a === 'cerebro' ? -1 : b === 'cerebro' ? 1 : 0));
  for (const bot of order) {
    const tv = botTokenVar(bot);
    const cv = botClientIdVar(bot);
    const token = e[tv];
    const clientId = e[cv];
    if (Boolean(token) !== Boolean(clientId)) {
      errors.push(`${token ? cv : tv}: obrigatório quando ${token ? tv : cv} está definido`);
      continue;
    }
    const own = token && clientId ? { token, clientId, tokenVar: tv, clientIdVar: cv } : null;
    const app = own ?? {
      token: env.DISCORD_TOKEN,
      clientId: env.DISCORD_CLIENT_ID,
      tokenVar: 'DISCORD_TOKEN',
      clientIdVar: 'DISCORD_CLIENT_ID',
    };
    const prev = byToken.get(app.token);
    if (prev) {
      if (prev.clientId !== app.clientId)
        errors.push(`${app.clientIdVar}: o mesmo token foi usado com outro client id (${prev.clientIdVar})`);
      prev.bots.push(bot);
      continue;
    }
    byToken.set(app.token, { key: bot === 'cerebro' ? 'main' : bot, ...app, bots: [bot] });
  }
  const apps = [...byToken.values()];
  const ids = new Map<string, string>();
  for (const a of apps) {
    const dup = ids.get(a.clientId);
    if (dup) errors.push(`${a.clientIdVar}: a mesma aplicação de ${dup} com outro token`);
    ids.set(a.clientId, a.clientIdVar);
  }
  return { apps, errors };
}
