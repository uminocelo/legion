import type { BotContext } from '@legion/core';
import type { JarvisConfig } from './config.js';
import { JarvisRepo } from './db/repo.js';
import { JarvisLeaderboard } from './leaderboard.js';
import { JarvisMissions } from './missions.js';
import { StaffTrivia } from './staff-trivia.js';
import { JarvisTrivia } from './trivia.js';
import { XpService } from './xp-service.js';

export interface JarvisServices {
  repo: JarvisRepo;
  xp: XpService;
  trivia: JarvisTrivia;
  board: JarvisLeaderboard;
  missions: JarvisMissions;
  staffTrivia: StaffTrivia;
}

const cache = new WeakMap<object, JarvisServices>();

/** One set of services per bot context. */
export function jarvisServices(ctx: BotContext<JarvisConfig>): JarvisServices {
  let s = cache.get(ctx);
  if (!s) {
    const repo = new JarvisRepo(ctx.db, ctx.guildId, ctx.clock, ctx.newId);
    const partial = { repo, xp: new XpService(ctx, repo) } as JarvisServices;
    partial.trivia = new JarvisTrivia(ctx, partial);
    partial.board = new JarvisLeaderboard(ctx, partial, partial.trivia.ui);
    partial.missions = new JarvisMissions(ctx, partial);
    partial.staffTrivia = new StaffTrivia(ctx, partial);
    s = partial;
    cache.set(ctx, s);
  }
  return s;
}
