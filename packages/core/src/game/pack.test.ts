import { describe, expect, it } from 'vitest';
import { isCanonName } from './canon.js';
import { compareSemver, looksLikePack, PACK_ITEMS_MAX, PACK_TRIVIA_MAX, parsePackDocument } from './pack.js';

const parse = (raw: unknown) => parsePackDocument(raw, isCanonName);

const item = (id: string) => ({
  id,
  slot: 'traje',
  name: { 'pt-BR': `Item ${id}` },
  bonus: { def: 1 },
});

const base = {
  id: 'meu-pack',
  name: { 'pt-BR': 'Meu pacote', en: 'My pack' },
  version: '1.2.0',
  author: 'Staff Name',
};

describe('parsePackDocument', () => {
  it('accepts a pack with all four content sections', () => {
    const r = parse({
      ...base,
      trivia: [{ id: 'q1' }],
      missions: [{ id: 'm1' }],
      enemies: [{ id: 'e1' }],
      items: [item('capa-leve')],
    });
    expect(r.errors).toEqual([]);
    expect(r.pack).toMatchObject({
      id: 'meu-pack',
      version: '1.2.0',
      author: 'Staff Name',
      items: [{ id: 'capa-leve' }],
    });
    expect(r.pack.trivia).toHaveLength(1);
    expect(r.pack.missions).toHaveLength(1);
    expect(r.pack.enemies).toHaveLength(1);
  });

  it('rejects missing fields, bad semver and empty packs', () => {
    expect(parse({}).errors.join('\n')).toMatch(/id|name|version|author/);
    expect(parse({ ...base, version: '1.2' }).errors.join('\n')).toMatch(/semver/);
    expect(parse({ ...base }).errors.join('\n')).toMatch(/pacote vazio/);
    expect(parse({ ...base, trivia: [], items: [] }).errors.join('\n')).toMatch(/pacote vazio/);
  });

  it('rejects a non-object document', () => {
    expect(parse([]).errors[0]).toMatch(/objeto de pacote/);
    expect(parse('x').errors[0]).toMatch(/objeto de pacote/);
  });

  it('validates nested items with the item rules', () => {
    const r = parse({
      ...base,
      items: [
        item('ok-item'),
        { id: 'bad', slot: 'capa', name: { 'pt-BR': 'Wolverine' }, bonus: { atk: 5 } },
      ],
    });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.some((e) => e.includes('items') && e.includes('nome de personagem'))).toBe(true);
    expect(r.errors.some((e) => e.includes('bonus.atk'))).toBe(true);
  });

  it('caps trivia and items per pack', () => {
    const trivia = Array.from({ length: PACK_TRIVIA_MAX + 1 }, (_, i) => ({ id: `q${i}` }));
    expect(parse({ ...base, trivia }).errors.join('\n')).toMatch(/perguntas demais/);
    const items = Array.from({ length: PACK_ITEMS_MAX + 1 }, (_, i) => item(`item-${i}`));
    expect(parse({ ...base, items }).errors.join('\n')).toMatch(/itens demais/);
  });

  it('rejects a bad pack id', () => {
    expect(parse({ ...base, id: 'AB', items: [item('a')] }).errors.join('\n')).toMatch(/id/);
  });
});

describe('compareSemver / looksLikePack', () => {
  it('orders versions', () => {
    expect(compareSemver('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareSemver('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.0-beta', '1.0.0')).toBeLessThan(0);
  });

  it('detects pack-shaped documents', () => {
    expect(looksLikePack({ ...base, items: [] })).toBe(true);
    expect(looksLikePack({ id: 'm', scenes: {} })).toBe(false);
    expect(looksLikePack([{ id: 'q' }])).toBe(false);
  });
});
