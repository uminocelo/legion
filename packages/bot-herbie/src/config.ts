import { z } from 'zod';

const snowflake = z.string().regex(/^\d{5,25}$/, 'expected a Discord id');

export const herbieConfigSchema = z.object({
  /** Tutorial messages: DM first (falls back to the channel), or always the channel. */
  delivery: z.enum(['dm', 'channel']).default('dm'),
  tutorial: z
    .object({ enabled: z.boolean().default(true), allowSkip: z.boolean().default(true) })
    .prefault({}),
  tips: z
    .object({
      enabled: z.boolean().default(false),
      channelId: snowflake.nullable().default(null),
      cron: z.string().min(9).default('0 12 * * *'),
    })
    .prefault({}),
  explainWorldEvents: z.boolean().default(true),
});

export type HerbieConfig = z.infer<typeof herbieConfigSchema>;
export const defaultHerbieConfig = (): HerbieConfig => herbieConfigSchema.parse({});
