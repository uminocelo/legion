import type { Locale } from '@legion/core';
import { contentIssues, ORIGINS } from '@legion/core';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';
import { DIFFICULTIES, type JarvisConfig, MISSION_KINDS } from '../config.js';

/**
 * A text in one language, or per language (`pt-BR` required, `en` optional). Mission text is narrative:
 * canon heroes, teams and places may appear (ADR 0030), so it does not go through the canon filter.
 * Identities (codenames, powers, enemies, items, AI flavour text) still do.
 */
export const text = (max: number) => {
  const one = z.string().min(1).max(max);
  return z.union([one, z.object({ 'pt-BR': one, en: one.optional() }).strict()]);
};
export type LocalText = z.infer<ReturnType<typeof text>>;

export const loc = (t: LocalText, l: Locale): string =>
  typeof t === 'string' ? t : ((l === 'en' ? t.en : undefined) ?? t['pt-BR']);

const sceneId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'use letras minúsculas, números e "-" (1-32)');

const choiceSchema = z.object({ label: text(80), next: sceneId }).strict();

const sceneSchema = z
  .object({
    text: text(1500),
    choices: z.array(choiceSchema).min(2).max(4).optional(),
    combat: z.object({ win: sceneId, lose: sceneId }).strict().optional(),
    end: z.enum(['success', 'failure']).optional(),
  })
  .strict()
  .refine((s) => [s.choices, s.combat, s.end].filter((x) => x !== undefined).length === 1, {
    message: 'cada cena tem exatamente um de: choices, combat ou end',
  });
export type Scene = z.infer<typeof sceneSchema>;

export const contentId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'use letras minúsculas, números e "-" (2-41)');
const teamKey = z.string().regex(/^[a-z][a-z0-9_]*$/, 'use a chave da equipe, como "avengers"');

/** What a member needs before a mission unlocks (v0.9). Every listed requirement must be met. */
export const requiresSchema = z
  .object({
    /** Missions the member finished with success (chapters before this one). */
    missions: z.array(contentId).min(1).max(10).optional(),
    level: z.number().int().min(1).max(100).optional(),
    origins: z.array(z.enum(ORIGINS)).min(1).optional(),
    /** The member's current team must be one of these. */
    factions: z.array(teamKey).min(1).optional(),
  })
  .strict();
export type Requires = z.infer<typeof requiresSchema>;

export const missionSchema = z
  .object({
    id: contentId,
    kind: z.enum(MISSION_KINDS),
    title: text(80),
    summary: text(300),
    minLevel: z.number().int().min(1).max(100).default(1),
    party: z.number().int().min(1).max(4).default(1),
    difficulty: z.enum(DIFFICULTIES).default('normal'),
    xp: z
      .object({
        success: z.number().int().min(0).max(10_000),
        failure: z.number().int().min(0).max(10_000),
      })
      .strict()
      .optional(),
    /** The campaign this mission is a chapter of (`content/campaigns/<id>.yaml`). */
    campaign: z
      .object({ id: contentId, chapter: z.number().int().min(1).max(50) })
      .strict()
      .optional(),
    requires: requiresSchema.optional(),
    /** On a `success` ending of a recruitment campaign: ask Cérebro to put the hero on this team (US-28). */
    reward: z.object({ joinFaction: teamKey }).strict().optional(),
    start: sceneId,
    scenes: z.record(sceneId, sceneSchema),
  })
  .strict()
  .superRefine((m, ctx) => {
    for (const e of graphErrors(m)) ctx.addIssue({ code: 'custom', path: e.path, message: e.message });
  });
export type Mission = z.infer<typeof missionSchema>;

export type SceneKind = 'choice' | 'combat' | 'end';
export const sceneKind = (s: Scene): SceneKind => (s.end ? 'end' : s.combat ? 'combat' : 'choice');

/** Scenes a scene leads to. */
export const nextScenes = (s: Scene): string[] =>
  s.choices ? s.choices.map((c) => c.next) : s.combat ? [s.combat.win, s.combat.lose] : [];

/** Links, reachability and cycles. Every walk from `start` must reach an end. */
export function graphErrors(m: Pick<Mission, 'start' | 'scenes'>): { path: string[]; message: string }[] {
  const errors: { path: string[]; message: string }[] = [];
  const scenes = m.scenes;
  if (!scenes[m.start]) errors.push({ path: ['start'], message: `cena "${m.start}" não existe` });
  for (const [id, s] of Object.entries(scenes))
    for (const n of nextScenes(s))
      if (!scenes[n]) errors.push({ path: ['scenes', id], message: `leva a "${n}", que não existe` });
  if (errors.length) return errors;
  // DFS: a back edge is a cycle; a finished walk proves every path ends (all non-end scenes have exits).
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string, trail: string[]): boolean => {
    if (state.get(id) === 'done') return true;
    if (state.get(id) === 'open') {
      errors.push({ path: ['scenes', id], message: `ciclo: ${[...trail, id].join(' → ')}` });
      return false;
    }
    state.set(id, 'open');
    const s = scenes[id];
    const ok = s ? nextScenes(s).every((n) => visit(n, [...trail, id])) : true;
    state.set(id, 'done');
    return ok;
  };
  if (!visit(m.start, [])) return errors;
  for (const id of Object.keys(scenes))
    if (!state.has(id)) errors.push({ path: ['scenes', id], message: 'cena inalcançável a partir de start' });
  if (!Object.values(scenes).some((s) => s.end))
    errors.push({ path: ['scenes'], message: 'nenhuma cena com end' });
  return errors;
}

export const hasCombat = (m: Mission) => Object.values(m.scenes).some((s) => s.combat);

export type StepInput = { choice: number } | { combat: 'win' | 'lose' };
export type StepResult =
  | { type: 'choice'; scene: string }
  | { type: 'combat'; scene: string }
  | { type: 'end'; scene: string; outcome: 'success' | 'failure' };

/** Where a run is when it stands on `sceneId`. */
export function at(m: Mission, sceneId: string): StepResult {
  const s = m.scenes[sceneId];
  if (!s) throw new Error(`mission ${m.id}: unknown scene ${sceneId}`);
  if (s.end) return { type: 'end', scene: sceneId, outcome: s.end };
  return { type: s.combat ? 'combat' : 'choice', scene: sceneId };
}

/** Pure transition: the same mission, scene and input always give the same next scene. */
export function step(m: Mission, sceneId: string, input: StepInput): StepResult | null {
  const s = m.scenes[sceneId];
  if (!s) return null;
  if ('choice' in input) {
    const c = s.choices?.[input.choice];
    return c ? at(m, c.next) : null;
  }
  return s.combat ? at(m, input.combat === 'win' ? s.combat.win : s.combat.lose) : null;
}

/** Majority wins; a tie goes to the leader's vote, or the lowest tied index when the leader did not vote. */
export function resolveVote(votes: ReadonlyMap<string, number>, leaderId: string): number | null {
  if (!votes.size) return null;
  const count = new Map<number, number>();
  for (const v of votes.values()) count.set(v, (count.get(v) ?? 0) + 1);
  const top = Math.max(...count.values());
  const tied = [...count.entries()].filter(([, n]) => n === top).map(([c]) => c);
  if (tied.length === 1) return tied[0] ?? null;
  const leader = votes.get(leaderId);
  return leader !== undefined && tied.includes(leader) ? leader : Math.min(...tied);
}

/** XP for an outcome: the mission's own amounts, else the config default for its kind. */
export function missionXp(
  m: Pick<Mission, 'kind' | 'xp'>,
  outcome: 'success' | 'failure' | 'abandoned',
  cfg: JarvisConfig['missions'],
): number {
  if (outcome === 'abandoned') return 0;
  if (m.xp) return outcome === 'success' ? m.xp.success : m.xp.failure;
  const r = cfg.rewards[m.kind];
  return outcome === 'success' ? r.successXp : r.failureXp;
}

/** Parses one mission YAML; errors carry the YAML line or the field path. */
export function parseMissionYaml(text: string): { mission: Mission } | { errors: string[] } {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    const line = err instanceof YAMLParseError ? ` (linha ${err.linePos?.[0]?.line ?? 0})` : '';
    return { errors: [`YAML inválido${line}: ${(err as Error).message.split('\n')[0]}`] };
  }
  const res = missionSchema.safeParse(raw);
  if (!res.success) return { errors: contentIssues(res.error.issues, 'missão') };
  return { mission: res.data };
}
