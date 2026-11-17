import type { BotContext } from '@legion/core';
import { CombatService } from './combat.js';
import type { SentinelConfig } from './config.js';
import { SentinelRepo } from './db/repo.js';
import { SafetyRepo } from './db/safety-repo.js';
import { ModerationService } from './moderation.js';
import { SafetyService } from './safety.js';

export interface SentinelServices {
  repo: SentinelRepo;
  combat: CombatService;
  safetyRepo: SafetyRepo;
  safety: SafetyService;
  moderation: ModerationService;
}

const cache = new WeakMap<object, SentinelServices>();

/** One set of services per runtime (keyed by its shared i18n). */
export function sentinelServices(ctx: BotContext<SentinelConfig>): SentinelServices {
  let s = cache.get(ctx.i18n);
  if (!s) {
    const repo = new SentinelRepo(ctx.db, ctx.guildId, ctx.clock, ctx.newId);
    const safetyRepo = new SafetyRepo(ctx.db, ctx.guildId, ctx.clock, ctx.newId);
    const safety = new SafetyService(ctx, safetyRepo);
    s = {
      repo,
      combat: new CombatService(ctx, repo),
      safetyRepo,
      safety,
      moderation: new ModerationService(ctx, safetyRepo, safety),
    };
    cache.set(ctx.i18n, s);
  }
  return s;
}
