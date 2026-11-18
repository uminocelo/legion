import { contentIssues } from '@legion/core';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';
import { contentId, type Mission, missionSchema, type Requires, text } from './mission.js';

/**
 * Campaigns (v0.9, ADR 0032): metadata that groups missions into ordered chapters. Missions point to
 * a campaign with `campaign: { id, chapter }`; progress is derived from runs that ended in `success`
 * (no progress table). Pure module (zod + yaml): the website editor bundles it.
 */
export const CAMPAIGN_KINDS = ['tutorial', 'recruitment', 'story'] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

export const campaignSchema = z
  .object({
    id: contentId,
    kind: z.enum(CAMPAIGN_KINDS),
    /** The team a recruitment campaign recruits for (required for `recruitment`, refused otherwise). */
    faction: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, 'use a chave da equipe, como "avengers"')
      .optional(),
    title: text(80),
    summary: text(300),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.kind === 'recruitment' && !c.faction)
      ctx.addIssue({
        code: 'custom',
        path: ['faction'],
        message: 'campanha de recrutamento precisa de faction',
      });
    if (c.kind !== 'recruitment' && c.faction)
      ctx.addIssue({
        code: 'custom',
        path: ['faction'],
        message: 'faction só vale em campanha de recrutamento',
      });
  });
export type Campaign = z.infer<typeof campaignSchema>;

/** A problem found across files. `error` refuses an import; for files it skips the mission. */
export interface ContentProblem {
  missionId: string;
  path: string;
  message: string;
  /** `warn`: loaded but locked (a `requires` mission that does not exist yet). */
  level: 'error' | 'warn';
}

export interface CheckOptions {
  /** Enabled team keys; when given, `reward.joinFaction` must be one of them. */
  factions?: readonly string[];
  /** Mission ids that exist outside this set (already in the database). */
  knownMissionIds?: ReadonlySet<string>;
  /** Campaigns that exist outside this set. */
  knownCampaigns?: ReadonlyMap<string, Campaign>;
  /** `requires` naming an unknown mission: `error` for imports, `warn` for files. */
  unknownRequires?: 'error' | 'warn';
}

/**
 * Rules across campaigns and missions: unknown campaign, repeated chapter, unknown mission in
 * `requires`, cycles, and `reward.joinFaction` outside a recruitment campaign for that team.
 */
export function checkCampaignContent(
  campaigns: readonly Campaign[],
  missions: readonly Mission[],
  o: CheckOptions = {},
): ContentProblem[] {
  const out: ContentProblem[] = [];
  const err = (m: Mission, path: string, message: string, level: 'error' | 'warn' = 'error') =>
    out.push({ missionId: m.id, path, message, level });
  const byCampaign = new Map<string, Campaign>(o.knownCampaigns ?? []);
  for (const c of campaigns) byCampaign.set(c.id, c);
  const ids = new Set([...(o.knownMissionIds ?? []), ...missions.map((m) => m.id)]);

  const chapters = new Map<string, string>();
  for (const m of missions) {
    const c = m.campaign ? byCampaign.get(m.campaign.id) : undefined;
    if (m.campaign && !c) err(m, 'campaign.id', `campanha "${m.campaign.id}" não existe`);
    if (m.campaign) {
      const key = `${m.campaign.id}#${m.campaign.chapter}`;
      const other = chapters.get(key);
      if (other)
        err(m, 'campaign.chapter', `capítulo ${m.campaign.chapter} repetido (já é a missão "${other}")`);
      else chapters.set(key, m.id);
    }
    for (const [i, req] of (m.requires?.missions ?? []).entries()) {
      if (req === m.id) err(m, `requires.missions.${i}`, 'a missão não pode exigir ela mesma');
      else if (!ids.has(req))
        err(m, `requires.missions.${i}`, `missão "${req}" não existe`, o.unknownRequires ?? 'error');
    }
    const join = m.reward?.joinFaction;
    if (join) {
      if (c?.kind !== 'recruitment')
        err(m, 'reward.joinFaction', 'joinFaction só vale numa missão de campanha de recrutamento');
      else if (c.faction !== join)
        err(m, 'reward.joinFaction', `a campanha recruta para "${c.faction}", não "${join}"`);
      if (o.factions && !o.factions.includes(join))
        err(m, 'reward.joinFaction', `a equipe "${join}" não existe ou está desligada`);
    }
  }
  for (const id of requiresCycle(missions))
    out.push({ missionId: id, path: 'requires.missions', message: 'ciclo em requires', level: 'error' });
  return out;
}

/** Missions that are part of a `requires` cycle (each one, once). */
function requiresCycle(missions: readonly Mission[]): string[] {
  const deps = new Map(missions.map((m) => [m.id, m.requires?.missions ?? []]));
  const state = new Map<string, 'visiting' | 'done'>();
  const inCycle = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      for (const x of stack.slice(stack.indexOf(id))) inCycle.add(x);
      return;
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const d of deps.get(id) ?? []) if (deps.has(d)) visit(d);
    stack.pop();
    state.set(id, 'done');
  };
  for (const id of deps.keys()) visit(id);
  return [...inCycle].sort();
}

// ---------- requirements in play ----------

/** What the engine knows about a member when checking requirements. */
export interface HeroFacts {
  level: number;
  originType: string | null;
  /** Current team as stored (a disabled team counts as Independente; see `shownFaction`). */
  faction: string | null;
  /** Missions this member finished with `success`. */
  done: ReadonlySet<string>;
}

export type Unmet =
  | { key: 'missions'; missions: string[] }
  | { key: 'level'; level: number }
  | { key: 'origin'; origins: string[] }
  | { key: 'faction'; factions: string[] };

export interface UnmetResult {
  missing: Unmet[];
  /** Not offered at all: a recruitment arc for the member's own team, or for a disabled team. */
  hidden: boolean;
}

/**
 * Missing requirements of `m` for one member (empty = unlocked). `campaign` is the mission's campaign;
 * `factions` the enabled team keys.
 */
export function unmet(
  m: Pick<Mission, 'requires'>,
  hero: HeroFacts,
  campaign: Pick<Campaign, 'kind' | 'faction'> | null,
  factions: readonly string[],
): UnmetResult {
  const team = hero.faction && factions.includes(hero.faction) ? hero.faction : 'independent';
  const hidden =
    campaign?.kind === 'recruitment' &&
    (campaign.faction === team || !factions.includes(campaign.faction ?? ''));
  const req: Requires = m.requires ?? {};
  const missing: Unmet[] = [];
  const notDone = (req.missions ?? []).filter((id) => !hero.done.has(id));
  if (notDone.length) missing.push({ key: 'missions', missions: notDone });
  if (req.level && hero.level < req.level) missing.push({ key: 'level', level: req.level });
  if (req.origins && !req.origins.includes((hero.originType ?? '') as never))
    missing.push({ key: 'origin', origins: req.origins });
  if (req.factions && !req.factions.includes(team)) missing.push({ key: 'faction', factions: req.factions });
  return { missing, hidden };
}

// ---------- import file ----------

/** `/jarvis campanha importar` and the editor's "campaign file": one campaign and its missions. */
export const campaignFileSchema = z
  .object({ campaign: campaignSchema, missions: z.array(missionSchema).min(1).max(20) })
  .strict();
export type CampaignFile = z.infer<typeof campaignFileSchema>;

/**
 * Parses and checks a campaign file on its own: every mission must be a chapter of this campaign,
 * and `requires` may name these missions or `knownMissionIds`.
 */
export function parseCampaignYaml(
  textIn: string,
  o: CheckOptions = {},
): { file: CampaignFile; warnings: string[] } | { errors: string[] } {
  let raw: unknown;
  try {
    raw = parseYaml(textIn);
  } catch (err) {
    const line = err instanceof YAMLParseError ? ` (linha ${err.linePos?.[0]?.line ?? 0})` : '';
    return { errors: [`YAML inválido${line}: ${(err as Error).message.split('\n')[0]}`] };
  }
  const res = campaignFileSchema.safeParse(raw);
  if (!res.success) return { errors: contentIssues(res.error.issues, 'campanha') };
  const file = res.data;
  const errors: string[] = [];
  const seen = new Set<string>();
  file.missions.forEach((m, i) => {
    if (seen.has(m.id)) errors.push(`missions.${i}.id: "${m.id}" repetido`);
    seen.add(m.id);
    if (m.campaign?.id !== file.campaign.id)
      errors.push(`missions.${i}.campaign: use { id: ${file.campaign.id}, chapter: N }`);
  });
  const problems = checkCampaignContent([file.campaign], file.missions, { unknownRequires: 'error', ...o });
  for (const p of problems) {
    const i = file.missions.findIndex((m) => m.id === p.missionId);
    errors.push(`missions.${i}.${p.path}: ${p.message}`);
  }
  if (errors.length) return { errors: [...new Set(errors)] };
  return { file, warnings: [] };
}

/** Missions of a campaign in chapter order. */
export const chaptersOf = <M extends Pick<Mission, 'campaign'>>(campaignId: string, missions: readonly M[]) =>
  missions
    .filter((m) => m.campaign?.id === campaignId)
    .sort((a, b) => (a.campaign?.chapter ?? 0) - (b.campaign?.chapter ?? 0));
