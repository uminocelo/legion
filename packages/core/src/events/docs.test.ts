import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EVENT_TYPES } from './catalog.js';

describe('docs/EVENTS.md', () => {
  it('documents every event in the catalog', () => {
    const doc = readFileSync(fileURLToPath(new URL('../../../../docs/EVENTS.md', import.meta.url)), 'utf8');
    expect(EVENT_TYPES.filter((t) => !doc.includes(`\`${t}\``))).toEqual([]);
  });
});
