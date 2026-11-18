import { z } from 'zod';
import { isValidTimeZone } from '../time/local-day.js';
import { DEFAULT_FACTIONS, DEFAULT_ROLES, factionSchema, roleSchema, TIKTOK_ROLE_KEY } from './roles.js';

export const BOT_IDS = ['cerebro', 'jarvis', 'herbie', 'sentinel', 'ultron'] as const;
export type BotId = (typeof BOT_IDS)[number];
export const LOCALES = ['pt-BR', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

const snowflake = z.string().regex(/^\d{5,25}$/, { message: 'config.snowflake' });
const optionalChannel = snowflake.nullable().default(null);

export const channelsSchema = z.object({
  welcome: optionalChannel,
  rules: optionalChannel,
  registry: optionalChannel,
  tutorial: optionalChannel,
  trivia: optionalChannel,
  events: optionalChannel,
  modQueue: optionalChannel,
  combat: optionalChannel,
  missions: optionalChannel,
});

export const sharedConfigSchema = z
  .object({
    locale: z.enum(LOCALES).default('pt-BR'),
    timezone: z.string().refine(isValidTimeZone, { message: 'config.timezone' }).default('America/Sao_Paulo'),
    bots: z.array(z.enum(BOT_IDS)).default(['cerebro']),
    channels: channelsSchema.prefault({}),
    roles: z.array(roleSchema).prefault(DEFAULT_ROLES),
    /** Absent = the default teams whose role exists in `roles` (a custom `roles` list keeps booting). */
    factions: z.array(factionSchema).optional(),
    events: z.object({ replayLookbackDays: z.number().int().positive().default(7) }).prefault({}),
    scheduler: z.object({ pollIntervalMs: z.number().int().min(500).default(5000) }).prefault({}),
  })
  .catchall(z.unknown())
  .superRefine((cfg, ctx) => {
    if (cfg.bots.length > 0 && !cfg.bots.includes('cerebro')) {
      ctx.addIssue({ code: 'custom', path: ['bots'], message: 'config.cerebro_required' });
    }
    if (cfg.bots.includes('ultron') && !cfg.bots.includes('sentinel')) {
      ctx.addIssue({ code: 'custom', path: ['bots'], message: 'config.sentinel_required' });
    }
    const keys = new Set<string>();
    cfg.roles.forEach((r, i) => {
      if (keys.has(r.key))
        ctx.addIssue({ code: 'custom', path: ['roles', i, 'key'], message: 'config.duplicate_key' });
      keys.add(r.key);
      if (r.key === TIKTOK_ROLE_KEY && r.managedBy !== 'integration') {
        ctx.addIssue({ code: 'custom', path: ['roles', i, 'managedBy'], message: 'config.tiktok_managed' });
      }
    });
    const fkeys = new Set<string>();
    (cfg.factions ?? []).forEach((f, i) => {
      if (!keys.has(f.roleKey))
        ctx.addIssue({ code: 'custom', path: ['factions', i, 'roleKey'], message: 'config.unknown_role' });
      if (fkeys.has(f.key))
        ctx.addIssue({ code: 'custom', path: ['factions', i, 'key'], message: 'config.duplicate_key' });
      fkeys.add(f.key);
    });
  })
  .transform((cfg) => ({
    ...cfg,
    factions:
      cfg.factions ??
      DEFAULT_FACTIONS.map((f) => factionSchema.parse(f)).filter((f) =>
        cfg.roles.some((r) => r.key === f.roleKey),
      ),
  }));

export type SharedConfig = z.infer<typeof sharedConfigSchema>;
/** The whole validated config: shared keys plus each bot's raw/validated section. */
export type LegionConfig = SharedConfig & Partial<Record<BotId, unknown>>;
