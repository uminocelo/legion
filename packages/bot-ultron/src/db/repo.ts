import type { Clock, Executor, LegionDb } from '@legion/core';
import { and, desc, eq, isNotNull, isNull, notInArray } from 'drizzle-orm';
import { contentHash, type EnemyTemplate } from '../content.js';
import { type UltronTables, ultronTables } from './tables.js';

export type EncounterRow = UltronTables['ultronEncounters']['$inferSelect'];
export type TemplateRow = UltronTables['ultronEnemyTemplates']['$inferSelect'];

/** Data access for ULTRON's encounter tables (world events live in EventsRepo). */
export class UltronRepo {
  readonly t: UltronTables;

  constructor(
    readonly db: LegionDb,
    readonly guildId: string,
    private readonly clock: Clock,
    readonly newId: () => string,
  ) {
    this.t = ultronTables(db);
  }

  now = () => this.clock.now().toISOString();

  // ---------- enemy templates ----------

  /** Upserts by id when the content hash changed; templates no longer in the files become inactive. */
  async syncTemplates(
    enemies: EnemyTemplate[],
  ): Promise<{ added: number; updated: number; deactivated: number }> {
    const t = this.t.ultronEnemyTemplates;
    const current = new Map((await this.db.orm.select().from(t)).map((r) => [r.id, r]));
    let added = 0;
    let updated = 0;
    await this.db.transaction(async (tx) => {
      for (const e of enemies) {
        const hash = contentHash(e);
        const prev = current.get(e.id);
        if (prev && prev.contentHash === hash && prev.active === 1) continue;
        const row = {
          id: e.id,
          name: e.name,
          tier: e.tier,
          minLevel: e.minLevel,
          base: JSON.stringify(e.base),
          powerCooldownMax: e.powerCooldownMax,
          tauntKeys: JSON.stringify(e.tauntKeys),
          contentHash: hash,
          active: 1,
          updatedAt: this.now(),
        };
        if (prev) {
          await tx.update(t).set(row).where(eq(t.id, e.id));
          updated++;
        } else {
          await tx.insert(t).values(row);
          added++;
        }
      }
    });
    const keep = enemies.map((e) => e.id);
    const gone = [...current.values()].filter((r) => r.active === 1 && !keep.includes(r.id));
    if (gone.length)
      await this.db.orm
        .update(t)
        .set({ active: 0, updatedAt: this.now() })
        .where(and(eq(t.active, 1), keep.length ? notInArray(t.id, keep) : undefined));
    return { added, updated, deactivated: gone.length };
  }

  async templates(): Promise<EnemyTemplate[]> {
    const t = this.t.ultronEnemyTemplates;
    const rows = await this.db.orm.select().from(t).where(eq(t.active, 1));
    return rows.map(toTemplate);
  }

  async template(id: string): Promise<EnemyTemplate | null> {
    const t = this.t.ultronEnemyTemplates;
    const [row] = await this.db.orm.select().from(t).where(eq(t.id, id)).limit(1);
    return row ? toTemplate(row) : null;
  }

  // ---------- encounters ----------

  /** False when the mission already has an encounter (idempotent spawner). */
  async insertEncounter(
    row: Omit<EncounterRow, 'guildId' | 'createdAt' | 'outcome' | 'resolvedAt'>,
    ex: Executor,
  ) {
    const e = this.t.ultronEncounters;
    const rows = await ex
      .insert(e)
      .values({ ...row, guildId: this.guildId, createdAt: this.now() })
      .onConflictDoNothing()
      .returning({ id: e.id });
    return rows.length > 0;
  }

  async encounterByCombat(combatId: string, ex: Executor = this.db.orm): Promise<EncounterRow | null> {
    const e = this.t.ultronEncounters;
    const [row] = await ex.select().from(e).where(eq(e.combatId, combatId)).limit(1);
    return row ?? null;
  }

  async encounterByMission(missionId: string): Promise<EncounterRow | null> {
    const e = this.t.ultronEncounters;
    const [row] = await this.db.orm.select().from(e).where(eq(e.missionId, missionId)).limit(1);
    return row ?? null;
  }

  /** Stores the outcome once; false when it was already stored. */
  async resolveEncounter(combatId: string, outcome: 'players' | 'enemies' | 'draw', ex: Executor) {
    const e = this.t.ultronEncounters;
    const rows = await ex
      .update(e)
      .set({ outcome, resolvedAt: this.now() })
      .where(and(eq(e.combatId, combatId), isNull(e.outcome)))
      .returning({ id: e.id });
    return rows.length > 0;
  }

  /** Outcomes of the last `n` resolved party encounters (newest first), for adaptive difficulty. */
  async recentPartyOutcomes(n: number): Promise<('players' | 'enemies' | 'draw')[]> {
    const e = this.t.ultronEncounters;
    const rows = await this.db.orm
      .select({ outcome: e.outcome, size: e.partySize })
      .from(e)
      .where(and(eq(e.guildId, this.guildId), isNotNull(e.outcome)))
      .orderBy(desc(e.resolvedAt))
      .limit(n * 4);
    return rows
      .filter((r) => r.size > 1)
      .slice(0, n)
      .map((r) => r.outcome as 'players' | 'enemies' | 'draw');
  }

  async recentEncounters(limit = 5): Promise<EncounterRow[]> {
    const e = this.t.ultronEncounters;
    return this.db.orm
      .select()
      .from(e)
      .where(eq(e.guildId, this.guildId))
      .orderBy(desc(e.createdAt))
      .limit(limit);
  }
}

const toTemplate = (r: TemplateRow): EnemyTemplate => ({
  id: r.id,
  name: r.name,
  tier: r.tier as EnemyTemplate['tier'],
  minLevel: r.minLevel,
  base: JSON.parse(r.base),
  powerCooldownMax: r.powerCooldownMax,
  tauntKeys: JSON.parse(r.tauntKeys),
});
