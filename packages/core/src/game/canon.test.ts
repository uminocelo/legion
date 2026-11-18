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

describe('the wider Marvel universe (ADR 0030)', () => {
  it.each([
    'Homem de Ferro',
    'Iron Man',
    'Capitão América',
    'Tocha Humana',
    'Senhor Fantástico',
    'Senhor das Estrelas',
    'Vingadores',
    'Avengers do Norte',
    'Quarteto Fantástico',
    'Guardiões da Galáxia',
    'Thunderbolts',
    'Filhos da Meia-Noite',
    'S.H.I.E.L.D.',
    'Visão',
    'Nova',
    'Coisa',
    'Hidra',
    'Barão Zemo',
    'Raio Negro',
    'Doutor Octopus',
  ])('rejects %s', (name) => {
    expect(isCanonName(name)).toBe(true);
  });

  it('an "=" entry only matches the whole name', () => {
    const f = new CanonNameFilter(['=Nova', 'Fera']);
    expect(f.isCanon('Nova')).toBe(true);
    expect(f.isCanon('N0va')).toBe(true);
    expect(f.isCanon('Estrela Nova')).toBe(false);
    expect(f.isCanon('Novata')).toBe(false);
    expect(f.isCanon('Fera Azul')).toBe(true);
  });

  it('keeps common words and look-alikes usable', () => {
    for (const n of [
      'Visionário',
      'Feral',
      'Estrela Nova',
      'Tocha Azul',
      'Falcão Cinzento',
      'Vespa Rubra',
      'Coisa Ruim',
    ])
      expect(isCanonName(n), n).toBe(false);
  });

  it('accepts 50 original codenames', () => {
    const originals = [
      'Faísca',
      'Raio Azul',
      'Sombra Rubra',
      'Vento Norte',
      'Ferro Velho',
      'Brasa',
      'Pulso',
      'Maré Alta',
      'Eco',
      'Prisma',
      'Granito',
      'Nevasca',
      'Cobalto',
      'Zênite',
      'Aurora Boreal',
      'Lâmina Fria',
      'Trovão Manso',
      'Corvo Cinzento',
      'Lince Dourado',
      'Quimera',
      'Sinapse',
      'Vórtice',
      'Âncora',
      'Mosaico',
      'Relâmpago Verde',
      'Penumbra',
      'Ônix',
      'Cerração',
      'Fagulha',
      'Bússola',
      'Neblina',
      'Estilhaço',
      'Magnésio',
      'Orvalho',
      'Tufão',
      'Silício',
      'Carbono',
      'Hélio',
      'Gárgula de Pedra',
      'Pantera Cinza',
      'Escudo Rubro',
      'Arqueira do Sul',
      'Doutor Volt',
      'Capitão Aurora',
      'Senhora Brisa',
      'Homem de Vidro',
      'Mulher Faísca',
      'Patrulheiro',
      'Sentinela Azul',
      'Estrela Cadente',
    ];
    expect(originals).toHaveLength(50);
    const refused = originals.filter((n) => isCanonName(n));
    expect(refused).toEqual([]);
  });
});
