// Items (v0.10, US-15): the catalog loaded from files and the inventory/equipment of each member.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BotContext,
  type EquippedItemView,
  type Executor,
  type GearReadModel,
  type Item,
  type ItemSlot,
  isCanonName,
  itemBonus,
  parseItemsYaml,
  type StatBonus,
  ZERO_BONUS,
} from '@legion/core';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { JarvisConfig } from './config.js';
import type { JarvisRepo } from './db/repo.js';
import type { JarvisTables } from './db/tables.js';
import { JARVIS_CONTENT_DIR } from './paths.js';
import { InsufficientCredits, type WalletService } from './wallet.js';

export type ItemRow = JarvisTables['jarvisItems']['$inferSelect'];
export type InventoryRow = JarvisTables['jarvisInventory']['$inferSelect'];

/** The shipped items, then the server's own (same id replaces). */
export const itemDirs = (dataDir = 'data/content') => [`${JARVIS_CONTENT_DIR}/items`, `${dataDir}/items`];

export interface ItemLoadResult {
  items: Item[];
  errors: string[];
}

/**
 * Reads every *.yaml list of items. A file with any error is skipped whole (its items keep their
 * last loaded state); a later folder overrides an earlier one by id.
 */
export function readItems(dirs: string[]): ItemLoadResult {
  const byId = new Map<string, Item>();
  const errors: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const seen = new Map<string, string>();
    for (const file of readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()) {
      const res = parseItemsYaml(readFileSync(join(dir, file), 'utf8'), file, isCanonName);
      if (res.errors.length) {
        errors.push(...res.errors);
        continue;
      }
      for (const item of res.items) {
        const prev = seen.get(item.id);
        if (prev) {
          errors.push(`${file} → id: "${item.id}" já existe em ${prev}`);
          continue;
        }
        seen.set(item.id, file);
        byId.set(item.id, item);
      }
    }
  }
  return { items: [...byId.values()], errors };
}

const itemHash = (i: Item) => createHash('sha256').update(JSON.stringify(i)).digest('hex').slice(0, 16);

export const itemColumns = (i: Item) => ({
  slot: i.slot,
  minLevel: i.minLevel,
  cosmetic: i.cosmetic ? 1 : 0,
  price: i.shop?.price ?? null,
  definition: JSON.stringify(i),
  contentHash: itemHash(i),
});

export const parseItem = (row: Pick<ItemRow, 'definition'>): Item => JSON.parse(row.definition) as Item;

export interface ItemSyncResult {
  added: number;
  updated: number;
  deactivated: number;
  unchanged: number;
  /** Equipment rows removed because their item became inactive (D9). */
  unequipped: number;
  errors: string[];
}

/** Deletes the equipment rows of these items; ownership stays (D9). Returns how many were removed. */
export async function unequipItems(
  repo: JarvisRepo,
  tx: Executor,
  itemIds: readonly string[],
): Promise<number> {
  if (!itemIds.length) return 0;
  const e = repo.t.jarvisEquipment;
  const rows = await tx
    .delete(e)
    .where(inArray(e.itemId, [...itemIds]))
    .returning({ m: e.memberId });
  return rows.length;
}

/** `price` as the shop sees it: the staff override when set, else the file's `shop.price`. */
const effectivePrice = (r: ItemRow): ItemRow =>
  r.priceOverride == null ? r : { ...r, price: r.priceOverride };

/** The item catalog: files (shipped, then the server's) and staff rows, which win and are never touched by reloads. */
export class ItemCatalog {
  constructor(private readonly repo: JarvisRepo) {}

  async all(ex: Executor = this.repo.db.orm): Promise<ItemRow[]> {
    const t = this.repo.t.jarvisItems;
    return (await ex.select().from(t).orderBy(t.id)).map(effectivePrice);
  }

  async row(id: string, ex: Executor = this.repo.db.orm): Promise<ItemRow | null> {
    const t = this.repo.t.jarvisItems;
    const [row] = await ex.select().from(t).where(eq(t.id, id)).limit(1);
    return row ? effectivePrice(row) : null;
  }

  /**
   * Sets (or, with null, clears) the staff price override (D24). Reloads never touch it.
   * Returns the item's effective price after the change, or null when the item does not exist.
   */
  async setPriceOverride(id: string, price: number | null): Promise<ItemRow | null> {
    const t = this.repo.t.jarvisItems;
    const rows = await this.repo.db.orm
      .update(t)
      .set({ priceOverride: price })
      .where(eq(t.id, id))
      .returning();
    return rows[0] ? effectivePrice(rows[0]) : null;
  }

  async rows(ids: readonly string[], ex: Executor = this.repo.db.orm): Promise<Map<string, ItemRow>> {
    if (!ids.length) return new Map();
    const t = this.repo.t.jarvisItems;
    const rows = await ex
      .select()
      .from(t)
      .where(inArray(t.id, [...ids]));
    return new Map(rows.map((r) => [r.id, effectivePrice(r)]));
  }

  /** Upserts file items by id. Items gone from the files become inactive, but only when every file was valid. */
  async sync(loaded: ItemLoadResult): Promise<ItemSyncResult> {
    const t = this.repo.t.jarvisItems;
    const all = await this.all();
    // Staff and pack rows win over files; reloads never overwrite them.
    const reserved = new Set(all.filter((r) => r.origin !== 'file').map((r) => r.id));
    const existing = new Map(all.filter((r) => r.origin === 'file').map((r) => [r.id, r]));
    const res: ItemSyncResult = {
      added: 0,
      updated: 0,
      deactivated: 0,
      unchanged: 0,
      unequipped: 0,
      errors: loaded.errors,
    };
    const now = this.repo.now();
    await this.repo.db.transaction(async (tx) => {
      const turnedOff: string[] = [];
      for (const item of loaded.items) {
        if (reserved.has(item.id)) continue;
        const prev = existing.get(item.id);
        const active = prev?.disabledBy || item.active === false ? 0 : 1;
        const row = { ...itemColumns(item), active, updatedAt: now };
        if (!prev) {
          await tx.insert(t).values({ id: item.id, ...row });
          res.added++;
        } else if (prev.contentHash !== row.contentHash || prev.active !== active) {
          await tx.update(t).set(row).where(eq(t.id, item.id));
          res.updated++;
        } else res.unchanged++;
        if (!active && prev?.active !== 0) turnedOff.push(item.id);
      }
      if (loaded.errors.length === 0) {
        const keep = new Set(loaded.items.map((i) => i.id));
        const gone = [...existing.values()].filter((r) => r.active === 1 && !keep.has(r.id)).map((r) => r.id);
        if (gone.length)
          await tx
            .update(t)
            .set({ active: 0, updatedAt: now })
            .where(and(eq(t.origin, 'file'), keep.size ? notInArray(t.id, [...keep]) : undefined));
        res.deactivated = gone.length;
        turnedOff.push(...gone);
      }
      res.unequipped = await unequipItems(this.repo, tx, turnedOff);
    });
    return res;
  }

  /** Loads the item files and syncs them. */
  async reload(dirs = itemDirs()): Promise<ItemSyncResult> {
    return this.sync(readItems(dirs));
  }
}

export type EquipRefusal = 'not_owned' | 'unknown' | 'inactive' | 'level' | 'slot';
export type EquipResult =
  | { ok: true; replaced: string | null }
  | { ok: false; reason: EquipRefusal; minLevel?: number };
export type BuyResult =
  | { ok: true; price: number; balance: number }
  | { ok: false; reason: 'insufficient'; price: number; balance: number }
  | { ok: false; reason: 'owned' | 'not_for_sale' }
  | { ok: false; reason: 'price_changed'; price: number }
  | { ok: false; reason: 'level_too_low'; minLevel: number };

/** Thrown inside the purchase transaction to undo the debit when the grant loses a race. */
class AlreadyOwned extends Error {}

export type GrantResult = { ok: true } | { ok: false; reason: 'unknown' | 'owned' };

/** Ownership and equipment. Every check runs again inside the write transaction. */
export class InventoryService {
  constructor(
    private readonly ctx: BotContext<JarvisConfig>,
    private readonly repo: JarvisRepo,
    private readonly catalog: ItemCatalog,
    private readonly wallet?: WalletService,
  ) {}

  /** Gives an item (unique per member, D6). */
  async grant(o: {
    memberId: string;
    itemId: string;
    source: 'purchase' | 'staff';
    grantedBy?: string | null;
    note?: string | null;
  }): Promise<GrantResult> {
    const inv = this.repo.t.jarvisInventory;
    return this.repo.db.transaction(async (tx) => {
      if (!(await this.catalog.row(o.itemId, tx))) return { ok: false, reason: 'unknown' } as const;
      const rows = await tx
        .insert(inv)
        .values({
          memberId: o.memberId,
          itemId: o.itemId,
          guildId: this.repo.guildId,
          source: o.source,
          grantedBy: o.grantedBy ?? null,
          note: o.note ?? null,
          acquiredAt: this.repo.now(),
        })
        .onConflictDoNothing()
        .returning({ m: inv.memberId });
      return rows.length ? ({ ok: true } as const) : ({ ok: false, reason: 'owned' } as const);
    });
  }

  /**
   * Buys an item at `expectedPrice` (the price the player saw): re-reads the item, debits
   * `buy:<memberId>:<itemId>` and grants, all in one transaction (D8). Nothing is written unless it
   * returns `ok`. Two clicks at once: the unique ledger key and the inventory key let only one through.
   */
  async buy(memberId: string, itemId: string, expectedPrice: number): Promise<BuyResult> {
    const wallet = this.wallet;
    if (!wallet) throw new Error('InventoryService.buy needs the wallet');
    const inv = this.repo.t.jarvisInventory;
    try {
      return await this.repo.db.transaction(async (tx): Promise<BuyResult> => {
        const item = await this.catalog.row(itemId, tx);
        if (!item || item.active !== 1 || item.price === null) return { ok: false, reason: 'not_for_sale' };
        if (item.price !== expectedPrice) return { ok: false, reason: 'price_changed', price: item.price };
        const [own] = await tx
          .select({ m: inv.memberId })
          .from(inv)
          .where(and(eq(inv.memberId, memberId), eq(inv.itemId, itemId)))
          .limit(1);
        if (own) return { ok: false, reason: 'owned' };
        const level = (await this.repo.progress(memberId, tx))?.level ?? 1;
        if (level < item.minLevel) return { ok: false, reason: 'level_too_low', minLevel: item.minLevel };
        const paid = await wallet.debit(tx, {
          memberId,
          amount: item.price,
          reason: 'purchase',
          note: itemId,
          sourceKey: `buy:${memberId}:${itemId}`,
        });
        if (paid.duplicate) return { ok: false, reason: 'owned' };
        const granted = await tx
          .insert(inv)
          .values({
            memberId,
            itemId,
            guildId: this.repo.guildId,
            source: 'purchase',
            acquiredAt: this.repo.now(),
          })
          .onConflictDoNothing()
          .returning({ m: inv.memberId });
        if (!granted.length) throw new AlreadyOwned();
        return { ok: true, price: item.price, balance: paid.balance };
      });
    } catch (err) {
      if (err instanceof AlreadyOwned) return { ok: false, reason: 'owned' };
      if (err instanceof InsufficientCredits)
        return { ok: false, reason: 'insufficient', price: err.amount, balance: err.balance };
      throw err;
    }
  }

  async owned(memberId: string, ex: Executor = this.repo.db.orm): Promise<InventoryRow[]> {
    const inv = this.repo.t.jarvisInventory;
    return ex.select().from(inv).where(eq(inv.memberId, memberId)).orderBy(inv.acquiredAt, inv.itemId);
  }

  /** slot → item id. */
  async equipment(memberId: string, ex: Executor = this.repo.db.orm): Promise<Map<ItemSlot, string>> {
    const e = this.repo.t.jarvisEquipment;
    const rows = await ex.select().from(e).where(eq(e.memberId, memberId));
    return new Map(rows.map((r) => [r.slot as ItemSlot, r.itemId]));
  }

  /** Equips an owned, active item of the right slot and level; swaps whatever was in the slot. */
  async equip(memberId: string, itemId: string, slot: ItemSlot): Promise<EquipResult> {
    const inv = this.repo.t.jarvisInventory;
    const e = this.repo.t.jarvisEquipment;
    return this.repo.db.transaction(async (tx): Promise<EquipResult> => {
      const [own] = await tx
        .select()
        .from(inv)
        .where(and(eq(inv.memberId, memberId), eq(inv.itemId, itemId)))
        .limit(1);
      if (!own) return { ok: false, reason: 'not_owned' };
      const item = await this.catalog.row(itemId, tx);
      if (!item) return { ok: false, reason: 'unknown' };
      if (item.active !== 1) return { ok: false, reason: 'inactive' };
      if (item.slot !== slot) return { ok: false, reason: 'slot' };
      const level = (await this.repo.progress(memberId, tx))?.level ?? 1;
      if (level < item.minLevel) return { ok: false, reason: 'level', minLevel: item.minLevel };
      const [prev] = await tx
        .select()
        .from(e)
        .where(and(eq(e.memberId, memberId), eq(e.slot, slot)))
        .limit(1);
      if (prev?.itemId === itemId) return { ok: true, replaced: null };
      const row = { itemId, guildId: this.repo.guildId, equippedAt: this.repo.now() };
      if (prev)
        await tx
          .update(e)
          .set(row)
          .where(and(eq(e.memberId, memberId), eq(e.slot, slot)));
      else await tx.insert(e).values({ memberId, slot, ...row });
      return { ok: true, replaced: prev?.itemId ?? null };
    });
  }

  /** Empties a slot. False when it was already empty. */
  async unequip(memberId: string, slot: ItemSlot): Promise<boolean> {
    const e = this.repo.t.jarvisEquipment;
    const rows = await this.repo.db.orm
      .delete(e)
      .where(and(eq(e.memberId, memberId), eq(e.slot, slot)))
      .returning({ m: e.memberId });
    return rows.length > 0;
  }

  /**
   * Turns an item off: inactive in the catalog, unequipped from everyone, still owned (D9). `by` is the
   * staff member (kept across reloads); null for a content change. Returns how many were unequipped.
   */
  async deactivate(itemId: string, by: string | null = null): Promise<number> {
    const t = this.repo.t.jarvisItems;
    return this.repo.db.transaction(async (tx) => {
      await tx
        .update(t)
        .set({ active: 0, updatedAt: this.repo.now(), ...(by ? { disabledBy: by } : {}) })
        .where(eq(t.id, itemId));
      return unequipItems(this.repo, tx, [itemId]);
    });
  }

  /** Active equipped items of a member, with their definitions. */
  async equippedItems(memberId: string): Promise<{ slot: ItemSlot; item: Item }[]> {
    const eq_ = await this.equipment(memberId);
    const rows = await this.catalog.rows([...eq_.values()]);
    const out: { slot: ItemSlot; item: Item }[] = [];
    for (const [slot, id] of eq_) {
      const row = rows.get(id);
      if (row?.active === 1) out.push({ slot, item: parseItem(row) });
    }
    return out;
  }

  /** Raw sum of the active equipped items (the cap is applied by `playerStats`). */
  async bonusOf(memberId: string): Promise<StatBonus> {
    const sum = { ...ZERO_BONUS };
    for (const { item } of await this.equippedItems(memberId)) {
      const b = itemBonus(item);
      for (const k of Object.keys(sum) as (keyof StatBonus)[]) sum[k] += b[k];
    }
    return sum;
  }

  statCap(): number {
    return this.ctx.botConfig.economy.gear.statCap;
  }

  gearReadModel(): GearReadModel {
    return {
      bonusOf: (id) => this.bonusOf(id),
      equippedOf: async (id): Promise<EquippedItemView[]> =>
        (await this.equippedItems(id)).map(({ slot, item }) => ({ slot, itemId: item.id, name: item.name })),
      statCap: () => this.statCap(),
    };
  }
}
