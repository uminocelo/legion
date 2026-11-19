// Item format and validation, with no Node APIs: used by J.A.R.V.I.S. (content files, staff imports),
// `legion content validate` and the website editor, so all of them report the same errors. The canon
// check is passed in (the bots read the list from disk, the editor has it inlined).
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';
import { contentIssue } from './content-issues.js';
import { ITEM_SLOTS, type StatBonus } from './stats.js';

export const ITEM_STATS = ['hp', 'atk', 'def', 'spd', 'foc'] as const;
/** Per-item limits; the total of every equipped item is capped again at fight time (`playerStats`). */
export const ITEM_STAT_MAX = { hp: 16, atk: 2, def: 2, spd: 2, foc: 2 } as const;
export const ITEMS_PER_FILE = 50;

export type ItemText = { 'pt-BR': string; en?: string };

const CANON_MSG = 'nome de personagem existente; use um nome original';

export function createItemSchema(isCanon: (text: string) => boolean) {
  const name = z
    .string()
    .trim()
    .min(1)
    .max(60)
    .refine((n) => !isCanon(n), CANON_MSG);
  const description = z.string().trim().min(1).max(200);
  const stat = (max: number) => z.number().int().min(0).max(max);
  return z
    .object({
      id: z.string().regex(/^[a-z0-9-]{3,48}$/, 'use letras minúsculas, números e "-" (3 a 48)'),
      slot: z.enum(ITEM_SLOTS, { message: `use ${ITEM_SLOTS.join(', ')}` }),
      minLevel: z.number().int().min(1).max(50).default(1),
      name: z.object({ 'pt-BR': name, en: name.optional() }).strict(),
      description: z.object({ 'pt-BR': description, en: description.optional() }).strict().optional(),
      bonus: z
        .object({
          hp: stat(ITEM_STAT_MAX.hp).optional(),
          atk: stat(ITEM_STAT_MAX.atk).optional(),
          def: stat(ITEM_STAT_MAX.def).optional(),
          spd: stat(ITEM_STAT_MAX.spd).optional(),
          foc: stat(ITEM_STAT_MAX.foc).optional(),
        })
        .strict()
        .default({}),
      cosmetic: z.boolean().default(false),
      shop: z
        .object({
          price: z.number().int().min(1).max(100_000),
          order: z.number().int().min(0).max(10_000).optional(),
        })
        .strict()
        .optional(),
      active: z.boolean().optional(),
    })
    .strict()
    .superRefine((item, ctx) => {
      const used = ITEM_STATS.filter((s) => (item.bonus[s] ?? 0) > 0);
      if (item.cosmetic && used.length)
        ctx.addIssue({
          code: 'custom',
          path: ['bonus'],
          message: 'item cosmético não tem bônus; tire o bonus ou use cosmetic: false',
        });
      if (!item.cosmetic && !used.length)
        ctx.addIssue({
          code: 'custom',
          path: ['bonus'],
          message: 'dê algum bônus ao item, ou marque cosmetic: true',
        });
    });
}

export type Item = z.infer<ReturnType<typeof createItemSchema>>;

/** The item's bonus with every stat present (missing = 0). */
export const itemBonus = (item: Pick<Item, 'bonus'>): StatBonus => ({
  hp: item.bonus.hp ?? 0,
  atk: item.bonus.atk ?? 0,
  def: item.bonus.def ?? 0,
  spd: item.bonus.spd ?? 0,
  foc: item.bonus.foc ?? 0,
});

/** Parses a YAML list of items. Errors name the file, item number, id and field, like trivia. */
export function parseItemsYaml(
  text: string,
  name: string,
  isCanon: (text: string) => boolean,
): { items: Item[]; errors: string[] } {
  let raw: unknown;
  try {
    raw = parseYaml(text) ?? [];
  } catch (err) {
    const pos = err instanceof YAMLParseError ? ` (linha ${err.linePos?.[0]?.line ?? 0})` : '';
    return { items: [], errors: [`${name}${pos}: YAML inválido: ${(err as Error).message.split('\n')[0]}`] };
  }
  if (!Array.isArray(raw))
    return { items: [], errors: [`${name}: o arquivo deve ser uma lista de itens (- id: ...)`] };
  if (raw.length > ITEMS_PER_FILE)
    return { items: [], errors: [`${name}: itens demais (máximo ${ITEMS_PER_FILE} por arquivo)`] };
  const schema = createItemSchema(isCanon);
  const items: Item[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, i) => {
    const id = (entry as { id?: unknown })?.id;
    const label = `${name} → item ${i + 1}${typeof id === 'string' ? ` (${id})` : ''}`;
    const res = schema.safeParse(entry);
    if (!res.success) {
      for (const issue of res.error.issues)
        errors.push(`${label} → ${issue.path.join('.') || 'item'}: ${contentIssue(issue)}`);
      return;
    }
    if (seen.has(res.data.id)) {
      errors.push(`${label} → id: "${res.data.id}" repetido no mesmo arquivo`);
      return;
    }
    seen.add(res.data.id);
    items.push(res.data);
  });
  return { items, errors };
}
