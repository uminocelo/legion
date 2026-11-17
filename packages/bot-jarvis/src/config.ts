import { z } from 'zod';

const posInt = z.number().int().positive();

export const DIFFICULTIES = ['facil', 'normal', 'dificil'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const jarvisConfigSchema = z.object({
  trivia: z
    .object({
      categories: z
        .array(z.string().regex(/^[a-z][a-z0-9_-]*$/))
        .min(1)
        .default(['quadrinhos', 'rivals', 'geral']),
      timeLimitSeconds: posInt.default(20),
      cooldownSeconds: posInt.default(30),
      noRepeatDays: posInt.default(30),
      dailyXpCap: posInt.default(300),
      baseXp: z
        .object({ facil: posInt.default(10), normal: posInt.default(15), dificil: posInt.default(25) })
        .prefault({}),
      speedBonusMax: posInt.default(5),
    })
    .prefault({}),
  levels: z.object({ levelFactor: posInt.default(50), maxLevel: posInt.default(50) }).prefault({}),
  ranks: z
    .object({
      recruta: z.number().int().min(0).default(0),
      agente: posInt.default(500),
      veterano: posInt.default(2000),
    })
    .prefault({})
    .superRefine((r, ctx) => {
      if (r.recruta !== 0) ctx.addIssue({ code: 'custom', path: ['recruta'], message: 'recruta must be 0' });
      if (!(r.recruta < r.agente && r.agente < r.veterano))
        ctx.addIssue({
          code: 'custom',
          path: ['agente'],
          message: 'thresholds must be strictly increasing (recruta < agente < veterano)',
        });
    }),
  streak: z.object({ bonusPerDay: posInt.default(5), bonusCap: posInt.default(7) }).prefault({}),
  leaderboard: z
    .object({ size: posInt.max(25).default(10), channelCooldownSeconds: posInt.default(15) })
    .prefault({}),
});

export type JarvisConfig = z.infer<typeof jarvisConfigSchema>;
export const defaultJarvisConfig = (): JarvisConfig => jarvisConfigSchema.parse({});
