/** Source of the current time. Inject everywhere; never call Date.now() in game code. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Controllable clock for tests. */
export class FakeClock implements Clock {
  private current: number;
  constructor(start: Date | string = '2026-01-01T12:00:00.000Z') {
    this.current = new Date(start).getTime();
  }
  now(): Date {
    return new Date(this.current);
  }
  set(at: Date | string): void {
    this.current = new Date(at).getTime();
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

export const toIso = (d: Date): string => d.toISOString();
