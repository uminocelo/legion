import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

/** Lowercase, strip accents, map leet digits, turn punctuation into spaces, collapse spaces. */
export function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[013457@$]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const compact = (s: string) => s.replace(/ /g, '');

/** Minimum length for a canon name to be matched inside a longer word ("wolverinezinho"). */
const MIN_INFIX_LEN = 6;

export class CanonNameFilter {
  private readonly names: { spaced: string; compact: string }[];

  constructor(names: readonly string[]) {
    const seen = new Set<string>();
    this.names = [];
    for (const raw of names) {
      const spaced = normalizeName(raw);
      if (!spaced || seen.has(spaced)) continue;
      seen.add(spaced);
      this.names.push({ spaced, compact: compact(spaced) });
    }
  }

  /** The matched canon name (normalized), or null. */
  match(text: string): string | null {
    const spaced = normalizeName(text);
    if (!spaced) return null;
    const padded = ` ${spaced} `;
    const flat = compact(spaced);
    for (const n of this.names) {
      if (flat === n.compact) return n.spaced;
      if (padded.includes(` ${n.spaced} `)) return n.spaced;
      if (n.compact.length >= MIN_INFIX_LEN && flat.includes(n.compact)) return n.spaced;
    }
    return null;
  }

  isCanon(text: string): boolean {
    return this.match(text) !== null;
  }
}

export function parseCanonList(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

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
