import { describe, expect, it } from 'vitest';
import { CanonNameFilter, isCanonName, normalizeName } from './canon.js';

describe('normalizeName', () => {
  it('strips accents, case, punctuation and leet digits', () => {
    expect(normalizeName('  Fênix -- AZUL! ')).toBe('fenix azul');
    expect(normalizeName('W0lv3r1ne')).toBe('wolverine');
  });
});

describe('isCanonName', () => {
  it.each([
    'Wolverine',
    'W0lverine',
    'wolverine',
    'tempestade',
    'TEMPESTADE',
    'Jean  Grey',
    'jean-grey',
    'J.e.a.n Grey',
    'Mística',
    'Ciclope!',
    'Fênix Azul',
    'Wolverinezinho',
    'Homem de Gelo',
    'M4gn3t0',
  ])('rejects %s', (name) => {
    expect(isCanonName(name)).toBe(true);
  });

  it.each(['Faísca', 'Raio Azul', 'Sombra Rubra', 'Vento Norte', 'Ferro Velho', 'Tempes'])(
    'allows %s',
    (name) => {
      expect(isCanonName(name)).toBe(false);
    },
  );

  it('only matches short names as whole words', () => {
    const f = new CanonNameFilter(['Fera']);
    expect(f.isCanon('Fera Azul')).toBe(true);
    expect(f.isCanon('Feral')).toBe(false);
  });
});
