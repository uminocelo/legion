import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

export const envSchema = z.object({
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
