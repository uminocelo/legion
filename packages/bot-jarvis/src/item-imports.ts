// Staff item tools (v0.10, US-17): `/jarvis item importar|exportar|desativar|ativar`.
import {
  type BotContext,
  customId,
  type IncomingInteraction,
  type Item,
  isCanonName,
  itemBonus,
  type Locale,
  type OutgoingMessage,
  parseItemsYaml,
  type Responder,
  readTextAttachment,
} from '@legion/core';
import { eq, inArray, sql } from 'drizzle-orm';
import { stringify as toYaml } from 'yaml';
import type { JarvisConfig } from './config.js';
import { type ItemRow, itemColumns, parseItem, unequipItems } from './items.js';
import { IMPORT_MAX_BYTES } from './mission-imports.js';
import type { JarvisServices } from './services.js';
import { V } from './ui.js';

export const itemImportIds = {
  decide: (stageId: string, action: 'publish' | 'cancel') =>
    customId('jarvis', V, 'item-import', stageId, action),
};

const stageKey = (id: string) => `jarvis.item-import.${id}`;
interface Staged {
  text: string;
  name: string;
  staffId: string;
}

type Change = 'new' | 'changed' | 'same';
interface Plan {
  items: { item: Item; change: Change; prev: ItemRow | null; owners: number }[];
  errors: string[];
}

/**
 * Staff items: a YAML list in the format of the item files and the website editor → preview →
 * Publicar. All or nothing. Ids of file items (shipped or `data/content/items`) are refused; a staff
 * item with the same id is updated. Imported items are `origin: staff` and reloads never touch them.
 */
export class ItemImports {
  constructor(
    private readonly ctx: BotContext<JarvisConfig>,
    private readonly s: JarvisServices,
  ) {}

  private t = (key: string, vars: Record<string, string | number>, l: Locale) =>
    this.ctx.i18n.t(key, vars, l);
  private text = (content: string): OutgoingMessage => ({
    persona: 'jarvis',
    content,
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
  private get tbl() {
    return this.s.repo.t.jarvisItems;
  }
  private name(item: Item, l: Locale) {
    return (l === 'en' ? item.name.en : undefined) ?? item.name['pt-BR'];
  }

  /** How many members own each of these items. */
  private async owners(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const inv = this.s.repo.t.jarvisInventory;
    const rows = await this.ctx.db.orm
      .select({ id: inv.itemId, n: sql<number>`count(*)` })
      .from(inv)
      .where(inArray(inv.itemId, ids))
      .groupBy(inv.itemId);
    return new Map(rows.map((r) => [r.id, Number(r.n)]));
  }

  /** Validates the file and compares it with the catalog. */
  private async plan(text: string, name: string): Promise<Plan> {
    const parsed = parseItemsYaml(text, name, isCanonName);
    const errors = [...parsed.errors];
    if (!parsed.items.length && !errors.length) errors.push(`${name}: nenhum item no arquivo`);
    const rows = await this.s.items.rows(parsed.items.map((i) => i.id));
    const items: Plan['items'] = [];
    for (const item of parsed.items) {
      const prev = rows.get(item.id) ?? null;
      if (prev && prev.origin !== 'staff') {
        errors.push(
          `${name} → ${item.id}: id de um item dos arquivos (enviado com o Legion ou da pasta data); use outro id`,
        );
        continue;
      }
      const change: Change = !prev
        ? 'new'
        : prev.contentHash === itemColumns(item).contentHash
          ? 'same'
          : 'changed';
      items.push({ item, change, prev, owners: 0 });
    }
    const owners = await this.owners(items.filter((x) => x.change === 'changed').map((x) => x.item.id));
    for (const x of items) x.owners = owners.get(x.item.id) ?? 0;
    return { items, errors };
  }

  private errors(errors: string[], l: Locale) {
    const shown = errors.slice(0, 15).map((e) => `• ${e}`);
    if (errors.length > 15) shown.push(`… +${errors.length - 15}`);
    return this.t('jarvis.imports.invalid', { errors: shown.join('\n') }, l).slice(0, 1900);
  }

  private counts(p: Plan) {
    const n = (c: Change) => p.items.filter((x) => x.change === c).length;
    return { added: n('new'), changed: n('changed'), same: n('same') };
  }

  /** `/jarvis item importar arquivo`. */
  async import(i: IncomingInteraction, r: Responder) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const file = i.attachments?.arquivo;
    const got = await readTextAttachment(this.ctx.gateway, file, {
      maxBytes: IMPORT_MAX_BYTES,
      extensions: ['.yaml', '.yml'],
    });
    if ('problem' in got)
      return r.reply(
        this.text(this.t(`jarvis.imports.problem.${got.problem}`, { kb: IMPORT_MAX_BYTES / 1024 }, l)),
      );
    const name = file?.name ?? 'itens.yaml';
    const p = await this.plan(got.text, name);
    if (p.errors.length) return r.reply(this.text(this.errors(p.errors, l)));
    const stageId = this.ctx.newId();
    await this.ctx.kv.set(stageKey(stageId), { text: got.text, name, staffId: i.userId } satisfies Staged);
    const mark: Record<Change, string> = { new: '🆕', changed: '✏️', same: '＝' };
    const list = p.items
      .slice(0, 15)
      .map((x) =>
        `${mark[x.change]} \`${x.item.id}\` · ${this.name(x.item, l)} · ${this.s.inventoryUi.bonusText(itemBonus(x.item), l)}${x.item.shop ? ` · ${this.t('jarvis.shop.price', { price: x.item.shop.price }, l)}` : ''}${
          x.owners ? ` · ${this.t('jarvis.item_imports.owners', { count: x.owners }, l)}` : ''
        }`.slice(0, 200),
      );
    if (p.items.length > 15) list.push(`… +${p.items.length - 15}`);
    await r.reply({
      persona: 'jarvis',
      ephemeral: true,
      allowedMentions: { parse: [] },
      embeds: [
        {
          title: `${this.t('jarvis.imports.preview', {}, l)}: ${name}`,
          description: [this.t('jarvis.item_imports.summary', this.counts(p), l), '', ...list]
            .join('\n')
            .slice(0, 4000),
          color: 0x00b0f4,
        },
      ],
      components: [
        [
          {
            type: 'button',
            customId: itemImportIds.decide(stageId, 'publish'),
            label: this.t('jarvis.imports.publish', {}, l),
            style: 'success',
          },
          {
            type: 'button',
            customId: itemImportIds.decide(stageId, 'cancel'),
            label: this.t('jarvis.imports.cancel', {}, l),
            style: 'secondary',
          },
        ],
      ],
    });
  }

  /** Publicar / Cancelar on the preview. */
  async decide(i: IncomingInteraction, r: Responder, [stageId, action]: string[]) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    if (!(await this.ctx.isStaff(i))) return r.reply(this.text(this.t('jarvis.errors.not_staff', {}, l)));
    const key = stageKey(stageId ?? '');
    const staged = await this.ctx.kv.get<Staged | null>(key);
    const done = (content: string) => r.update({ ...this.text(content), embeds: [], components: [] });
    if (!staged) return done(this.t('jarvis.imports.expired', {}, l));
    await this.ctx.kv.set(key, null);
    if (action !== 'publish') return done(this.t('jarvis.imports.cancelled', {}, l));
    // Checked again: the catalog may have changed since the preview.
    const p = await this.plan(staged.text, staged.name);
    if (p.errors.length) return done(this.errors(p.errors, l));
    const now = this.s.repo.now();
    const unequipped = await this.ctx.db.transaction(async (tx) => {
      const turnedOff: string[] = [];
      for (const { item, change, prev } of p.items) {
        if (change === 'same') continue;
        // A staff-disabled item stays disabled; `active: false` in the file turns it off.
        const active = prev?.disabledBy || item.active === false ? 0 : 1;
        const row = { ...itemColumns(item), active, origin: 'staff', importedBy: i.userId, updatedAt: now };
        if (change === 'new') await tx.insert(this.tbl).values({ id: item.id, ...row });
        else await tx.update(this.tbl).set(row).where(eq(this.tbl.id, item.id));
        if (!active && prev?.active !== 0) turnedOff.push(item.id);
      }
      return unequipItems(this.s.repo, tx, turnedOff);
    });
    this.ctx.log.info({ staff: i.userId, ...this.counts(p), unequipped }, 'items imported');
    return done(this.t('jarvis.item_imports.published', { ...this.counts(p), unequipped }, l));
  }

  /** `/jarvis item exportar`: the staff items in the import format (`itens-staff.yaml`). */
  async export(i: IncomingInteraction, r: Responder) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const rows = await this.ctx.db.orm
      .select()
      .from(this.tbl)
      .where(eq(this.tbl.origin, 'staff'))
      .orderBy(this.tbl.id);
    const items = rows.map((row) => parseItem(row));
    const header = `# ${this.t('jarvis.item_imports.export_header', { date: this.ctx.clock.now().toISOString().slice(0, 10) }, l)}\n`;
    await r.reply({
      ...this.text(this.t('jarvis.item_imports.exported', { count: items.length }, l)),
      ...(items.length ? { files: [{ name: 'itens-staff.yaml', content: header + toYaml(items) }] } : {}),
    });
  }

  /** `/jarvis item desativar item` / `ativar item`: `disabled_by` survives reloads; disabling unequips owners (D9). */
  async setActive(i: IncomingInteraction, r: Responder, on: boolean) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const id = String(i.options?.item ?? '').trim();
    const row = await this.s.items.row(id);
    if (!row) return r.reply(this.text(this.t('jarvis.inventory.grant_unknown', { item: id }, l)));
    const name = this.name(parseItem(row), l);
    if (!on) {
      if (row.active !== 1)
        return r.reply(this.text(this.t('jarvis.item_imports.already_off', { item: name }, l)));
      const unequipped = await this.s.inventory.deactivate(id, i.userId);
      this.ctx.log.info({ staff: i.userId, itemId: id, unequipped }, 'item disabled');
      return r.reply(this.text(this.t('jarvis.item_imports.disabled', { item: name, count: unequipped }, l)));
    }
    if (row.active === 1)
      return r.reply(this.text(this.t('jarvis.item_imports.already_on', { item: name }, l)));
    if (parseItem(row).active === false)
      return r.reply(this.text(this.t('jarvis.item_imports.off_in_file', { item: name }, l)));
    await this.ctx.db.orm
      .update(this.tbl)
      .set({ active: 1, disabledBy: null, updatedAt: this.s.repo.now() })
      .where(eq(this.tbl.id, id));
    this.ctx.log.info({ staff: i.userId, itemId: id }, 'item enabled');
    return r.reply(this.text(this.t('jarvis.item_imports.enabled', { item: name }, l)));
  }
}
