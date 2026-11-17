import type { BotContext } from '@legion/core';
import type { HerbieConfig } from './config.js';
import { HerbieRepo } from './db/repo.js';
import { HerbieHelp } from './help.js';
import { HerbieTutorial } from './tutorial.js';

export interface HerbieServices {
  repo: HerbieRepo;
  tutorial: HerbieTutorial;
  help: HerbieHelp;
}

const cache = new WeakMap<object, HerbieServices>();

/**
 * One set of services per runtime (keyed by its shared i18n): glossary and tips live in memory, so every
 * context of the same runtime must see the same loaded copy.
 */
export function herbieServices(ctx: BotContext<HerbieConfig>): HerbieServices {
  let s = cache.get(ctx.i18n);
  if (!s) {
    const repo = new HerbieRepo(ctx.db, ctx.guildId, ctx.clock, ctx.newId);
    const tutorial = new HerbieTutorial(ctx, repo);
    s = { repo, tutorial, help: new HerbieHelp(ctx, repo, tutorial) };
    cache.set(ctx.i18n, s);
  }
  return s;
}
