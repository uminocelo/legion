import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CanonNameFilter, parseCanonList } from './canon-filter.js';

export { CanonNameFilter, normalizeName, parseCanonList } from './canon-filter.js';

const DEFAULT_LIST_PATH = fileURLToPath(new URL('../../data/canon-names.txt', import.meta.url));
let defaultFilter: CanonNameFilter | undefined;

export function getCanonFilter(): CanonNameFilter {
  defaultFilter ??= new CanonNameFilter(parseCanonList(readFileSync(DEFAULT_LIST_PATH, 'utf8')));
  return defaultFilter;
}

/** True when `text` is or contains a canon Marvel name. */
export function isCanonName(text: string): boolean {
  return getCanonFilter().isCanon(text);
}

/** The item schema with the bots' canon list (the website editor binds its own copy of the list). */
import { createItemSchema } from './item.js';

export const itemSchema = createItemSchema(isCanonName);
