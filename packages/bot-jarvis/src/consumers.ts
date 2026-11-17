import type { BotContext, ProgressReadModel } from '@legion/core';
import type { JarvisConfig } from './config.js';
import { toProgressView } from './db/repo.js';
import { displayedStreak } from './domain/xp.js';
import type { JarvisServices } from './services.js';

export const PROGRESS_INIT = 'jarvis.progress-init';
export const XP_GRANT = 'jarvis.xp-grant';

/** Event consumers. Delivery is at-least-once, so both are idempotent. */
export function registerConsumers(ctx: BotContext<JarvisConfig>, s: JarvisServices): void {
  ctx.bus.on('player.created', PROGRESS_INIT, async (e) => {
    await s.repo.ensureProgress(e.payload.memberId);
  });

  ctx.bus.on('xp.grant_requested', XP_GRANT, async (e) => {
    const { memberId, amount, reason, sourceEventId } = e.payload;
    if (!(await ctx.read.members.getById(memberId))) {
      // Don't retry forever: an unknown member will not appear later.
      ctx.log.warn(
        { memberId, source: e.source, sourceEventId },
        'xp.grant_requested for an unknown member; ignored',
      );
      return;
    }
    await ctx.bus.transaction((tx) =>
      s.xp.award(tx, {
        memberId,
        amount,
        reason: 'grant',
        note: reason,
        // One entry per member: a world event pays every participant from the same source event.
        sourceKey: `grant:${sourceEventId}:${reason}:${memberId}`,
      }),
    );
  });
}

/** `progress` read model: the streak shown is the lazily lapsed one (ADR 0014). */
export function progressReadModel(s: JarvisServices): ProgressReadModel {
  return {
    get: async (memberId) => {
      const row = await s.repo.progress(memberId);
      if (!row) return null;
      return { ...toProgressView(row), currentStreak: displayedStreak(row, s.xp.today()) };
    },
  };
}
