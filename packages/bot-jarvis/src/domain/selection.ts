import type { Rng } from '@legion/core';

export interface Candidate {
  id: string;
}

/**
 * Picks a question: one not seen in the last `noRepeatDays`; if none, the least recently seen.
 * Deterministic for a given rng seed.
 */
export function pickQuestion<T extends Candidate>(
  candidates: readonly T[],
  lastSeen: ReadonlyMap<string, string>,
  now: Date,
  noRepeatDays: number,
  rng: Rng,
): T | null {
  if (!candidates.length) return null;
  const cutoff = new Date(now.getTime() - noRepeatDays * 86_400_000).toISOString();
  const fresh = candidates.filter((c) => {
    const seen = lastSeen.get(c.id);
    return !seen || seen < cutoff;
  });
  if (fresh.length) return fresh[Math.floor(rng.next() * fresh.length)] ?? null;
  // Everything was seen recently: the least recently seen (ties broken by id order).
  return (
    [...candidates].sort((a, b) => (lastSeen.get(a.id) ?? '').localeCompare(lastSeen.get(b.id) ?? ''))[0] ??
    null
  );
}

/** Fisher–Yates order of `n` original indexes. */
export function shuffledOrder(n: number, rng: Rng): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return order;
}
