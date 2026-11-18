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

/** Old names of `CEREBRO_TOKEN` / `CEREBRO_CLIENT_ID` (still read; doctor and the log warn). */
export const LEGACY_MAIN_VARS = { token: 'DISCORD_TOKEN', clientId: 'DISCORD_CLIENT_ID' } as const;

const baseEnvSchema = z.object({
  ...perBot,
  DISCORD_TOKEN: optional,
  DISCORD_CLIENT_ID: optional.pipe(snowflake.optional()),
  DISCORD_GUILD_ID: z.string().regex(/^\d{5,25}$/, { message: 'config.snowflake' }),
  DATABASE_URL: optional.transform((v) => v ?? 'file:./data/legion.db'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  AI_BASE_URL: optional,
  AI_API_KEY: optional,
  AI_MODEL: optional,
});

type AppVars = { token: string; clientId: string; tokenVar: string; clientIdVar: string };
const pair = (v: Record<string, string | undefined>, token: string, clientId: string): AppVars | null =>
  v[token] && v[clientId]
    ? { token: v[token] as string, clientId: v[clientId] as string, tokenVar: token, clientIdVar: clientId }
    : null;

/**
 * - `CEREBRO_TOKEN` + `CEREBRO_CLIENT_ID`: Cérebro's app, the main one (required).
 * - `DISCORD_TOKEN` + `DISCORD_CLIENT_ID`: optional shared app for bots without their own; defaults to
 *   Cérebro's. Alone (no `CEREBRO_*`), it is the old name of the main app and still works (with a warning).
 */
export const envSchema = baseEnvSchema
  .superRefine(
    (e, ctx) => {
      const v = e as unknown as Record<string, string | undefined>;
      for (const [t, c] of [
        ['CEREBRO_TOKEN', 'CEREBRO_CLIENT_ID'],
        ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID'],
      ] as const)
        if (Boolean(v[t]) !== Boolean(v[c]))
          ctx.addIssue({ code: 'custom', path: [v[t] ? c : t], message: 'config.env_required' });
      if (!v.CEREBRO_TOKEN && !v.CEREBRO_CLIENT_ID && !v.DISCORD_TOKEN && !v.DISCORD_CLIENT_ID)
        for (const k of ['CEREBRO_TOKEN', 'CEREBRO_CLIENT_ID'])
          ctx.addIssue({ code: 'custom', path: [k], message: 'config.env_required' });
    },
    { when: () => true },
  ) // run even when other variables failed, so every problem shows at once
  .transform((e) => {
    const v = e as unknown as Record<string, string | undefined>;
    const cerebro = pair(v, 'CEREBRO_TOKEN', 'CEREBRO_CLIENT_ID');
    const discord = pair(v, LEGACY_MAIN_VARS.token, LEGACY_MAIN_VARS.clientId);
    return {
      ...e,
      /** Cérebro's app. */
      main: (cerebro ?? discord) as AppVars,
      /** The app shared by bots without their own. */
      shared: (discord ?? cerebro) as AppVars,
      /** Old variable names used for the main app (rename them in .env). */
      legacyVars: cerebro ? [] : [LEGACY_MAIN_VARS.token, LEGACY_MAIN_VARS.clientId],
    };
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
 * Groups the enabled bots into Discord apps. Cérebro uses the main app; a bot with `<BOT>_TOKEN` uses
 * its own; the others share `DISCORD_TOKEN` when set, else Cérebro's app. Bots with the same token share an app. The app hosting Cérebro is `main`.
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
    // Cérebro always runs on the main app (validated by the env schema).
    const token = bot === 'cerebro' ? env.main.token : e[tv];
    const clientId = bot === 'cerebro' ? env.main.clientId : e[cv];
    if (Boolean(token) !== Boolean(clientId)) {
      errors.push(`${token ? cv : tv}: obrigatório quando ${token ? tv : cv} está definido`);
      continue;
    }
    const own =
      bot !== 'cerebro' && token && clientId ? { token, clientId, tokenVar: tv, clientIdVar: cv } : null;
    const app = bot === 'cerebro' ? { ...env.main } : (own ?? { ...env.shared });
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
