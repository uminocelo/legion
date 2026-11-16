import * as core from '@legion/core';
import { describe, expect, it } from 'vitest';

describe('core package', () => {
  it('exports its public API', () => {
    expect(typeof core.computePlayerStats).toBe('function');
    expect(typeof core.parseConfig).toBe('function');
  });
});
