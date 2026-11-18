// Browser stand-in for `@legion/core` in the editor bundle: only what the shared validation modules use.
// The canon list is the bots' own file, inlined at build time, so names are refused exactly like on import.
import canonList from '../../packages/core/data/canon-names.txt';
import { CanonNameFilter, parseCanonList } from '../../packages/core/src/game/canon-filter.js';

const filter = new CanonNameFilter(parseCanonList(canonList));

export { contentIssue, contentIssues } from '../../packages/core/src/game/content-issues.js';
export { ORIGINS } from '../../packages/core/src/game/origins.js';

export const isCanonName = (text: string): boolean => filter.isCanon(text);
export const LOCALES = ['pt-BR', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
