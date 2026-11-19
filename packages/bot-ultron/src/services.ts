import type { BotContext } from '@legion/core';
import type { UltronConfig } from './config.js';
import { EventsRepo } from './db/events-repo.js';
import { UltronRepo } from './db/repo.js';
import { WarRepo } from './db/war-repo.js';
import { EncounterService } from './encounters.js';
import { EnemyImports } from './enemy-imports.js';
import { type AiEnv, FlavorText } from './flavor.js';
import { StatusService } from './status.js';
import { ThreatService } from './threat.js';
import { WarService } from './war.js';
import { WorldEventService } from './world-events.js';

export interface UltronServices {
  repo: UltronRepo;
  eventsRepo: EventsRepo;
  flavor: FlavorText;
  encounters: EncounterService;
  world: WorldEventService;
  war: WarService;
  threat: ThreatService;
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
    const world = new WorldEventService(ctx, eventsRepo, repo, flavor);
    const war = new WarService(ctx, new WarRepo(ctx.db, ctx.guildId, ctx.clock, ctx.newId));
    world.warScore = {
      strike: (memberId, combatId, ex) => war.scoreStrike(memberId, combatId, ex),
      participation: (eventId, memberIds) => war.scoreParticipation(eventId, memberIds),
    };
    s = {
      repo,
      eventsRepo,
      flavor,
      encounters,
      world,
      war,
      threat: new ThreatService(ctx, eventsRepo),
      status: new StatusService(ctx, repo, eventsRepo, encounters, flavor),
      imports: new EnemyImports(ctx, repo),
    };
    cache.set(ctx.i18n, s);
  }
  return s;
}
