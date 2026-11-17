import { z } from 'zod';

const pos = z.number().int().min(1);

export const sentinelConfigSchema = z.object({
  combat: z
    .object({
      maxRounds: pos.max(100).default(20),
      roundTimeoutSeconds: z.number().int().min(10).max(600).default(45),
      powerCooldownRounds: pos.max(20).default(3),
      abandonAfterIdleRounds: pos.max(20).default(3),
    })
    .prefault({}),
  training: z
    .object({
      cooldownSeconds: z.number().int().min(0).default(300),
      dummyAtkMultiplier: z.number().min(0.1).max(2).default(0.7),
    })
    .prefault({}),
  rateLimits: z
    .object({
      commandsPerMinute: pos.default(20),
      componentsPer10Seconds: pos.default(15),
      reportsPerHour: pos.default(3),
      violationsToFlag: pos.default(5),
    })
    .prefault({}),
  antiCheat: z
    .object({ xpAnomalyPerHour: pos.default(600), newAccountDays: z.number().int().min(0).default(7) })
    .prefault({}),
  moderation: z
    .object({
      enabled: z.boolean().default(true),
      timeoutOptionsMinutes: z.array(z.number().int().min(1).max(40320)).min(1).max(4).default([10, 60]),
    })
    .prefault({}),
});

export type SentinelConfig = z.infer<typeof sentinelConfigSchema>;
export const defaultSentinelConfig = (): SentinelConfig => sentinelConfigSchema.parse({});
