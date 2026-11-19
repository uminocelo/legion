import { describe, expect, it } from 'vitest';
import { isCanonName, itemSchema } from './canon.js';
import { createItemSchema, ITEMS_PER_FILE, itemBonus, parseItemsYaml } from './item.js';

const ok = {
  id: 'traje-tatico',
  slot: 'traje',
  minLevel: 2,
  name: { 'pt-BR': 'Traje tático', en: 'Tactical suit' },
  description: { 'pt-BR': 'Tecido reforçado.', en: 'Reinforced fabric.' },
  bonus: { def: 1, hp: 8 },
  shop: { price: 120, order: 10 },
};
const errorsOf = (item: unknown) => {
  const r = itemSchema.safeParse(item);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};
const parse = (yaml: string) => parseItemsYaml(yaml, 'itens.yaml', isCanonName);

describe('item schema', () => {
  it('accepts a full item and fills the defaults', () => {
    const r = itemSchema.parse({
      id: 'oculos-de-campo',
      slot: 'acessorio',
      name: { 'pt-BR': 'Óculos' },
      bonus: { foc: 1 },
    });
    expect(r).toMatchObject({ minLevel: 1, cosmetic: false });
    expect(itemSchema.parse(ok).shop).toEqual({ price: 120, order: 10 });
    expect(itemBonus(itemSchema.parse(ok))).toEqual({ hp: 8, atk: 0, def: 1, spd: 0, foc: 0 });
  });

  it('checks the id, slot and level', () => {
    expect(errorsOf({ ...ok, id: 'Traje Tático' })[0]).toMatch(/^id: use letras minúsculas/);
    expect(errorsOf({ ...ok, id: 'ab' })[0]).toMatch(/^id:/);
    expect(errorsOf({ ...ok, slot: 'capa' })[0]).toMatch(/^slot: use traje, acessorio, dispositivo/);
    expect(errorsOf({ ...ok, minLevel: 0 })[0]).toMatch(/^minLevel:/);
    expect(errorsOf({ ...ok, minLevel: 51 })[0]).toMatch(/^minLevel:/);
  });

  it('refuses canon names, in every language', () => {
    expect(errorsOf({ ...ok, name: { 'pt-BR': 'Escudo do Capitão América' } })).toContain(
      'name.pt-BR: nome de personagem existente; use um nome original',
    );
    expect(errorsOf({ ...ok, name: { 'pt-BR': 'Traje', en: 'Wolverine claws' } })[0]).toMatch(/^name.en:/);
    expect(errorsOf({ ...ok, name: { 'pt-BR': '' } })[0]).toMatch(/^name.pt-BR:/);
  });

  it('limits each stat per item and the description', () => {
    expect(errorsOf({ ...ok, bonus: { atk: 3 } })[0]).toMatch(/^bonus.atk:/);
    expect(errorsOf({ ...ok, bonus: { hp: 17 } })[0]).toMatch(/^bonus.hp:/);
    expect(errorsOf({ ...ok, bonus: { def: -1 } })[0]).toMatch(/^bonus.def:/);
    expect(errorsOf({ ...ok, bonus: { def: 1.5 } })[0]).toMatch(/^bonus.def:/);
    expect(errorsOf({ ...ok, bonus: { luck: 1 } })[0]).toMatch(/^bonus:/);
    expect(errorsOf({ ...ok, description: { 'pt-BR': 'x'.repeat(201) } })[0]).toMatch(/^description.pt-BR:/);
  });

  it('cosmetic items have no bonus; other items need one', () => {
    expect(errorsOf({ ...ok, cosmetic: true })).toContain(
      'bonus: item cosmético não tem bônus; tire o bonus ou use cosmetic: false',
    );
    expect(errorsOf({ ...ok, cosmetic: true, bonus: {} })).toEqual([]);
    expect(errorsOf({ ...ok, bonus: {} })[0]).toMatch(/^bonus: dê algum bônus/);
  });

  it('checks the shop price', () => {
    expect(errorsOf({ ...ok, shop: { price: 0 } })[0]).toMatch(/^shop.price:/);
    expect(errorsOf({ ...ok, shop: { price: 100_001 } })[0]).toMatch(/^shop.price:/);
    expect(errorsOf({ ...ok, shop: { price: 10, extra: 1 } })[0]).toMatch(/^shop:/);
  });

  it('takes the canon check it is given (the website binds its own list)', () => {
    const lax = createItemSchema(() => false);
    expect(lax.safeParse({ ...ok, name: { 'pt-BR': 'Magneto' } }).success).toBe(true);
  });
});

describe('parseItemsYaml', () => {
  it('lists every problem with item number, id and field in pt-BR', () => {
    const r = parse(`
- id: traje-tatico
  slot: traje
  name: { pt-BR: Traje tático }
  bonus: { def: 1 }
- id: traje-tatico
  slot: traje
  name: { pt-BR: Outro }
  bonus: { def: 1 }
- id: x
  slot: capa
  name: { pt-BR: Magneto }
  bonus: { atk: 5 }
`);
    expect(r.items.map((i) => i.id)).toEqual(['traje-tatico']);
    expect(r.errors).toContain(
      'itens.yaml → item 2 (traje-tatico) → id: "traje-tatico" repetido no mesmo arquivo',
    );
    expect(
      r.errors
        .filter((e) => e.startsWith('itens.yaml → item 3 (x)'))
        .map((e) => e.split(' → ')[2]?.split(':')[0]),
    ).toEqual(['id', 'slot', 'name.pt-BR', 'bonus.atk']);
    expect(r.errors.find((e) => e.includes('bonus.atk'))).toMatch(/muito grande \(máximo 2\)/);
  });

  it('refuses broken YAML, a non-list and too many items', () => {
    expect(parse('- id: [').errors[0]).toMatch(/^itens.yaml \(linha \d+\): YAML inválido/);
    expect(parse('id: x').errors).toEqual(['itens.yaml: o arquivo deve ser uma lista de itens (- id: ...)']);
    const many = Array.from(
      { length: ITEMS_PER_FILE + 1 },
      (_, i) => `- { id: item-${i}, slot: traje, name: { pt-BR: Item }, bonus: { hp: 1 } }`,
    ).join('\n');
    expect(parse(many).errors).toEqual([`itens.yaml: itens demais (máximo ${ITEMS_PER_FILE} por arquivo)`]);
    expect(parse('').items).toEqual([]);
  });
});
