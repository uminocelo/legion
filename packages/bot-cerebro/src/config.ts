import { ARCHETYPES } from '@legion/core';
import { z } from 'zod';

export const cerebroConfigSchema = z
  .object({
    welcomePing: z.boolean().default(true),
    persistentWelcome: z.boolean().default(true),
    publicRegistryCard: z.boolean().default(true),
    codename: z
      .object({ min: z.number().int().min(1).default(2), max: z.number().int().max(32).default(32) })
      .prefault({}),
    archetypes: z
      .array(z.enum(ARCHETYPES))
      .min(1)
      .default([...ARCHETYPES]),
    optInRoles: z
      .array(z.string())
      .default(['live_ping', 'rivals_vanguard', 'rivals_duelist', 'rivals_strategist'])
      .refine((a) => a.length <= 20, { message: 'max 20' }),
    canonAttemptFlag: z
      .object({
        count: z.number().int().min(1).default(3),
        windowMinutes: z.number().int().min(1).default(10),
      })
      .prefault({}),
    setup: z
      .object({
        excludeChannelIds: z
          .array(z.string().regex(/^\d{5,25}$/, { message: 'config.snowflake' }))
          .default([]),
      })
      .prefault({}),
  })
  .refine((c) => c.codename.min <= c.codename.max, {
    message: 'codename.min > codename.max',
    path: ['codename'],
  });

export type CerebroConfig = z.infer<typeof cerebroConfigSchema>;
