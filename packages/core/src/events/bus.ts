import { and, asc, eq, gte } from 'drizzle-orm';
import type { Logger } from 'pino';
import { type CoreTables, coreTables } from '../db/core-tables.js';
import type { Executor, LegionDb } from '../db/db.js';
import { RETRY_BACKOFF_MS, type Scheduler } from '../scheduler/scheduler.js';
import type { Clock } from '../time/clock.js';
import {
  type EventPayloads,
  type EventSource,
  type EventType,
  isEventType,
  type LegionEvent,
  validatePayload,
} from './catalog.js';

export type EventHandler<T extends EventType> = (event: LegionEvent<T>) => Promise<void>;

export interface EventBus {
  /** Runs `fn` in a DB transaction; events emitted with its `tx` are dispatched only after commit. */
  transaction<R>(fn: (tx: Executor) => Promise<R>): Promise<R>;
  /** Validates and logs an event. Pass the `tx` of `transaction()` (or the plain db for a standalone emit). */
  emit<T extends EventType>(tx: Executor, type: T, payload: EventPayloads[T]): Promise<LegionEvent<T>>;
  on<T extends EventType>(type: T, consumerId: string, handler: EventHandler<T>): void;
}

/** Max retries after the first failure, then the consumption is marked failed. */
export const MAX_EVENT_RETRIES = RETRY_BACKOFF_MS.length;
const RETRY_JOB = 'core.event-retry';

interface Subscriber {
  consumerId: string;
  handler: EventHandler<EventType>;
}

export interface InProcessBusOptions {
  db: LegionDb;
  scheduler: Scheduler;
  clock: Clock;
  newId: () => string;
  guildId: string;
  log: Logger;
  replayLookbackDays?: number;
}

/** In-process typed bus with a DB outbox, consumption tracking, replay and retries (main prompt §6). */
export class InProcessEventBus {
  private readonly subs = new Map<EventType, Subscriber[]>();
  private readonly consumers = new Set<string>();
  private readonly pending = new WeakMap<object, LegionEvent[]>();
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly o: InProcessBusOptions) {
    o.scheduler.define<{ eventId: string; consumerId: string }>(RETRY_JOB, async (p) => {
      const event = await this.loadEvent(p.eventId);
      const sub = event && this.subs.get(event.type)?.find((s) => s.consumerId === p.consumerId);
      if (event && sub) await this.deliver(event, sub);
    });
  }

  /** A view of this bus for one bot: events it emits carry `source`. */
  forSource(source: EventSource): EventBus {
    return {
      transaction: (fn) => this.transaction(fn),
      emit: (tx, type, payload) => this.emit(tx, type, payload, source),
      on: (type, consumerId, handler) => this.on(type, consumerId, handler),
    };
  }

  async transaction<R>(fn: (tx: Executor) => Promise<R>): Promise<R> {
    let events: LegionEvent[] = [];
    const result = await this.o.db.transaction(async (tx) => {
      events = [];
      this.pending.set(tx, events);
      return fn(tx);
    });
    for (const e of events) this.dispatch(e);
    return result;
  }

  async emit<T extends EventType>(
    tx: Executor,
    type: T,
    payload: EventPayloads[T],
    source: EventSource = 'core',
  ): Promise<LegionEvent<T>> {
    const valid = validatePayload(type, payload);
    const queue = this.pending.get(tx);
    if (!queue && tx !== this.o.db.orm) {
      throw new Error('bus.emit needs the tx from bus.transaction() (or the plain db handle)');
    }
    const event: LegionEvent<T> = {
      id: this.o.newId(),
      type,
      version: 1,
      guildId: this.o.guildId,
      occurredAt: this.o.clock.now().toISOString(),
      source,
      payload: valid,
    };
    await tx.insert(coreTables(this.o.db).coreEventLog).values({
      id: event.id,
      type,
      version: 1,
      guildId: event.guildId,
      source,
      payload: JSON.stringify(valid),
      occurredAt: event.occurredAt,
    });
    if (queue) queue.push(event as LegionEvent);
    else this.dispatch(event as LegionEvent);
    return event;
  }

  on<T extends EventType>(type: T, consumerId: string, handler: EventHandler<T>): void {
    if (!isEventType(type)) throw new Error(`Unknown event type "${type}"`);
    const key = `${type}|${consumerId}`;
    if (this.consumers.has(key)) throw new Error(`Consumer "${consumerId}" already subscribed to ${type}`);
    this.consumers.add(key);
    const list = this.subs.get(type) ?? [];
    list.push({ consumerId, handler: handler as EventHandler<EventType> });
    this.subs.set(type, list);
  }

  private dispatch(event: LegionEvent): void {
    for (const sub of this.subs.get(event.type) ?? []) {
      const p = this.deliver(event, sub)
        .catch((err) =>
          // Bookkeeping failed (e.g. the consumption row). The event stays unconsumed and is replayed on boot.
          this.o.log.error(
            { err, eventId: event.id, consumerId: sub.consumerId },
            'event delivery bookkeeping failed',
          ),
        )
        .finally(() => this.inFlight.delete(p));
      this.inFlight.add(p);
    }
  }

  /** Waits until every in-flight handler finished (tests and shutdown). */
  async drain(): Promise<void> {
    while (this.inFlight.size) await Promise.allSettled([...this.inFlight]);
  }

  private async deliver(event: LegionEvent, sub: Subscriber): Promise<void> {
    const t = coreTables(this.o.db).coreEventConsumption;
    const log = this.o.log.child({ eventId: event.id, eventType: event.type, consumerId: sub.consumerId });
    const [prev] = await this.o.db.orm
      .select()
      .from(t)
      .where(and(eq(t.consumerId, sub.consumerId), eq(t.eventId, event.id)))
      .limit(1);
    if (prev && prev.status !== 'pending') return;
    const attempts = (prev?.attempts ?? 0) + 1;
    const now = () => this.o.clock.now().toISOString();
    const record = (status: string, lastError: string | null) =>
      this.o.db.orm
        .insert(t)
        .values({
          consumerId: sub.consumerId,
          eventId: event.id,
          status,
          attempts,
          lastError,
          updatedAt: now(),
        })
        .onConflictDoUpdate({
          target: [t.consumerId, t.eventId],
          set: { status, attempts, lastError, updatedAt: now() },
        });
    try {
      await sub.handler(event);
      await record('done', null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempts > MAX_EVENT_RETRIES) {
        log.error({ err, attempts }, 'event handler failed permanently');
        await record('failed', message);
        return;
      }
      log.warn({ err, attempts }, 'event handler failed, will retry');
      await record('pending', message);
      const delay = RETRY_BACKOFF_MS[attempts - 1] ?? 600_000;
      await this.o.scheduler.enqueue(
        RETRY_JOB,
        { eventId: event.id, consumerId: sub.consumerId },
        {
          runAt: new Date(this.o.clock.now().getTime() + delay),
          dedupeKey: `${RETRY_JOB}:${sub.consumerId}:${event.id}:${attempts}`,
          maxAttempts: 1,
        },
      );
    }
  }

  private async loadEvent(id: string): Promise<LegionEvent | null> {
    const t = coreTables(this.o.db).coreEventLog;
    const [row] = await this.o.db.orm.select().from(t).where(eq(t.id, id)).limit(1);
    return row ? this.toEvent(row) : null;
  }

  private toEvent(row: CoreTables['coreEventLog']['$inferSelect']): LegionEvent | null {
    if (!isEventType(row.type)) return null;
    return {
      id: row.id,
      type: row.type,
      version: 1,
      guildId: row.guildId,
      occurredAt: row.occurredAt,
      source: row.source as EventSource,
      payload: JSON.parse(row.payload),
    } as LegionEvent;
  }

  /**
   * Delivers every logged event (within the lookback window) that a current subscriber has not consumed,
   * oldest first. Pending retries are left to their scheduled job. Returns the number of deliveries.
   */
  async replayPending(): Promise<number> {
    const log = coreTables(this.o.db).coreEventLog;
    const cons = coreTables(this.o.db).coreEventConsumption;
    const since = new Date(
      this.o.clock.now().getTime() - (this.o.replayLookbackDays ?? 7) * 86_400_000,
    ).toISOString();
    const rows = await this.o.db.orm
      .select()
      .from(log)
      .where(gte(log.occurredAt, since))
      .orderBy(asc(log.occurredAt), asc(log.id));
    const done = await this.o.db.orm
      .select({ consumerId: cons.consumerId, eventId: cons.eventId })
      .from(cons);
    const seen = new Set(done.map((d) => `${d.consumerId}|${d.eventId}`));
    let count = 0;
    for (const row of rows) {
      const event = this.toEvent(row);
      if (!event) continue;
      for (const sub of this.subs.get(event.type) ?? []) {
        if (seen.has(`${sub.consumerId}|${event.id}`)) continue;
        await this.deliver(event, sub);
        count++;
      }
    }
    return count;
  }
}
