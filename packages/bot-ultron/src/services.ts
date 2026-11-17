import type { BotContext } from '@legion/core';
import type { UltronConfig } from './config.js';
import { EventsRepo } from './db/events-repo.js';
import { UltronRepo } from './db/repo.js';
import { EncounterService } from './encounters.js';
import { EnemyImports } from './enemy-imports.js';
import { type AiEnv, FlavorText } from './flavor.js';
import { StatusService } from './status.js';
import { WorldEventService } from './world-events.js';

export interface UltronServices {
  repo: UltronRepo;
  eventsRepo: EventsRepo;
  flavor: FlavorText;
  encounters: EncounterService;
  world: WorldEventService;
  status: StatusService;
  imports: EnemyImports;
}

const cache = new WeakMap<object, UltronServices>();
/** Test hook: AI env and fetch for the flavor provider (defaults: process.env and global fetch). */
export const flavorOverrides: { env?: AiEnv; fetch?: typeof fetch } = {};

/** One set of services per runtime (keyed by its shared i18n). */
export function ultronServices(ctx: BotContext<UltronConfig>): UltronServices {
  let s = cache.get(ctx.i18n);
  if (!s) {
    const repo = new UltronRepo(ctx.db, ctx.guildId, ctx.clock, ctx.newId);
    const eventsRepo = new EventsRepo(ctx.db, ctx.guildId, ctx.clock);
    const flavor = new FlavorText({
      i18n: ctx.i18n,
      locale: () => ctx.config.locale,
      cfg: () => ctx.botConfig.ai,
      repo,
      clock: ctx.clock,
      log: ctx.log,
      ...flavorOverrides,
    });
    const encounters = new EncounterService(ctx, repo, flavor);
    s = {
      repo,
      eventsRepo,
      flavor,
      encounters,
      world: new WorldEventService(ctx, eventsRepo, repo, flavor),
      status: new StatusService(ctx, repo, eventsRepo, encounters, flavor),
      imports: new EnemyImports(ctx, repo),
    };
    cache.set(ctx.i18n, s);
  }
  return s;
}
