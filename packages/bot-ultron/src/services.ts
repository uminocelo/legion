import type { BotContext } from '@legion/core';
import type { UltronConfig } from './config.js';
import { UltronRepo } from './db/repo.js';
import { EncounterService } from './encounters.js';
import { FlavorText } from './flavor.js';

export interface UltronServices {
  repo: UltronRepo;
  flavor: FlavorText;
  encounters: EncounterService;
}

const cache = new WeakMap<object, UltronServices>();

/** One set of services per runtime (keyed by its shared i18n). */
export function ultronServices(ctx: BotContext<UltronConfig>): UltronServices {
  let s = cache.get(ctx.i18n);
  if (!s) {
    const repo = new UltronRepo(ctx.db, ctx.guildId, ctx.clock, ctx.newId);
    const flavor = new FlavorText(ctx.i18n, () => ctx.config.locale);
    s = { repo, flavor, encounters: new EncounterService(ctx, repo, flavor) };
    cache.set(ctx.i18n, s);
  }
  return s;
}
