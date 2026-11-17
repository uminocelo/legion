import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, notInArray } from 'drizzle-orm';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import type { JarvisRepo, MissionRow } from './db/repo.js';
import { hasCombat, type Mission, missionSchema } from './domain/mission.js';
import { JARVIS_CONTENT_DIR } from './paths.js';

/** The shipped missions, then the server's own (same id replaces). */
export const missionDirs = (dataDir = 'data/content') => [
  `${JARVIS_CONTENT_DIR}/missions`,
  `${dataDir}/missions`,
];

export interface MissionLoadResult {
  missions: Mission[];
  errors: string[];
}

/** Reads one mission per *.yaml file. A later folder overrides an earlier one by id. */
export function readMissions(dirs: string[]): MissionLoadResult {
  const byId = new Map<string, Mission>();
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
      const res = missionSchema.safeParse(raw);
      if (!res.success) {
        for (const issue of res.error.issues)
          errors.push(`${file} → ${issue.path.join('.') || 'missão'}: ${issue.message}`);
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
  // Imported missions win over files with the same id and are never deactivated by a reload.
  const staff = new Set(all.filter((r) => r.origin === 'staff').map((r) => r.id));
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
      if (staff.has(m.id)) continue;
      const hash = missionHash(m);
      const row = {
        kind: m.kind,
        minLevel: m.minLevel,
        party: m.party,
        difficulty: m.difficulty,
        hasCombat: hasCombat(m) ? 1 : 0,
        definition: JSON.stringify(m),
        contentHash: hash,
        active: 1,
        updatedAt: now,
      };
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
