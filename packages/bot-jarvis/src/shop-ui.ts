// `/loja [pagina]` (v0.10, US-16): the items with `shop.price`, 25 per page; pick one, then Comprar.
import {
  type ActionRow,
  type BotContext,
  customId,
  type IncomingInteraction,
  type Item,
  itemBonus,
  type Locale,
  type OutgoingMessage,
  type Responder,
} from '@legion/core';
import type { JarvisConfig } from './config.js';
import { type BuyResult, type ItemRow, parseItem } from './items.js';
import type { JarvisServices } from './services.js';
import { V } from './ui.js';

export const SHOP_PAGE = 25;
export const shopIds = {
  pick: (page: number, owner: string) => customId('jarvis', V, 'shop', 'pick', page, owner),
  page: (page: number, owner: string) => customId('jarvis', V, 'shop', 'page', page, owner),
  buy: (itemId: string, price: number, owner: string) =>
    customId('jarvis', V, 'shop', 'buy', itemId, price, owner),
};

/** Active items for sale, ordered by `shop.order`, then level, then id. */
export function shopStock(rows: ItemRow[]): { row: ItemRow; item: Item }[] {
  return rows
    .filter((r) => r.active === 1 && r.price !== null)
    .map((row) => ({ row, item: parseItem(row) }))
    .sort(
      (a, b) =>
        (a.item.shop?.order ?? Number.MAX_SAFE_INTEGER) - (b.item.shop?.order ?? Number.MAX_SAFE_INTEGER) ||
        a.item.minLevel - b.item.minLevel ||
        a.item.id.localeCompare(b.item.id),
    );
}

export class JarvisShop {
  constructor(
    private readonly ctx: BotContext<JarvisConfig>,
    private readonly s: JarvisServices,
  ) {}

  private t = (key: string, vars: Record<string, string | number>, l: Locale) =>
    this.ctx.i18n.t(`jarvis.shop.${key}`, vars, l);

  private text(content: string): OutgoingMessage {
    return { persona: 'jarvis', content, ephemeral: true, allowedMentions: { parse: [] } };
  }

  private name(item: Item, l: Locale): string {
    return (l === 'en' ? item.name.en : undefined) ?? item.name['pt-BR'];
  }

  /** One page of the shop, with the picked item (if any) and its Comprar button. */
  async view(
    memberId: string,
    owner: string,
    l: Locale,
    page: number,
    picked?: string,
    notice?: string,
  ): Promise<OutgoingMessage> {
    const stock = shopStock(await this.s.items.all());
    const pages = Math.max(1, Math.ceil(stock.length / SHOP_PAGE));
    const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
    const slice = stock.slice((p - 1) * SHOP_PAGE, p * SHOP_PAGE);
    const owned = new Set((await this.s.inventory.owned(memberId)).map((o) => o.itemId));
    const level = (await this.s.repo.progress(memberId))?.level ?? 1;
    const balance = await this.s.wallet.balanceOf(memberId);
    const inv = this.s.inventoryUi;

    const tags = (item: Item) => {
      const out: string[] = [];
      if (owned.has(item.id)) out.push(this.t('tag_owned', {}, l));
      else if (level < item.minLevel) out.push(this.t('tag_level', { level: item.minLevel }, l));
      if (item.cosmetic) out.push(this.t('tag_cosmetic', {}, l));
      return out.length ? ` · _${out.join(' · ')}_` : '';
    };
    const lines = slice.map(
      ({ item, row }) =>
        `**${this.name(item, l)}** · ${this.t('price', { price: row.price ?? 0 }, l)} · ${this.t(`slot_${item.slot}`, {}, l)} · ${this.t('level', { level: item.minLevel }, l)} · ${inv.bonusText(itemBonus(item), l)}${tags(item)}`,
    );

    const components: ActionRow[] = [];
    if (slice.length)
      components.push([
        {
          type: 'select',
          customId: shopIds.pick(p, owner),
          placeholder: this.t('pick', {}, l),
          options: slice.map(({ item, row }) => ({
            label: this.name(item, l).slice(0, 100),
            value: item.id,
            description:
              `${this.t('price', { price: row.price ?? 0 }, l)} · ${inv.bonusText(itemBonus(item), l)}`.slice(
                0,
                100,
              ),
            default: item.id === picked,
          })),
        },
      ]);
    const chosen = slice.find((x) => x.item.id === picked) ?? stock.find((x) => x.item.id === picked);
    const row: ActionRow = [];
    if (chosen?.row.price != null && !owned.has(chosen.item.id))
      row.push({
        type: 'button',
        customId: shopIds.buy(chosen.item.id, chosen.row.price, owner),
        label: this.t('buy', { item: this.name(chosen.item, l), price: chosen.row.price }, l).slice(0, 80),
        style: 'success',
        disabled: level < chosen.item.minLevel || balance < chosen.row.price,
      });
    if (pages > 1) {
      row.push(
        {
          type: 'button',
          customId: shopIds.page(p - 1, owner),
          label: '◀',
          style: 'secondary',
          disabled: p <= 1,
        },
        {
          type: 'button',
          customId: shopIds.page(p + 1, owner),
          label: '▶',
          style: 'secondary',
          disabled: p >= pages,
        },
      );
    }
    if (row.length) components.push(row);

    return {
      persona: 'jarvis',
      ephemeral: true,
      allowedMentions: { parse: [] },
      ...(notice ? { content: notice } : {}),
      embeds: [
        {
          title: this.t('title', {}, l),
          description: lines.length ? lines.join('\n').slice(0, 4000) : this.t('empty', {}, l),
          footer: {
            text: `${this.t('balance', { balance }, l)}${pages > 1 ? ` · ${this.t('page', { page: p, pages }, l)}` : ''}`,
          },
        },
      ],
      components,
    };
  }

  /** `/loja [pagina]`. */
  async command(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const member = await this.s.trivia.registered(i, r, l);
    if (!member) return;
    if (!this.s.wallet.enabled) return r.reply(this.text(this.t('closed', {}, l)));
    await r.reply(await this.view(member.id, i.userId, l, Number(i.options?.pagina ?? 1)));
  }

  /** `shop:pick:<page>:<owner>`, `shop:page:<page>:<owner>`, `shop:buy:<itemId>:<price>:<owner>`. */
  async component(i: IncomingInteraction, r: Responder, args: string[]): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const [op] = args;
    const owner = args.at(-1);
    if (owner !== i.userId) return r.reply(this.text(this.t('not_yours', {}, l)));
    const member = await this.s.trivia.registered(i, r, l);
    if (!member) return;
    if (!this.s.wallet.enabled) return r.update(this.text(this.t('closed', {}, l)));
    if (op === 'pick')
      return r.update(await this.view(member.id, i.userId, l, Number(args[1]), i.values?.[0]));
    if (op === 'page') return r.update(await this.view(member.id, i.userId, l, Number(args[1])));
    if (op !== 'buy') return r.reply(this.text(this.t('stale', {}, l)));
    const itemId = args[1] ?? '';
    const res = await this.s.inventory.buy(member.id, itemId, Number(args[2]));
    const row = await this.s.items.row(itemId);
    const name = row ? this.name(parseItem(row), l) : itemId;
    const page = this.pageOf(itemId, await this.s.items.all());
    if (res.ok) this.ctx.log.info({ memberId: member.id, itemId, price: res.price }, 'shop purchase');
    return r.update(
      await this.view(member.id, i.userId, l, page, res.ok ? undefined : itemId, this.notice(res, name, l)),
    );
  }

  private pageOf(itemId: string, rows: ItemRow[]): number {
    const idx = shopStock(rows).findIndex((x) => x.item.id === itemId);
    return idx < 0 ? 1 : Math.floor(idx / SHOP_PAGE) + 1;
  }

  private notice(res: BuyResult, item: string, l: Locale): string {
    if (res.ok) return this.t('bought', { item, price: res.price, balance: res.balance }, l);
    switch (res.reason) {
      case 'insufficient':
        return this.t('insufficient', { item, price: res.price, balance: res.balance }, l);
      case 'price_changed':
        return this.t('price_changed', { item, price: res.price }, l);
      case 'level_too_low':
        return this.t('level_too_low', { item, level: res.minLevel }, l);
      default:
        return this.t(res.reason, { item }, l);
    }
  }
}
