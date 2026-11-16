import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FakeRandomSource, mulberry32 } from './random.js';

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(mulberry32(124).next()).not.toBe(seqA[0]);
  });

  it('matches the reference first value for seed 1', () => {
    // Reference value of the canonical mulberry32 implementation.
    expect(mulberry32(1).next()).toBeCloseTo(0.6270739405881613, 15);
  });

  it('d(n) always lands in 1..n', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), fc.integer({ min: 1, max: 1000 }), (seed, n) => {
        const rng = mulberry32(seed);
        for (let i = 0; i < 50; i++) {
          const r = rng.d(n);
          if (!Number.isInteger(r) || r < 1 || r > n) return false;
        }
        return true;
      }),
    );
  });

  it('rejects invalid dice', () => {
    expect(() => mulberry32(1).d(0)).toThrow(RangeError);
  });

  it('FakeRandomSource yields a repeatable seed sequence', () => {
    const a = new FakeRandomSource(7);
    const b = new FakeRandomSource(7);
    expect([a.seed(), a.seed()]).toEqual([b.seed(), b.seed()]);
  });
});
