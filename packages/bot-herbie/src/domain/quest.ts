import type { BotId } from '@legion/core';
import { z } from 'zod';

export const TRIGGER_EVENTS = [
  'command.executed',
  'trivia.answered',
  'mission.completed',
  'level.changed',
  'streak.updated',
] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

const stepId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, 'use letters, digits and - (max 41)');
const key = z.string().regex(/^[a-z0-9_.-]+$/, 'expected a locale key like herbie.quest.x.title');
const trigger = z.object({
  event: z.enum(TRIGGER_EVENTS),
  where: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
const baseStep = z.object({ id: stepId, titleKey: key, bodyKey: key, trigger });

export const chainSchema = z
  .object({
    chain: stepId,
    steps: z
      .array(
        baseStep.extend({
          requiresBot: z.enum(['cerebro', 'jarvis', 'herbie', 'sentinel', 'ultron']).optional(),
          requiresFeature: z.enum(['missions']).optional(),
          fallback: baseStep.optional(),
          rewardXp: z.number().int().min(0).max(1000),
        }),
      )
      .min(1)
      .max(20),
    completionRewardXp: z.number().int().min(0).max(1000).default(0),
  })
  .superRefine((c, ctx) => {
    const ids = c.steps.flatMap((s) => [s.id, ...(s.fallback ? [s.fallback.id] : [])]);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) ctx.addIssue({ code: 'custom', path: ['steps'], message: `step id "${dup}" is repeated` });
  });

export type Chain = z.infer<typeof chainSchema>;
export type Trigger = z.infer<typeof trigger>;

/** A step as it applies on this server (after requiresBot/requiresFeature and fallbacks). */
export interface EffectiveStep {
  id: string;
  titleKey: string;
  bodyKey: string;
  trigger: Trigger;
  rewardXp: number;
}

export interface QuestEnv {
  enabledBots: readonly BotId[];
  features: ReadonlySet<string>;
}

/** Steps in order; a step whose bot or feature is missing uses its fallback, or is skipped. */
export function effectiveSteps(chain: Chain, env: QuestEnv): EffectiveStep[] {
  const out: EffectiveStep[] = [];
  for (const s of chain.steps) {
    const ok =
      (!s.requiresBot || env.enabledBots.includes(s.requiresBot)) &&
      (!s.requiresFeature || env.features.has(s.requiresFeature));
    const use = ok ? s : s.fallback;
    if (use)
      out.push({
        id: use.id,
        titleKey: use.titleKey,
        bodyKey: use.bodyKey,
        trigger: use.trigger,
        rewardXp: s.rewardXp,
      });
  }
  return out;
}

/** True when the event payload is about this member. */
export function isAboutMember(
  payload: Record<string, unknown>,
  memberId: string,
  discordUserId: string,
): boolean {
  if (payload.memberId === memberId) return true;
  if (Array.isArray(payload.memberIds) && payload.memberIds.includes(memberId)) return true;
  return payload.discordUserId === discordUserId;
}

/** Member ids an event is about (memberId / memberIds); discordUserId-only events are resolved by the caller. */
export function memberIdsOf(payload: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  if (typeof payload.memberId === 'string') ids.add(payload.memberId);
  if (Array.isArray(payload.memberIds))
    for (const m of payload.memberIds) if (typeof m === 'string') ids.add(m);
  return [...ids];
}

export function triggerMatches(t: Trigger, type: string, payload: Record<string, unknown>): boolean {
  if (t.event !== type) return false;
  return Object.entries(t.where ?? {}).every(([k, v]) => payload[k] === v);
}

/** The first step not done yet (steps removed from the file are ignored); null when all are done. */
export function currentStep(
  steps: readonly EffectiveStep[],
  done: ReadonlySet<string>,
): EffectiveStep | null {
  return steps.find((s) => !done.has(s.id)) ?? null;
}

export interface Advance {
  step: EffectiveStep;
  index: number;
  next: EffectiveStep | null;
  chainCompleted: boolean;
}

/** Only the current step's trigger counts (doing a later step early does nothing). */
export function advance(
  steps: readonly EffectiveStep[],
  done: ReadonlySet<string>,
  type: string,
  payload: Record<string, unknown>,
): Advance | null {
  const step = currentStep(steps, done);
  if (!step || !triggerMatches(step.trigger, type, payload)) return null;
  const after = new Set([...done, step.id]);
  const next = currentStep(steps, after);
  return { step, index: steps.indexOf(step), next, chainCompleted: next === null };
}
