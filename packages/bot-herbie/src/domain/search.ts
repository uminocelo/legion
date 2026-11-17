import { fold } from '../content.js';

export interface Searchable {
  id: string;
  term: string;
  aliases: string[];
}

/** Accent-insensitive prefix matches first, then "contains" matches, on terms and aliases (max `limit`). */
export function searchGlossary<T extends Searchable>(entries: readonly T[], query: string, limit = 25): T[] {
  const q = fold(query);
  if (!q) return entries.slice(0, limit);
  const names = (e: T) => [e.term, ...e.aliases].map(fold);
  const prefix = entries.filter((e) =>
    names(e).some((n) => n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q))),
  );
  const contains = entries.filter((e) => !prefix.includes(e) && names(e).some((n) => n.includes(q)));
  return [...prefix, ...contains].slice(0, limit);
}

/** Next tip: the first one not posted in the current cycle; a new cycle starts when all were used. */
export function nextTip<T extends { id: string }>(
  tips: readonly T[],
  log: readonly { tipId: string; cycle: number }[],
): { tip: T; cycle: number } | null {
  if (!tips.length) return null;
  const cycle = log.reduce((m, l) => Math.max(m, l.cycle), 1);
  const used = new Set(log.filter((l) => l.cycle === cycle).map((l) => l.tipId));
  const tip = tips.find((t) => !used.has(t.id));
  if (tip) return { tip, cycle };
  const first = tips[0];
  return first ? { tip: first, cycle: cycle + 1 } : null;
}
