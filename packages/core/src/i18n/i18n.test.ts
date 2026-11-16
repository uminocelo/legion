import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CORE_LOCALES_DIR } from '../paths.js';
import { checkParity, flatten, I18n, readLocaleDir } from './i18n.js';

describe('I18n', () => {
  const make = () => {
    const warn = vi.fn();
    const i18n = new I18n('pt-BR', { warn });
    i18n.add('pt-BR', flatten({ a: { hi: 'Olá {name}' }, only: 'só pt' }));
    i18n.add('pt-BR', { 'a.items_one': '{count} item', 'a.items_other': '{count} itens' });
    i18n.add('en', { 'a.hi': 'Hi {name}', 'a.items_one': '{count} item', 'a.items_other': '{count} items' });
    return { i18n, warn };
  };

  it('interpolates and picks the locale', () => {
    const { i18n } = make();
    expect(i18n.t('a.hi', { name: 'Ana' })).toBe('Olá Ana');
    expect(i18n.t('a.hi', { name: 'Ana' }, 'en')).toBe('Hi Ana');
  });

  it('handles plurals', () => {
    const { i18n } = make();
    expect(i18n.t('a.items', { count: 1 })).toBe('1 item');
    expect(i18n.t('a.items', { count: 3 })).toBe('3 itens');
    expect(i18n.t('a.items', { count: 3 }, 'en')).toBe('3 items');
  });

  it('falls back to pt-BR, then to the key with one warning', () => {
    const { i18n, warn } = make();
    expect(i18n.t('only', {}, 'en')).toBe('só pt');
    expect(i18n.t('nope')).toBe('nope');
    i18n.t('nope');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('lets owner overrides win', () => {
    const { i18n } = make();
    const dir = mkdtempSync(join(tmpdir(), 'legion-i18n-'));
    writeFileSync(join(dir, 'pt-BR.json'), JSON.stringify({ a: { hi: 'E aí {name}' } }));
    i18n.addDir(dir);
    expect(i18n.t('a.hi', { name: 'Ana' })).toBe('E aí Ana');
  });

  it('uses the locale resolver for members', async () => {
    const { i18n } = make();
    expect(await i18n.localeFor('1')).toBe('pt-BR');
    i18n.setResolver(async (id) => (id === '1' ? 'en' : null));
    expect(await i18n.localeFor('1')).toBe('en');
    expect(await i18n.localeFor('2')).toBe('pt-BR');
  });
});

describe('checkParity', () => {
  it('reports missing keys and placeholder mismatches', () => {
    const r = checkParity({ a: '{x}', b: 'y', c: 'z' }, { a: '{y}', b: 'y', d: 'w' });
    expect(r).toEqual({ missing: ['c'], extra: ['d'], placeholderMismatch: ['a'] });
  });

  it('core locales are in parity', () => {
    const { 'pt-BR': pt, en } = readLocaleDir(CORE_LOCALES_DIR);
    expect(pt).toBeDefined();
    expect(checkParity(pt ?? {}, en ?? {})).toEqual({ missing: [], extra: [], placeholderMismatch: [] });
  });
});
