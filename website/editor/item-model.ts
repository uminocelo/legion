// J.A.R.V.I.S. item drafts ↔ YAML, validated by the bots' own parser (`/jarvis item importar`).
import { ITEM_SLOTS, ITEM_STAT_MAX, ITEM_STATS, isCanonName, parseItemsYaml } from '@legion/core';
import { parse, stringify } from 'yaml';

export { ITEM_SLOTS, ITEM_STAT_MAX, ITEM_STATS };
export const ITEM_FILE = 'itens.yaml';
export type ItemStat = (typeof ITEM_STATS)[number];

export interface ItemDraft {
  id: string;
  slot: string;
  minLevel: number;
  namePt: string;
  nameEn: string;
  descPt: string;
  descEn: string;
  bonus: Record<ItemStat, number>;
  cosmetic: boolean;
  forSale: boolean;
  price: number;
  /** NaN = no order (sorted by level, then id). */
  order: number;
  /** `active: false` kept from an opened file. */
  inactive: boolean;
}

const ZERO = (): Record<ItemStat, number> => ({ hp: 0, atk: 0, def: 0, spd: 0, foc: 0 });

export const emptyItem = (drafts: readonly ItemDraft[]): ItemDraft => {
  const used = new Set(drafts.map((d) => d.id));
  let n = drafts.length + 1;
  while (used.has(`item-${n}`)) n++;
  return {
    id: `item-${n}`,
    slot: 'acessorio',
    minLevel: 1,
    namePt: '',
    nameEn: '',
    descPt: '',
    descEn: '',
    bonus: { ...ZERO(), atk: 1 },
    cosmetic: false,
    forSale: true,
    price: 100,
    order: Number.NaN,
    inactive: false,
  };
};

const text = (pt: string, en: string) => ({ 'pt-BR': pt.trim(), ...(en.trim() ? { en: en.trim() } : {}) });

/** The items in the file's key order; empty optional fields are left out. */
export function toItems(drafts: readonly ItemDraft[]) {
  return drafts.map((d) => {
    const bonus = Object.fromEntries(ITEM_STATS.filter((s) => d.bonus[s] !== 0).map((s) => [s, d.bonus[s]]));
    return {
      id: d.id.trim(),
      slot: d.slot,
      minLevel: d.minLevel,
      name: text(d.namePt, d.nameEn),
      ...(d.descPt.trim() || d.descEn.trim() ? { description: text(d.descPt, d.descEn) } : {}),
      ...(d.cosmetic ? { cosmetic: true } : {}),
      ...(Object.keys(bonus).length || !d.cosmetic ? { bonus } : {}),
      ...(d.forSale
        ? { shop: { price: d.price, ...(Number.isFinite(d.order) ? { order: d.order } : {}) } }
        : {}),
      ...(d.inactive ? { active: false } : {}),
    };
  });
}

export function toYaml(drafts: readonly ItemDraft[]): string {
  const header =
    '# Itens do J.A.R.V.I.S. (nomes originais). Importe com /jarvis item importar (anexe este arquivo)\n' +
    '# ou coloque em data/content/items/ e reinicie.\n';
  return header + stringify(toItems(drafts));
}

/** The bot's errors, plus ids of the shipped items (the bot refuses those on import). */
export function validate(yaml: string, shippedIds: readonly string[] = []): string[] {
  const res = parseItemsYaml(yaml, ITEM_FILE, isCanonName);
  if (!res.errors.length && !res.items.length) return [`${ITEM_FILE}: nenhum item no arquivo`];
  const shipped = new Set(shippedIds);
  return [
    ...res.errors,
    ...res.items
      .filter((i) => shipped.has(i.id))
      .map(
        (i) =>
          `${ITEM_FILE} → ${i.id}: id de um item dos arquivos (enviado com o Legion ou da pasta data); use outro id`,
      ),
  ];
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export function fromYaml(src: string): ItemDraft[] {
  const raw = parse(src);
  if (!Array.isArray(raw)) throw new Error('o arquivo deve ser uma lista de itens (- id: ...)');
  return raw.map((entry: unknown) => {
    const x = obj(entry);
    const name = obj(x.name);
    const desc = obj(x.description);
    const bonus = obj(x.bonus);
    const shop = x.shop && typeof x.shop === 'object' ? obj(x.shop) : null;
    return {
      id: str(x.id),
      slot: typeof x.slot === 'string' ? x.slot : 'acessorio',
      minLevel: num(x.minLevel, 1),
      namePt: str(name['pt-BR']),
      nameEn: str(name.en),
      descPt: str(desc['pt-BR']),
      descEn: str(desc.en),
      bonus: Object.fromEntries(ITEM_STATS.map((s) => [s, num(bonus[s], 0)])) as Record<ItemStat, number>,
      cosmetic: x.cosmetic === true,
      forSale: shop !== null,
      price: num(shop?.price, 100),
      order: num(shop?.order, Number.NaN),
      inactive: x.active === false,
    };
  });
}
