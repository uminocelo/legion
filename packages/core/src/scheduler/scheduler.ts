import { CronExpressionParser } from 'cron-parser';
import { and, asc, eq, lte } from 'drizzle-orm';
import type { Logger } from 'pino';
import { coreTables } from '../db/core-tables.js';
import type { Executor, LegionDb } from '../db/db.js';
import type { Clock } from '../time/clock.js';

export const RETRY_BACKOFF_MS = [1_000, 5_000, 30_000, 120_000, 600_000] as const;
export const backoffFor = (attempt: number): number =>
  RETRY_BACKOFF_MS[Math.min(Math.max(attempt, 1), RETRY_BACKOFF_MS.length) - 1] ?? 600_000;

export interface JobInfo {
  id: string;
  name: string;
  attempts: number;
  runAt: string;
}
export type JobHandler<P = unknown> = (payload: P, job: JobInfo) => Promise<void>;

export interface EnqueueOptions {
  runAt?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
}

export interface Scheduler {
  define<P>(name: string, handler: JobHandler<P>): void;
  /** Returns the job id, or null when a job with the same dedupeKey already exists. */
  enqueue(name: string, payload: unknown, opts?: EnqueueOptions, ex?: Executor): Promise<string | null>;
  cancel(dedupeKey: string, ex?: Executor): Promise<boolean>;
  every(name: string, cron: string, handler: () => Promise<void>): void;
}

export interface DbSchedulerOptions {
  db: LegionDb;
  clock: Clock;
  timezone: string;
  newId: () => string;
  log: Logger;
  pollIntervalMs?: number;
  lockMs?: number;
  batchSize?: number;
}

/** DB-backed job scheduler (main prompt §8). Jobs must be idempotent. */
export class DbScheduler implements Scheduler {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly recurring = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;

  constructor(private readonly o: DbSchedulerOptions) {}

  private get t() {
    return coreTables(this.o.db).coreScheduledJobs;
  }

  define<P>(name: string, handler: JobHandler<P>): void {
    if (this.handlers.has(name)) throw new Error(`Job "${name}" is already defined`);
    this.handlers.set(name, handler as JobHandler);
  }

  async enqueue(
    name: string,
    payload: unknown,
    opts: EnqueueOptions = {},
    ex: Executor = this.o.db.orm,
  ): Promise<string | null> {
    const now = this.o.clock.now().toISOString();
    const id = this.o.newId();
    const rows = await ex
      .insert(this.t)
      .values({
        id,
        name,
        runAt: (opts.runAt ?? this.o.clock.now()).toISOString(),
        payload: JSON.stringify(payload ?? null),
        status: 'pending',
        attempts: 0,
        maxAttempts: opts.maxAttempts ?? 5,
        dedupeKey: opts.dedupeKey ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: this.t.id });
    return rows[0]?.id ?? null;
  }

  async cancel(dedupeKey: string, ex: Executor = this.o.db.orm): Promise<boolean> {
    const rows = await ex
      .update(this.t)
      .set({ status: 'cancelled', updatedAt: this.o.clock.now().toISOString() })
      .where(and(eq(this.t.dedupeKey, dedupeKey), eq(this.t.status, 'pending')))
      .returning({ id: this.t.id });
    return rows.length > 0;
  }

  every(name: string, cron: string, handler: () => Promise<void>): void {
    this.nextRun(cron, this.o.clock.now()); // validate early
    this.recurring.set(name, cron);
    this.define(name, async () => {
      await handler();
      await this.scheduleNext(name);
    });
  }

  nextRun(cron: string, after: Date): Date {
    return CronExpressionParser.parse(cron, { currentDate: after, tz: this.o.timezone }).next().toDate();
  }

  private async scheduleNext(name: string): Promise<void> {
    const cron = this.recurring.get(name);
    if (!cron) return;
    const runAt = this.nextRun(cron, this.o.clock.now());
    await this.enqueue(name, null, { runAt, dedupeKey: `${name}:${runAt.toISOString()}` });
  }

  /** Makes sure every recurring job has its next run enqueued. Safe to call on every boot. */
  async ensureRecurring(): Promise<void> {
    for (const name of this.recurring.keys()) await this.scheduleNext(name);
  }

  /** Claims and runs due jobs once. Returns how many jobs ran. */
  async tick(): Promise<number> {
    const t = this.t;
    const now = this.o.clock.now();
    const nowIso = now.toISOString();
    // Jobs whose lock expired (process crashed mid-run) go back to pending.
    await this.o.db.orm
      .update(t)
      .set({ status: 'pending', lockedUntil: null, updatedAt: nowIso })
      .where(and(eq(t.status, 'running'), lte(t.lockedUntil, nowIso)));

    const due = await this.o.db.orm
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.status, 'pending'), lte(t.runAt, nowIso)))
      .orderBy(asc(t.runAt))
      .limit(this.o.batchSize ?? 20);

    let ran = 0;
    for (const { id } of due) {
      const lockedUntil = new Date(now.getTime() + (this.o.lockMs ?? 5 * 60_000)).toISOString();
      const [job] = await this.o.db.orm
        .select()
        .from(t)
        .where(and(eq(t.id, id), eq(t.status, 'pending')))
        .limit(1);
      if (!job) continue;
      const claimed = await this.o.db.orm
        .update(t)
        .set({ status: 'running', lockedUntil, attempts: job.attempts + 1, updatedAt: nowIso })
        .where(and(eq(t.id, id), eq(t.status, 'pending')))
        .returning({ id: t.id });
      if (claimed.length === 0) continue; // someone else claimed it
      ran++;
      await this.run({ ...job, attempts: job.attempts + 1 });
    }
    return ran;
  }

  private async run(job: typeof this.t.$inferSelect): Promise<void> {
    const t = this.t;
    const log = this.o.log.child({ jobId: job.id, job: job.name });
    const handler = this.handlers.get(job.name);
    const finish = (set: Partial<typeof t.$inferInsert>) =>
      this.o.db.orm
        .update(t)
        .set({ ...set, lockedUntil: null, updatedAt: this.o.clock.now().toISOString() })
        .where(eq(t.id, job.id));
    if (!handler) {
      log.error('no handler defined for job');
      await finish({ status: 'failed', lastError: 'no handler defined' });
      return;
    }
    try {
      await handler(JSON.parse(job.payload), {
        id: job.id,
        name: job.name,
        attempts: job.attempts,
        runAt: job.runAt,
      });
      await finish({ status: 'done', lastError: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (job.attempts >= job.maxAttempts) {
        log.error({ err, attempts: job.attempts }, 'job failed permanently');
        await finish({ status: 'failed', lastError: message });
      } else {
        const runAt = new Date(this.o.clock.now().getTime() + backoffFor(job.attempts)).toISOString();
        log.warn({ err, attempts: job.attempts, runAt }, 'job failed, will retry');
        await finish({ status: 'pending', lastError: message, runAt });
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.tick()
        .catch((err) => {
          this.o.log.error({ err }, 'scheduler tick failed');
          return 0;
        })
        .finally(() => {
          this.running = null;
        });
    }, this.o.pollIntervalMs ?? 5000);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }
}
