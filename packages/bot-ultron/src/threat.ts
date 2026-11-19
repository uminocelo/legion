import { addDays, type BotContext, localDay } from '@legion/core';
import type { UltronConfig } from './config.js';
import type { EventsRepo } from './db/events-repo.js';
import { THREAT_CATCH_UP_DAYS, tickThreat } from './domain/threat.js';

export const THREAT_JOB = 'ultron.threat';
/** Ten past midnight in the server timezone: the day before is complete. */
export const THREAT_CRON = '10 0 * * *';

/** The threat meter (US-19): one tick per finished day, from that day's missions and strikes. */
export class ThreatService {
  constructor(
    private readonly ctx: BotContext<UltronConfig>,
    private readonly repo: EventsRepo,
  ) {}

  /**
   * Ticks every finished day since the last tick, at most 7 (older missed days are skipped).
   * The first run only starts the meter at 0. Safe to run twice: `last_tick_day` makes it a no-op.
   * Returns the number of days applied.
   */
  async tick(): Promise<number> {
    const cfg = this.ctx.botConfig.threat;
    if (!cfg.enabled) return 0;
    const tz = this.ctx.config.timezone;
    const yesterday = addDays(localDay(this.ctx.clock.now(), tz), -1);
    const row = await this.repo.threat();
    if (!row?.lastTickDay) {
      await this.repo.saveThreat({
        level: row?.level ?? 0,
        lastTickDay: yesterday,
        seen: row ? null : undefined,
      });
      return 0;
    }
    const earliest = addDays(yesterday, -(THREAT_CATCH_UP_DAYS - 1));
    const next = addDays(row.lastTickDay, 1);
    // YYYY-MM-DD strings: compared as text, not numbers.
    const tooOld = next < earliest;
    const from = tooOld ? earliest : next;
    if (from > yesterday) return 0;
    // A wide UTC window, then bucket by the local day so timezones line up.
    const times = await this.repo.activityTimes(
      `${addDays(from, -1)}T00:00:00.000Z`,
      `${addDays(yesterday, 2)}T00:00:00.000Z`,
    );
    const perDay = new Map<string, number>();
    for (const at of times) {
      const day = localDay(new Date(at), tz);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    let level = row.level;
    let days = 0;
    for (let d = from; d <= yesterday; d = addDays(d, 1), days++)
      level = tickThreat(level, perDay.get(d) ?? 0, cfg);
    const saved = await this.repo.saveThreat({ level, lastTickDay: yesterday, seen: row.lastTickDay });
    if (!saved) return 0;
    this.ctx.log.info({ from: row.level, to: level, days }, 'threat meter ticked');
    return days;
  }
}
