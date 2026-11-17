import type { BotContext } from '@legion/core';
import type { HerbieConfig } from './config.js';
import { HerbieRepo } from './db/repo.js';
import { HerbieTutorial } from './tutorial.js';

export interface HerbieServices {
  repo: HerbieRepo;
  tutorial: HerbieTutorial;
}

const cache = new WeakMap<object, HerbieServices>();

/** One set of services per bot context. */
export function herbieServices(ctx: BotContext<HerbieConfig>): HerbieServices {
  let s = cache.get(ctx);
  if (!s) {
    const repo = new HerbieRepo(ctx.db, ctx.guildId, ctx.clock, ctx.newId);
    s = { repo, tutorial: new HerbieTutorial(ctx, repo) };
    cache.set(ctx, s);
  }
  return s;
}
