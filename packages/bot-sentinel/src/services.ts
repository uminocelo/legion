import type { BotContext } from '@legion/core';
import { CombatService } from './combat.js';
import type { SentinelConfig } from './config.js';
import { SentinelRepo } from './db/repo.js';

export interface SentinelServices {
  repo: SentinelRepo;
  combat: CombatService;
}

const cache = new WeakMap<object, SentinelServices>();

/** One set of services per runtime (keyed by its shared i18n). */
export function sentinelServices(ctx: BotContext<SentinelConfig>): SentinelServices {
  let s = cache.get(ctx.i18n);
  if (!s) {
    const repo = new SentinelRepo(ctx.db, ctx.guildId, ctx.clock, ctx.newId);
    s = { repo, combat: new CombatService(ctx, repo) };
    cache.set(ctx.i18n, s);
  }
  return s;
}
