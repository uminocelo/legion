import { z } from 'zod';

export const DIFFICULTIES = ['facil', 'normal', 'dificil'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
const cron = z.string().min(9);
const templateId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/);

export const ultronConfigSchema = z.object({
  combat: z.object({ maxRounds: z.number().int().min(1).max(100).default(20) }).prefault({}),
  scaling: z
    .object({
      growth: z.number().min(0).max(1).default(0.1),
      difficultyMultiplier: z
        .object({
          facil: z.number().positive().default(0.8),
          normal: z.number().positive().default(1),
          dificil: z.number().positive().default(1.25),
        })
        .prefault({}),
    })
    .prefault({}),
  adaptive: z
    .object({
      enabled: z.boolean().default(false),
      windowCombats: z.number().int().min(1).default(50),
      minSample: z.number().int().min(1).default(10),
      target: z.number().min(0).max(1).default(0.65),
      maxAdjust: z.number().min(0).max(0.5).default(0.15),
    })
    .prefault({}),
  events: z
    .object({
      pingRoleKey: z.string().nullable().default(null),
      announceMinutesBefore: z.number().int().min(0).default(60),
      strikeCooldownMinutes: z.number().int().min(1).default(10),
      hpPerParticipant: z.number().int().min(1).default(300),
      expectedParticipants: z.number().int().min(1).default(8),
      difficulty: z.enum(DIFFICULTIES).default('normal'),
      bossLevel: z.union([z.literal('auto'), z.number().int().min(1).max(100)]).default('auto'),
      rewards: z
        .object({
          victoryXp: z.number().int().min(0).default(50),
          bonusXpMax: z.number().int().min(0).default(50),
          participationXp: z.number().int().min(0).default(15),
        })
        .prefault({}),
    })
    .prefault({}),
  invasion: z
    .object({
      enabled: z.boolean().default(true),
      cron: cron.default('0 20 * * 6'),
      durationMinutes: z.number().int().min(5).max(1440).default(60),
      templateId: templateId.default('enxame-de-nanites'),
      /** `threat` sizes each invasion from the threat meter; a number fixes the waves (US-19). */
      waves: z.union([z.literal('threat'), z.number().int().min(1).max(5)]).default('threat'),
      /** Each wave has this much more HP than the one before (0.25 = +25%). */
      waveHpGrowth: z.number().min(0).max(2).default(0.25),
    })
    .prefault({}),
  raids: z
    .object({
      cron: cron.nullable().default(null),
      durationMinutes: z.number().int().min(5).max(1440).default(45),
      templateIds: z.array(templateId).min(1).default(['bastiao-prime']),
    })
    .prefault({}),
  ai: z
    .object({
      provider: z.enum(['none', 'openai-compatible']).default('none'),
      timeoutMs: z.number().int().min(500).max(30_000).default(4000),
      maxCallsPerHour: z.number().int().min(0).default(30),
    })
    .prefault({}),
  /** Threat meter (US-19): quiet days raise it, activity lowers it, one tick per day. */
  threat: z
    .object({
      enabled: z.boolean().default(true),
      idleRise: z.number().int().min(0).max(100).default(10),
      activeFall: z.number().int().min(0).max(100).default(5),
      /** Missions finished + strikes in a day needed to count as an active day. */
      activeActions: z.number().int().min(1).default(3),
    })
    .prefault({}),
  /** Faction war (US-18). `length` is `month` (starts on the 1st) or a number of days. */
  war: z
    .object({
      enabled: z.boolean().default(true),
      length: z.union([z.literal('month'), z.number().int().min(7).max(90)]).default('month'),
      points: z
        .object({
          missionSuccess: z.number().int().min(0).default(10),
          missionFailure: z.number().int().min(0).default(3),
          strike: z.number().int().min(0).default(2),
          participation: z.number().int().min(0).default(5),
        })
        .prefault({}),
    })
    .prefault({}),
});

export type UltronConfig = z.infer<typeof ultronConfigSchema>;
export const defaultUltronConfig = (): UltronConfig => ultronConfigSchema.parse({});
