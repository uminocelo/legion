// Pure canon-name matching (no Node APIs), shared by the bots and the website editors.

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

/**
 * A list entry starting with `=` matches only the whole name ("=Nova" refuses "Nova" but allows
 * "Estrela Nova"): for canon names that are also common words.
 */
export const EXACT_PREFIX = '=';

export class CanonNameFilter {
  private readonly names: { spaced: string; compact: string; exact: boolean }[];

  constructor(names: readonly string[]) {
    const seen = new Set<string>();
    this.names = [];
    for (const raw of names) {
      const exact = raw.startsWith(EXACT_PREFIX);
      const spaced = normalizeName(exact ? raw.slice(EXACT_PREFIX.length) : raw);
      if (!spaced || seen.has(spaced)) continue;
      seen.add(spaced);
      this.names.push({ spaced, compact: compact(spaced), exact });
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
      if (n.exact) continue;
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
