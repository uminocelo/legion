// Content packs (US-23): folder load under data/content/packs/ and all-or-nothing install/upgrade/remove.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareSemver, type Executor, type Item, isCanonName, type Locale } from '@legion/core';
import { and, eq, inArray } from 'drizzle-orm';
import { contentHash as triviaHash } from './content.js';
import type { JarvisRepo } from './db/repo.js';
import type { Mission } from './domain/mission.js';
import {
  enemiesListYaml,
  type ParseEnemiesFn,
  type ValidatedPack,
  validatePack,
  validatePackYaml,
} from './domain/pack.js';
import type { TriviaQuestion } from './domain/trivia.js';
import { itemColumns, unequipItems } from './items.js';
import { missionColumns } from './mission-content.js';

export const PACK_ORIGIN = 'pack' as const;
export type PackSource = 'bot' | 'folder';
export type PackContentType = 'trivia' | 'mission' | 'enemy' | 'item';

export interface PackLoadResult {
  packs: ValidatedPack[];
  /** Per-pack or per-file errors; broken packs are skipped. */
  errors: string[];
}

export interface ReadPacksOptions {
  isCanon?: (text: string) => boolean;
  categories?: readonly string[];
  locale?: Locale;
  parseEnemies?: ParseEnemiesFn;
}

/**
 * Reads `packsRoot/<id>/pack.yaml`. A broken pack is skipped (others still load); errors are listed
 * like `readItems`.
 */
export function readPacks(packsRoot: string, o: ReadPacksOptions = {}): PackLoadResult {
  const packs: ValidatedPack[] = [];
  const errors: string[] = [];
  if (!existsSync(packsRoot)) return { packs, errors };
  const dirs = readdirSync(packsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
  const seen = new Set<string>();
  for (const dir of dirs) {
    const file = join(packsRoot, dir, 'pack.yaml');
    const label = `${dir}/pack.yaml`;
    if (!existsSync(file)) {
      errors.push(`${label}: pack.yaml não encontrado`);
      continue;
    }
    const res = validatePackYaml(readFileSync(file, 'utf8'), {
      isCanon: o.isCanon ?? isCanonName,
      categories: o.categories,
      locale: o.locale,
      parseEnemies: o.parseEnemies,
      label,
    });
    if (res.errors.length) {
      errors.push(...res.errors);
      continue;
    }
    if (seen.has(res.pack.id)) {
      errors.push(`${label}: id "${res.pack.id}" repetido em outro pacote`);
      continue;
    }
    seen.add(res.pack.id);
    packs.push(res.pack);
  }
  return { packs, errors };
}

export const packDirs = (dataDir = 'data/content') => [`${dataDir}/packs`];

export type EnemyApplyFn = (args: {
  tx: Executor;
  upserts: Array<{ id: string; enemy: Record<string, unknown> }>;
  deactivateIds: string[];
  importedBy: string | null;
  now: string;
}) => Promise<void>;

export interface PackInstallDeps {
  repo: JarvisRepo;
  categories?: readonly string[];
  locale?: Locale;
  isCanon?: (text: string) => boolean;
  parseEnemies?: ParseEnemiesFn;
  /** Writes/deactivates enemies inside the same transaction (injected from ULTRON). */
  applyEnemies?: EnemyApplyFn;
}

export interface PackApplyResult {
  ok: true;
  packId: string;
  version: string;
  action: 'install' | 'upgrade';
  added: number;
  changed: number;
  same: number;
  deactivated: number;
  unequipped: number;
}

export interface PackApplyFailure {
  ok: false;
  errors: string[];
}

export type PackApplyOutcome = PackApplyResult | PackApplyFailure;

type Change = 'new' | 'changed' | 'same';

/**
 * Installs or upgrades a validated pack all-or-nothing. Newer semver only; older/same refused.
 * Content removed from the pack is deactivated (items unequipped, inventory kept).
 */
export class PackInstaller {
  constructor(private readonly deps: PackInstallDeps) {}

  private get t() {
    return this.deps.repo.t;
  }

  async apply(
    raw: unknown,
    opts: { source: PackSource; importedBy?: string | null; label?: string } = { source: 'bot' },
  ): Promise<PackApplyOutcome> {
    const validated = validatePack(raw, {
      isCanon: this.deps.isCanon ?? isCanonName,
      categories: this.deps.categories,
      locale: this.deps.locale,
      parseEnemies: this.deps.parseEnemies,
      label: opts.label ?? 'pack.yaml',
    });
    if (validated.errors.length) return { ok: false, errors: validated.errors };
    return this.applyValidated(validated.pack, opts);
  }

  async applyValidated(
    pack: ValidatedPack,
    opts: { source: PackSource; importedBy?: string | null },
  ): Promise<PackApplyOutcome> {
    if (pack.enemies.length && !this.deps.parseEnemies)
      return {
        ok: false,
        errors: ['enemies: validação de inimigos indisponível (ULTRON não carregado)'],
      };

    const existing = await this.packRow(pack.id);
    if (existing) {
      const cmp = compareSemver(pack.version, existing.version);
      if (cmp < 0)
        return {
          ok: false,
          errors: [
            `pacote "${pack.id}": versão ${pack.version} é mais antiga que a instalada (${existing.version})`,
          ],
        };
      if (cmp === 0)
        return {
          ok: false,
          errors: [`pacote "${pack.id}": versão ${pack.version} já está instalada`],
        };
    }

    const plan = await this.plan(pack);
    if (plan.errors.length) return { ok: false, errors: plan.errors };

    const now = this.deps.repo.now();
    const importedBy = opts.importedBy ?? null;
    let unequipped = 0;

    try {
      await this.deps.repo.db.transaction(async (tx) => {
        const turnedOffItems: string[] = [];

        for (const { q, change } of plan.trivia) {
          if (change === 'same') continue;
          await this.upsertTrivia(tx, q, now, importedBy);
        }
        for (const { m, change } of plan.missions) {
          if (change === 'same') continue;
          await this.upsertMission(tx, m, now, importedBy);
        }
        for (const { item, change, prevActive } of plan.items) {
          if (change === 'same') continue;
          const active = item.active === false ? 0 : 1;
          await this.upsertItem(tx, item, now, importedBy, active);
          if (!active && prevActive !== 0) turnedOffItems.push(item.id);
        }

        const enemyUpserts = plan.enemies
          .filter((e) => e.change !== 'same')
          .map((e) => ({ id: e.enemy.id, enemy: e.enemy }));
        if ((enemyUpserts.length || plan.deactivate.enemies.length) && this.deps.applyEnemies) {
          await this.deps.applyEnemies({
            tx,
            upserts: enemyUpserts,
            deactivateIds: plan.deactivate.enemies,
            importedBy,
            now,
          });
        } else if (enemyUpserts.length || plan.deactivate.enemies.length) {
          throw new Error('aplicação de inimigos indisponível (ULTRON não carregado)');
        }

        await this.deactivateTrivia(tx, plan.deactivate.trivia, now);
        await this.deactivateMissions(tx, plan.deactivate.missions, now);
        if (plan.deactivate.items.length) {
          await this.deactivateItems(tx, plan.deactivate.items, now);
          turnedOffItems.push(...plan.deactivate.items);
        }
        unequipped = await unequipItems(this.deps.repo, tx, turnedOffItems);

        await this.writeOwnership(tx, pack, opts.source, now);
      });
    } catch (err) {
      return { ok: false, errors: [(err as Error).message] };
    }

    const n = (c: Change) =>
      [...plan.trivia, ...plan.missions, ...plan.items, ...plan.enemies].filter((x) => x.change === c).length;
    return {
      ok: true,
      packId: pack.id,
      version: pack.version,
      action: existing ? 'upgrade' : 'install',
      added: n('new'),
      changed: n('changed'),
      same: n('same'),
      deactivated:
        plan.deactivate.trivia.length +
        plan.deactivate.missions.length +
        plan.deactivate.items.length +
        plan.deactivate.enemies.length,
      unequipped,
    };
  }

  /** Deactivates pack-owned content and clears install records. */
  async remove(packId: string): Promise<{ ok: true } | PackApplyFailure> {
    const existing = await this.packRow(packId);
    if (!existing) return { ok: false, errors: [`pacote desconhecido: "${packId}"`] };

    const owned = await this.deps.repo.db.orm
      .select()
      .from(this.t.jarvisContentPackItems)
      .where(eq(this.t.jarvisContentPackItems.packId, packId));

    const now = this.deps.repo.now();
    const byType = (t: PackContentType) => owned.filter((r) => r.contentType === t).map((r) => r.contentId);

    try {
      await this.deps.repo.db.transaction(async (tx) => {
        await this.deactivateTrivia(tx, byType('trivia'), now);
        await this.deactivateMissions(tx, byType('mission'), now);
        const items = byType('item');
        if (items.length) {
          await this.deactivateItems(tx, items, now);
          await unequipItems(this.deps.repo, tx, items);
        }
        const enemies = byType('enemy');
        if (enemies.length) {
          if (!this.deps.applyEnemies)
            throw new Error('aplicação de inimigos indisponível (ULTRON não carregado)');
          await this.deps.applyEnemies({
            tx,
            upserts: [],
            deactivateIds: enemies,
            importedBy: null,
            now,
          });
        }
        await tx
          .delete(this.t.jarvisContentPackItems)
          .where(eq(this.t.jarvisContentPackItems.packId, packId));
        await tx.delete(this.t.jarvisContentPacks).where(eq(this.t.jarvisContentPacks.id, packId));
      });
    } catch (err) {
      return { ok: false, errors: [(err as Error).message] };
    }
    return { ok: true };
  }

  async list(): Promise<(typeof this.t.jarvisContentPacks.$inferSelect)[]> {
    return this.deps.repo.db.orm
      .select()
      .from(this.t.jarvisContentPacks)
      .orderBy(this.t.jarvisContentPacks.id);
  }

  private async packRow(id: string) {
    const [row] = await this.deps.repo.db.orm
      .select()
      .from(this.t.jarvisContentPacks)
      .where(eq(this.t.jarvisContentPacks.id, id))
      .limit(1);
    return row ?? null;
  }

  private async plan(pack: ValidatedPack) {
    const errors: string[] = [];
    const ownership = await this.deps.repo.db.orm
      .select()
      .from(this.t.jarvisContentPackItems)
      .where(eq(this.t.jarvisContentPackItems.packId, pack.id));
    const owned = new Map(ownership.map((r) => [`${r.contentType}:${r.contentId}`, r]));

    const trivia: { q: TriviaQuestion; change: Change }[] = [];
    for (const q of pack.trivia) {
      const prev = await this.deps.repo.question(q.id);
      const mine = owned.has(`trivia:${q.id}`);
      if (prev && !mine) {
        if (prev.origin === 'file')
          errors.push(`trivia → ${q.id}: id de uma pergunta dos arquivos de conteúdo; use outro id`);
        else if (prev.origin === PACK_ORIGIN) errors.push(`trivia → ${q.id}: id pertence a outro pacote`);
        else errors.push(`trivia → ${q.id}: id já usado por conteúdo da staff; use outro id`);
        continue;
      }
      const change: Change = !prev ? 'new' : prev.contentHash === triviaHash(q) ? 'same' : 'changed';
      trivia.push({ q, change });
    }

    const missions: { m: Mission; change: Change }[] = [];
    for (const m of pack.missions) {
      const prev = await this.deps.repo.mission(m.id);
      const mine = owned.has(`mission:${m.id}`);
      if (prev && !mine) {
        if (prev.origin === 'file')
          errors.push(`missions → ${m.id}: id de uma missão dos arquivos; use outro id`);
        else if (prev.origin === PACK_ORIGIN) errors.push(`missions → ${m.id}: id pertence a outro pacote`);
        else errors.push(`missions → ${m.id}: id já usado por conteúdo da staff; use outro id`);
        continue;
      }
      const hash = missionColumns(m).contentHash;
      const change: Change = !prev ? 'new' : prev.contentHash === hash ? 'same' : 'changed';
      missions.push({ m, change });
    }

    const items: { item: Item; change: Change; prevActive: number | null }[] = [];
    for (const item of pack.items) {
      const prev = await this.deps.repo.db.orm
        .select()
        .from(this.t.jarvisItems)
        .where(eq(this.t.jarvisItems.id, item.id))
        .limit(1)
        .then((r) => r[0] ?? null);
      const mine = owned.has(`item:${item.id}`);
      if (prev && !mine) {
        if (prev.origin === 'file')
          errors.push(`items → ${item.id}: id de um item dos arquivos; use outro id`);
        else if (prev.origin === PACK_ORIGIN) errors.push(`items → ${item.id}: id pertence a outro pacote`);
        else errors.push(`items → ${item.id}: id já usado por conteúdo da staff; use outro id`);
        continue;
      }
      const hash = itemColumns(item).contentHash;
      const change: Change = !prev ? 'new' : prev.contentHash === hash ? 'same' : 'changed';
      items.push({ item, change, prevActive: prev?.active ?? null });
    }

    const enemies: { enemy: ValidatedPack['enemies'][number]; change: Change }[] = [];
    for (const enemy of pack.enemies) {
      const mine = owned.has(`enemy:${enemy.id}`);
      const otherPack = !mine
        ? await this.deps.repo.db.orm
            .select()
            .from(this.t.jarvisContentPackItems)
            .where(
              and(
                eq(this.t.jarvisContentPackItems.contentType, 'enemy'),
                eq(this.t.jarvisContentPackItems.contentId, enemy.id),
              ),
            )
            .limit(1)
            .then((r) => r[0] ?? null)
        : null;
      if (otherPack) {
        errors.push(`enemies → ${enemy.id}: id pertence a outro pacote`);
        continue;
      }
      // Without reading ULTRON rows here, owned enemies are rewritten on each newer pack version.
      enemies.push({ enemy, change: mine ? 'changed' : 'new' });
    }

    const keep = {
      trivia: new Set(pack.trivia.map((q) => q.id)),
      mission: new Set(pack.missions.map((m) => m.id)),
      item: new Set(pack.items.map((i) => i.id)),
      enemy: new Set(pack.enemies.map((e) => e.id)),
    };
    const deactivate = {
      trivia: ownership
        .filter((r) => r.contentType === 'trivia' && !keep.trivia.has(r.contentId))
        .map((r) => r.contentId),
      missions: ownership
        .filter((r) => r.contentType === 'mission' && !keep.mission.has(r.contentId))
        .map((r) => r.contentId),
      items: ownership
        .filter((r) => r.contentType === 'item' && !keep.item.has(r.contentId))
        .map((r) => r.contentId),
      enemies: ownership
        .filter((r) => r.contentType === 'enemy' && !keep.enemy.has(r.contentId))
        .map((r) => r.contentId),
    };

    return { trivia, missions, items, enemies, deactivate, errors };
  }

  private async upsertTrivia(tx: Executor, q: TriviaQuestion, now: string, importedBy: string | null) {
    const t = this.t.jarvisTriviaQuestions;
    const row = {
      locale: q.locale,
      category: q.category,
      difficulty: q.difficulty,
      question: q.question,
      choices: JSON.stringify(q.choices),
      answerIndex: q.answer,
      explanation: q.explanation,
      source: q.source,
      contentHash: triviaHash(q),
      active: 1,
      origin: PACK_ORIGIN,
      review: 'approved' as const,
      createdBy: importedBy,
      reviewedBy: null,
      updatedAt: now,
      squadId: null as string | null,
    };
    await tx
      .insert(t)
      .values({ id: q.id, ...row })
      .onConflictDoUpdate({ target: t.id, set: row });
  }

  private async upsertMission(tx: Executor, m: Mission, now: string, importedBy: string | null) {
    const t = this.t.jarvisMissions;
    const row = {
      ...missionColumns(m),
      active: 1,
      origin: PACK_ORIGIN,
      importedBy,
      disabledBy: null,
      updatedAt: now,
      squadId: null as string | null,
    };
    await tx
      .insert(t)
      .values({ id: m.id, ...row })
      .onConflictDoUpdate({ target: t.id, set: row });
  }

  private async upsertItem(tx: Executor, item: Item, now: string, importedBy: string | null, active: number) {
    const t = this.t.jarvisItems;
    const row = {
      ...itemColumns(item),
      active,
      origin: PACK_ORIGIN,
      importedBy,
      disabledBy: null,
      updatedAt: now,
    };
    await tx
      .insert(t)
      .values({ id: item.id, ...row })
      .onConflictDoUpdate({ target: t.id, set: row });
  }

  private async deactivateTrivia(tx: Executor, ids: string[], now: string) {
    if (!ids.length) return;
    const t = this.t.jarvisTriviaQuestions;
    await tx
      .update(t)
      .set({ active: 0, updatedAt: now })
      .where(and(eq(t.origin, PACK_ORIGIN), inArray(t.id, ids)));
  }

  private async deactivateMissions(tx: Executor, ids: string[], now: string) {
    if (!ids.length) return;
    const t = this.t.jarvisMissions;
    await tx
      .update(t)
      .set({ active: 0, updatedAt: now })
      .where(and(eq(t.origin, PACK_ORIGIN), inArray(t.id, ids)));
  }

  private async deactivateItems(tx: Executor, ids: string[], now: string) {
    if (!ids.length) return;
    const t = this.t.jarvisItems;
    await tx
      .update(t)
      .set({ active: 0, updatedAt: now })
      .where(and(eq(t.origin, PACK_ORIGIN), inArray(t.id, ids)));
  }

  private async writeOwnership(tx: Executor, pack: ValidatedPack, source: PackSource, now: string) {
    const packs = this.t.jarvisContentPacks;
    const items = this.t.jarvisContentPackItems;
    const name = JSON.stringify(pack.name);
    const row = {
      name,
      version: pack.version,
      author: pack.author,
      source,
      updatedAt: now,
      definition: JSON.stringify({
        trivia: pack.trivia.map((q) => q.id),
        missions: pack.missions.map((m) => m.id),
        enemies: pack.enemies.map((e) => e.id),
        items: pack.items.map((i) => i.id),
      }),
    };
    const prev = await tx.select().from(packs).where(eq(packs.id, pack.id)).limit(1);
    if (!prev.length) await tx.insert(packs).values({ id: pack.id, ...row, installedAt: now });
    else await tx.update(packs).set(row).where(eq(packs.id, pack.id));

    await tx.delete(items).where(eq(items.packId, pack.id));
    const rows = [
      ...pack.trivia.map((q) => ({
        packId: pack.id,
        contentType: 'trivia' as const,
        contentId: q.id,
        version: pack.version,
      })),
      ...pack.missions.map((m) => ({
        packId: pack.id,
        contentType: 'mission' as const,
        contentId: m.id,
        version: pack.version,
      })),
      ...pack.enemies.map((e) => ({
        packId: pack.id,
        contentType: 'enemy' as const,
        contentId: e.id,
        version: pack.version,
      })),
      ...pack.items.map((i) => ({
        packId: pack.id,
        contentType: 'item' as const,
        contentId: i.id,
        version: pack.version,
      })),
    ];
    if (rows.length) await tx.insert(items).values(rows);
  }
}

/** Wraps ultron `parseEnemiesYaml` for the pack composition callback. */
export function enemiesParserFromYaml(
  parseEnemiesYaml: (text: string, name: string) => { enemies: Array<{ id: string }>; errors: string[] },
): ParseEnemiesFn {
  return (list, label) => parseEnemiesYaml(enemiesListYaml(list), label);
}
