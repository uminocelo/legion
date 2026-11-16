import { checkParity, readLocaleDir } from '@legion/core';
import { describe, expect, it } from 'vitest';
import { CEREBRO_LOCALES_DIR } from '../src/paths.js';

describe('cerebro locales', () => {
  it('en has every pt-BR key with the same placeholders', () => {
    const { 'pt-BR': pt, en } = readLocaleDir(CEREBRO_LOCALES_DIR);
    expect(checkParity(pt ?? {}, en ?? {})).toEqual({ missing: [], extra: [], placeholderMismatch: [] });
  });
});
