import type { Clock } from '../time/clock.js';

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the current window resets (0 when allowed). */
  retryAfterMs: number;
}

/** Fixed-window rate limiter. Core ships an in-memory default; Sentinel provides a DB-backed one (v3). */
export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly clock: Clock) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = this.clock.now().getTime();
    const start = now - (now % windowMs);
    const id = `${key}|${windowMs}`;
    const w = this.windows.get(id);
    const current = w && w.start === start ? w : { start, count: 0 };
    if (current.count >= limit) return { allowed: false, retryAfterMs: start + windowMs - now };
    current.count++;
    this.windows.set(id, current);
    if (this.windows.size > 10_000) this.prune(start);
    return { allowed: true, retryAfterMs: 0 };
  }

  private prune(currentStart: number): void {
    for (const [k, v] of this.windows) if (v.start < currentStart) this.windows.delete(k);
  }
}
