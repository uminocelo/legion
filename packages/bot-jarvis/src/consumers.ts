import type { BotContext, ProgressReadModel } from '@legion/core';
import type { JarvisConfig } from './config.js';
import { toProgressView } from './db/repo.js';
import { displayedStreak } from './domain/xp.js';
import type { JarvisServices } from './services.js';

export const PROGRESS_INIT = 'jarvis.progress-init';
export const XP_GRANT = 'jarvis.xp-grant';
export const FACTION_RESULT = 'jarvis.faction-result';
export const WORLD_CREDITS = 'jarvis.world-credits';
export const WAR_CREDITS = 'jarvis.war-credits';

/** Event consumers. Delivery is at-least-once, so both are idempotent. */
export function registerConsumers(ctx: BotContext<JarvisConfig>, s: JarvisServices): void {
  ctx.bus.on('player.created', PROGRESS_INIT, async (e) => {
    await s.repo.ensureProgress(e.payload.memberId);
  });

  // Results of a team join requested at the end of a recruitment arc (ADR 0032).
  ctx.bus.on('player.faction_changed', FACTION_RESULT, async (e) => {
    if (e.payload.reason !== 'arc') return;
    await s.missions.onFactionResult({ kind: 'changed', ...e.payload });
  });
  ctx.bus.on('player.faction_change_refused', FACTION_RESULT, (e) =>
    s.missions.onFactionResult({ kind: 'refused', ...e.payload }),
  );

  // Credits for world events (v0.10, US-14, D4): no new event, ULTRON's `world.event` ended is enough.
  ctx.bus.on('world.event', WORLD_CREDITS, async (e) => {
    await s.wallet.payWorldEvent(e.payload);
  });

  // War winners (US-18, D19). ULTRON emits; J.A.R.V.I.S. is the only writer of the wallet.
  ctx.bus.on('war.ended', WAR_CREDITS, async (e) => {
    await s.wallet.payWar(e.payload);
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
