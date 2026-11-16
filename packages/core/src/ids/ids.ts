import { monotonicFactory } from 'ulid';
import type { Clock } from '../time/clock.js';

/** ULID generator driven by the injected clock (monotonic within the same millisecond). */
export function createIdGenerator(clock: Clock): () => string {
  const next = monotonicFactory();
  return () => next(clock.now().getTime());
}
