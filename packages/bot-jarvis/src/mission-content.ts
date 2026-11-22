import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentIssue } from '@legion/core';
import { and, eq, notInArray } from 'drizzle-orm';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import type { JarvisRepo, MissionRow } from './db/repo.js';
import { type Campaign, campaignSchema, checkCampaignContent } from './domain/campaign.js';
import { hasCombat, type Mission, missionSchema } from './domain/mission.js';
import { JARVIS_CONTENT_DIR } from './paths.js';

/** The shipped missions, then the server's own (same id replaces). */
export const missionDirs = (dataDir = 'data/content') => [
  `${JARVIS_CONTENT_DIR}/missions`,
  `${dataDir}/missions`,
];

/** The shipped campaigns, then the server's own (same id replaces). */
export const campaignDirs = (dataDir = 'data/content') => [
  `${JARVIS_CONTENT_DIR}/campaigns`,
  `${dataDir}/campaigns`,
];

export interface MissionLoadResult {
  missions: Mission[];
  errors: string[];
  /** Loaded but locked (e.g. `requires` names a mission that does not exist): doctor ⚠️. */
  warnings?: string[];
  campaigns?: Campaign[];
}

/** Reads one mission per *.yaml file. A later folder overrides an earlier one by id. */
export function readMissions(dirs: string[]): MissionLoadResult {
  return readYamlDir(dirs, missionSchema, 'missão');
}

/** Reads one campaign per *.yaml file, like missions. */
export function readCampaigns(dirs: string[]): { campaigns: Campaign[]; errors: string[] } {
  const res = readYamlDir(dirs, campaignSchema, 'campanha');
  return { campaigns: res.missions, errors: res.errors };
}

/**
 * Missions and campaigns together, with the rules across files. A mission with an error (unknown
 * campaign, repeated chapter, cycle, bad `joinFaction`) is skipped; an unknown `requires` mission only
 * warns, and the mission stays locked.
 */
export function readContent(missionDirsIn: string[], campaignDirsIn: string[]): MissionLoadResult {
  const ms = readMissions(missionDirsIn);
  const cs = readCampaigns(campaignDirsIn);
  const problems = checkCampaignContent(cs.campaigns, ms.missions, { unknownRequires: 'warn' });
  const bad = new Set(problems.filter((p) => p.level === 'error').map((p) => p.missionId));
  const fmt = (p: (typeof problems)[number]) => `missão "${p.missionId}" → ${p.path}: ${p.message}`;
  return {
    missions: ms.missions.filter((m) => !bad.has(m.id)),
    campaigns: cs.campaigns,
    errors: [...ms.errors, ...cs.errors, ...problems.filter((p) => p.level === 'error').map(fmt)],
    warnings: problems.filter((p) => p.level === 'warn').map(fmt),
  };
}

function readYamlDir<T extends { id: string }>(
  dirs: string[],
  schema: {
    safeParse(
      raw: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: Parameters<typeof contentIssue>[0][] } };
  },
  what: string,
): { missions: T[]; errors: string[] } {
  const byId = new Map<string, T>();
  const errors: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const seen = new Map<string, string>();
    for (const file of readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()) {
      let raw: unknown;
      try {
        raw = parseYaml(readFileSync(join(dir, file), 'utf8'));
      } catch (err) {
        const pos = err instanceof YAMLParseError ? ` (linha ${err.linePos?.[0]?.line ?? 0})` : '';
        errors.push(`${file}${pos}: YAML inválido: ${(err as Error).message.split('\n')[0]}`);
        continue;
      }
      const res = schema.safeParse(raw);
      if (!res.success) {
        for (const issue of res.error.issues)
          errors.push(`${file} → ${issue.path.join('.') || what}: ${contentIssue(issue)}`);
        continue;
      }
      const dup = seen.get(res.data.id);
      if (dup) {
        errors.push(`${file} → id: "${res.data.id}" repetido (já existe em ${dup})`);
        continue;
      }
      seen.set(res.data.id, file);
      byId.set(res.data.id, res.data);
    }
  }
  return { missions: [...byId.values()], errors };
}

/** The `jarvis_missions` columns derived from a definition (files and imports). */
export const missionColumns = (m: Mission) => ({
  kind: m.kind,
  minLevel: m.minLevel,
  party: m.party,
  difficulty: m.difficulty,
  hasCombat: hasCombat(m) ? 1 : 0,
  definition: JSON.stringify(m),
  contentHash: missionHash(m),
  campaignId: m.campaign?.id ?? null,
  chapter: m.campaign?.chapter ?? null,
  requires: m.requires ? JSON.stringify(m.requires) : null,
});

export const campaignHash = (c: Campaign) =>
  createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0, 16);

export const campaignColumns = (c: Campaign) => ({
  kind: c.kind,
  faction: c.faction ?? null,
  definition: JSON.stringify(c),
  contentHash: campaignHash(c),
});

export const parseCampaign = (row: { definition: string }): Campaign =>
  JSON.parse(row.definition) as Campaign;

export const missionHash = (m: Mission) =>
  createHash('sha256').update(JSON.stringify(m)).digest('hex').slice(0, 16);

export const parseMission = (row: Pick<MissionRow, 'definition'>): Mission =>
  JSON.parse(row.definition) as Mission;

export interface MissionSyncResult {
  added: number;
  updated: number;
  deactivated: number;
  unchanged: number;
  errors: string[];
}

/** Upserts by id. Missions gone from the files become inactive, but only when every file was valid. */
export async function syncMissions(repo: JarvisRepo, loaded: MissionLoadResult): Promise<MissionSyncResult> {
  const t = repo.t.jarvisMissions;
  const all = await repo.allMissions();
  // Staff and pack rows win over files with the same id and are never deactivated by a reload.
  const reserved = new Set(all.filter((r) => r.origin !== 'file').map((r) => r.id));
  const existing = new Map(all.filter((r) => r.origin === 'file').map((r) => [r.id, r]));
  const res: MissionSyncResult = {
    added: 0,
    updated: 0,
    deactivated: 0,
    unchanged: 0,
    errors: loaded.errors,
  };
  const now = repo.now();
  await repo.db.transaction(async (tx) => {
    for (const m of loaded.missions) {
      if (reserved.has(m.id)) continue;
      const cols = missionColumns(m);
      const hash = cols.contentHash;
      const row = { ...cols, active: 1, updatedAt: now };
      const prev = existing.get(m.id);
      if (prev?.disabledBy) row.active = 0;
      if (!prev) {
        await tx.insert(t).values({ id: m.id, ...row });
        res.added++;
      } else if (prev.contentHash !== hash || prev.active !== row.active) {
        await tx.update(t).set(row).where(eq(t.id, m.id));
        res.updated++;
      } else res.unchanged++;
    }
    if (loaded.errors.length === 0) {
      const keep = loaded.missions.map((m) => m.id);
      const gone = [...existing.values()].filter((r) => r.active === 1 && !keep.includes(r.id));
      if (gone.length)
        await tx
          .update(t)
          .set({ active: 0, updatedAt: now })
          .where(and(eq(t.origin, 'file'), keep.length ? notInArray(t.id, keep) : undefined));
      res.deactivated = gone.length;
    }
  });
  return res;
}

/** Upserts campaigns by id, like missions. Staff imports win over files; gone files deactivate. */
export async function syncCampaigns(
  repo: JarvisRepo,
  campaigns: readonly Campaign[],
  allValid: boolean,
): Promise<void> {
  const t = repo.t.jarvisCampaigns;
  const all = await repo.allCampaigns();
  const reserved = new Set(all.filter((r) => r.origin !== 'file').map((r) => r.id));
  const existing = new Map(all.filter((r) => r.origin === 'file').map((r) => [r.id, r]));
  const now = repo.now();
  await repo.db.transaction(async (tx) => {
    for (const c of campaigns) {
      if (reserved.has(c.id)) continue;
      const prev = existing.get(c.id);
      const row = { ...campaignColumns(c), active: prev?.disabledBy ? 0 : 1, updatedAt: now };
      if (!prev) await tx.insert(t).values({ id: c.id, ...row });
      else if (prev.contentHash !== row.contentHash || prev.active !== row.active)
        await tx.update(t).set(row).where(eq(t.id, c.id));
    }
    if (allValid) {
      const keep = campaigns.map((c) => c.id);
      if ([...existing.values()].some((r) => r.active === 1 && !keep.includes(r.id)))
        await tx
          .update(t)
          .set({ active: 0, updatedAt: now })
          .where(and(eq(t.origin, 'file'), keep.length ? notInArray(t.id, keep) : undefined));
    }
  });
}
