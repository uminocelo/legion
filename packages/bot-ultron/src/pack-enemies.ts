// Pack enemy hooks for J.A.R.V.I.S. PackInstaller (US-23). Jarvis never imports this module in src;
// the runner / CLI / tests pass the factory result into PackInstaller.setEnemyHooks.
import type { Executor } from '@legion/core';
import { and, eq, inArray } from 'drizzle-orm';
import { stringify as toYaml } from 'yaml';
import { contentHash, type EnemyTemplate, parseEnemiesYaml } from './content.js';
import type { UltronRepo } from './db/repo.js';
import { enemySchema } from './domain/enemy.js';

export const PACK_ENEMY_ORIGIN = 'pack' as const;

export type PackEnemyOrigin = 'file' | 'staff' | 'pack';

export type PackEnemyApplyFn = (args: {
  tx: Executor;
  upserts: Array<{ id: string; enemy: Record<string, unknown> }>;
  deactivateIds: string[];
  importedBy: string | null;
  now: string;
}) => Promise<void>;

export type PackEnemyOriginLookup = (id: string) => Promise<PackEnemyOrigin | null>;

export type PackEnemyParseFn = (
  list: unknown[],
  label: string,
) => { enemies: Array<{ id: string } & Record<string, unknown>>; errors: string[] };

export interface PackEnemyHooks {
  parseEnemies: PackEnemyParseFn;
  applyEnemies: PackEnemyApplyFn;
  lookupEnemyOrigin: PackEnemyOriginLookup;
}

/** Adapts `parseEnemiesYaml` to the list callback PackInstaller expects. */
export function enemiesParserForPacks(
  parse: typeof parseEnemiesYaml = parseEnemiesYaml,
): PackEnemyParseFn {
  return (list, label) => parse(toYaml(list), label);
}

function asEnemy(raw: Record<string, unknown>): EnemyTemplate {
  const res = enemySchema.safeParse(raw);
  if (!res.success)
    throw new Error(`inimigo inválido no pacote: ${res.error.issues[0]?.message ?? 'erro'}`);
  return res.data;
}

/** Real ULTRON apply: upsert/deactivate with origin `pack` inside the pack transaction. */
export function createPackEnemyApply(repo: UltronRepo): PackEnemyApplyFn {
  const t = repo.t.ultronEnemyTemplates;
  return async ({ tx, upserts, deactivateIds, importedBy, now }) => {
    for (const { id, enemy: raw } of upserts) {
      const e = asEnemy({ ...raw, id });
      const prev = await tx
        .select()
        .from(t)
        .where(eq(t.id, id))
        .limit(1)
        .then((r) => r[0] ?? null);
      const active = prev?.disabledBy ? 0 : 1;
      const row = {
        name: e.name,
        tier: e.tier,
        minLevel: e.minLevel,
        base: JSON.stringify(e.base),
        powerCooldownMax: e.powerCooldownMax,
        tauntKeys: JSON.stringify(e.tauntKeys),
        contentHash: contentHash(e),
        active,
        updatedAt: now,
        origin: PACK_ENEMY_ORIGIN,
        importedBy,
        disabledBy: prev?.disabledBy ?? null,
      };
      if (prev) await tx.update(t).set(row).where(eq(t.id, id));
      else await tx.insert(t).values({ id, ...row });
    }
    if (deactivateIds.length)
      await tx
        .update(t)
        .set({ active: 0, updatedAt: now })
        .where(and(eq(t.origin, PACK_ENEMY_ORIGIN), inArray(t.id, deactivateIds)));
  };
}

export function createPackEnemyOriginLookup(repo: UltronRepo): PackEnemyOriginLookup {
  return async (id) => {
    const t = repo.t.ultronEnemyTemplates;
    const [row] = await repo.db.orm.select({ origin: t.origin }).from(t).where(eq(t.id, id)).limit(1);
    if (!row) return null;
    if (row.origin === 'file' || row.origin === 'staff' || row.origin === 'pack') return row.origin;
    return null;
  };
}

/** Factory the runner / CLI / tests pass into PackInstaller.setEnemyHooks. */
export function createPackEnemyHooks(repo: UltronRepo): PackEnemyHooks {
  return {
    parseEnemies: enemiesParserForPacks(),
    applyEnemies: createPackEnemyApply(repo),
    lookupEnemyOrigin: createPackEnemyOriginLookup(repo),
  };
}
