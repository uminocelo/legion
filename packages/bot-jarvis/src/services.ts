import type { BotContext } from '@legion/core';
import type { JarvisConfig } from './config.js';
import { JarvisRepo } from './db/repo.js';
import { XpService } from './xp-service.js';

export interface JarvisServices {
  repo: JarvisRepo;
  xp: XpService;
}

const cache = new WeakMap<object, JarvisServices>();

/** One set of services per bot context. */
export function jarvisServices(ctx: BotContext<JarvisConfig>): JarvisServices {
  let s = cache.get(ctx);
  if (!s) {
    const repo = new JarvisRepo(ctx.db, ctx.guildId, ctx.clock, ctx.newId);
    s = { repo, xp: new XpService(ctx, repo) };
    cache.set(ctx, s);
  }
  return s;
}
