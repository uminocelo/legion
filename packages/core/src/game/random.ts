import { randomInt } from 'node:crypto';

/** A seeded pseudo-random generator. */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Die roll in 1..n. */
  d(n: number): number;
}

/** mulberry32: small, fast, deterministic uint32-seeded PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    d: (n: number) => {
      if (!Number.isInteger(n) || n < 1) throw new RangeError(`d(n) needs a positive integer, got ${n}`);
      return 1 + Math.floor(next() * n);
    },
  };
}

/** Injected randomness: crypto seeds, deterministic generators. */
export interface RandomSource {
  /** New uint32 seed. */
  seed(): number;
  create(seed: number): Rng;
}

export const cryptoRandomSource: RandomSource = {
  seed: () => randomInt(0, 2 ** 32 - 1),
  create: mulberry32,
};

/** Deterministic random source for tests: seeds come from a fixed sequence. */
export class FakeRandomSource implements RandomSource {
  private readonly seeds: Rng;
  constructor(base = 42) {
    this.seeds = mulberry32(base);
  }
  seed(): number {
    return Math.floor(this.seeds.next() * 2 ** 32) >>> 0;
  }
  create(seed: number): Rng {
    return mulberry32(seed);
  }
}
