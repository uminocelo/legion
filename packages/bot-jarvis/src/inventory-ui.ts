// `/inventario` (players) and `/jarvis item dar` (staff), v0.10 US-15.
import {
  type ActionRow,
  type BotContext,
  customId,
  type IncomingInteraction,
  ITEM_SLOTS,
  type Item,
  type ItemSlot,
  itemBonus,
  type Locale,
  type OutgoingMessage,
  type Responder,
  type StatBonus,
} from '@legion/core';
import type { JarvisConfig } from './config.js';
import { type EquipResult, parseItem } from './items.js';
import type { JarvisServices } from './services.js';
import { V } from './ui.js';

export const inventoryIds = {
  equip: (slot: ItemSlot, owner: string) => customId('jarvis', V, 'inv', 'equip', slot, owner),
  unequip: (slot: ItemSlot, owner: string) => customId('jarvis', V, 'inv', 'unequip', slot, owner),
};

const STATS: (keyof StatBonus)[] = ['hp', 'atk', 'def', 'spd', 'foc'];
const SLOT_EMOJI: Record<ItemSlot, string> = { traje: '🥋', acessorio: '🧤', dispositivo: '📡' };
const isSlot = (v: string | undefined): v is ItemSlot => (ITEM_SLOTS as readonly string[]).includes(v ?? '');

export class JarvisInventory {
  constructor(
    private readonly ctx: BotContext<JarvisConfig>,
    private readonly s: JarvisServices,
  ) {}

  private t = (key: string, vars: Record<string, string | number>, l: Locale) =>
    this.ctx.i18n.t(`jarvis.inventory.${key}`, vars, l);

  private text(content: string): OutgoingMessage {
    return { persona: 'jarvis', content, ephemeral: true, allowedMentions: { parse: [] } };
  }

  private name(item: Item, l: Locale): string {
    return (l === 'en' ? item.name.en : undefined) ?? item.name['pt-BR'];
  }

  /** "+1 DEF, +8 VIDA", or "visual" for cosmetics. */
  bonusText(b: StatBonus, l: Locale): string {
    const parts = STATS.filter((k) => b[k] > 0).map((k) => `+${b[k]} ${this.t(`stat.${k}`, {}, l)}`);
    return parts.join(', ') || this.t('cosmetic', {}, l);
  }

  /** The inventory message for a member (ephemeral), with an optional notice on top. */
  async view(memberId: string, owner: string, l: Locale, notice?: string): Promise<OutgoingMessage> {
    const inv = this.s.inventory;
    const owned = await inv.owned(memberId);
    const rows = await this.s.items.rows(owned.map((o) => o.itemId));
    const equipped = await inv.equipment(memberId);
    const level = (await this.s.repo.progress(memberId))?.level ?? 1;
    const cap = inv.statCap();
    const items = owned.flatMap((o) => {
      const row = rows.get(o.itemId);
      return row ? [{ row, item: parseItem(row) }] : [];
    });

    const fields = ITEM_SLOTS.map((slot) => {
      const id = equipped.get(slot);
      const it = items.find((x) => x.item.id === id && x.row.active === 1);
      return {
        name: `${SLOT_EMOJI[slot]} ${this.t(`slot.${slot}`, {}, l)}`,
        value: it
          ? `**${this.name(it.item, l)}**\n${this.bonusText(itemBonus(it.item), l)}`
          : this.t('empty', {}, l),
        inline: true,
      };
    });

    const lines = items.map(({ row, item }) => {
      const tags: string[] = [];
      if (row.active !== 1) tags.push(this.t('tag_disabled', {}, l));
      else if (level < item.minLevel) tags.push(this.t('tag_level', { level: item.minLevel }, l));
      if (equipped.get(item.slot) === item.id && row.active === 1) tags.push(this.t('tag_equipped', {}, l));
      const tagText = tags.length ? ` · _${tags.join(' · ')}_` : '';
      return `${SLOT_EMOJI[item.slot]} **${this.name(item, l)}** (${this.bonusText(itemBonus(item), l)})${tagText}`;
    });

    const raw = await inv.bonusOf(memberId);
    const over = STATS.some((k) => raw[k] > (k === 'hp' ? cap * 8 : cap));
    const capped = Object.fromEntries(
      STATS.map((k) => [k, Math.min(raw[k], k === 'hp' ? cap * 8 : cap)]),
    ) as unknown as StatBonus;
    const footer =
      cap === 0
        ? this.t('no_effect', {}, l)
        : `${this.t('total', { bonus: STATS.some((k) => capped[k] > 0) ? this.bonusText(capped, l) : '—' }, l)}${
            over ? ` · ${this.t('cap_reached', { cap, hp: cap * 8 }, l)}` : ''
          }`;

    const components: ActionRow[] = [];
    for (const slot of ITEM_SLOTS) {
      const options = items
        .filter(({ row, item }) => item.slot === slot && row.active === 1 && level >= item.minLevel)
        .slice(0, 25)
        .map(({ item }) => ({
          label: this.name(item, l).slice(0, 100),
          value: item.id,
          description: this.bonusText(itemBonus(item), l).slice(0, 100),
          default: equipped.get(slot) === item.id,
        }));
      if (options.length)
        components.push([
          {
            type: 'select',
            customId: inventoryIds.equip(slot, owner),
            placeholder: this.t('pick', { slot: this.t(`slot.${slot}`, {}, l) }, l),
            options,
          },
        ]);
    }
    const unequip: ActionRow = ITEM_SLOTS.filter((slot) => equipped.has(slot)).map((slot) => ({
      type: 'button',
      customId: inventoryIds.unequip(slot, owner),
      label: this.t('unequip', { slot: this.t(`slot.${slot}`, {}, l) }, l),
      style: 'secondary',
    }));
    if (unequip.length) components.push(unequip);

    return {
      persona: 'jarvis',
      ephemeral: true,
      allowedMentions: { parse: [] },
      ...(notice ? { content: notice } : {}),
      embeds: [
        {
          title: this.t('title', {}, l),
          description: lines.length ? lines.join('\n').slice(0, 4000) : this.t('none', {}, l),
          fields,
          footer: { text: footer },
        },
      ],
      components,
    };
  }

  /** `/inventario`. */
  async command(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const member = await this.s.trivia.registered(i, r, l);
    if (!member) return;
    await r.reply(await this.view(member.id, i.userId, l));
  }

  /** `inv:equip:<slot>:<owner>` and `inv:unequip:<slot>:<owner>`. */
  async component(i: IncomingInteraction, r: Responder, [op, slot, owner]: string[]): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    if (owner !== i.userId) return r.reply(this.text(this.t('not_yours', {}, l)));
    if (!isSlot(slot)) return r.reply(this.text(this.t('stale', {}, l)));
    const member = await this.s.trivia.registered(i, r, l);
    if (!member) return;
    if (op === 'unequip') {
      const done = await this.s.inventory.unequip(member.id, slot);
      const notice = done
        ? this.t('unequipped', { slot: this.t(`slot.${slot}`, {}, l) }, l)
        : this.t('stale', {}, l);
      return r.update(await this.view(member.id, i.userId, l, notice));
    }
    if (op !== 'equip') return r.reply(this.text(this.t('stale', {}, l)));
    const itemId = i.values?.[0] ?? '';
    const res = await this.s.inventory.equip(member.id, itemId, slot);
    const row = await this.s.items.row(itemId);
    const name = row ? this.name(parseItem(row), l) : itemId;
    return r.update(await this.view(member.id, i.userId, l, this.equipNotice(res, name, l)));
  }

  private equipNotice(res: EquipResult, name: string, l: Locale): string {
    if (res.ok) return this.t('equipped', { item: name }, l);
    if (res.reason === 'level') return this.t('refused_level', { item: name, level: res.minLevel ?? 1 }, l);
    return this.t(`refused_${res.reason}`, { item: name }, l);
  }

  /** `/jarvis item dar membro item [motivo]` (staff). */
  async staffGrant(i: IncomingInteraction, r: Responder, l: Locale): Promise<void> {
    const member = await this.ctx.read.members.getByDiscordId(String(i.options?.membro ?? ''));
    if (!member) return r.reply(this.text(this.ctx.i18n.t('jarvis.errors.unknown_member', {}, l)));
    const itemId = String(i.options?.item ?? '').trim();
    const reason =
      String(i.options?.motivo ?? '')
        .trim()
        .slice(0, 200) || null;
    const res = await this.s.inventory.grant({
      memberId: member.id,
      itemId,
      source: 'staff',
      grantedBy: i.userId,
      note: reason,
    });
    const row = await this.s.items.row(itemId);
    const vars = { item: row ? this.name(parseItem(row), l) : itemId, member: `<@${member.discordUserId}>` };
    if (!res.ok) return r.reply(this.text(this.t(`grant_${res.reason}`, vars, l)));
    this.ctx.log.info({ staff: i.userId, memberId: member.id, itemId, reason }, 'staff item grant');
    return r.reply(this.text(this.t('granted', vars, l)));
  }

  /** Autocomplete for the `item` option: every item in the catalog. */
  async autocomplete(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const q = (i.focused?.value ?? '').toLowerCase();
    const choices = (await this.s.items.all())
      .map((row) => ({ row, item: parseItem(row) }))
      .filter(({ item }) => `${item.id} ${this.name(item, l)}`.toLowerCase().includes(q))
      .slice(0, 25)
      .map(({ row, item }) => ({
        name: `${this.name(item, l)} (${item.id})${row.active === 1 ? '' : ` · ${this.t('tag_disabled', {}, l)}`}`.slice(
          0,
          100,
        ),
        value: item.id,
      }));
    return r.autocomplete(choices);
  }
}
