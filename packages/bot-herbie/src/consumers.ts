import type { BotContext } from '@legion/core';
import type { HerbieConfig } from './config.js';
import type { HerbieServices } from './services.js';
import { TUTORIAL_TRIGGER_EVENTS } from './tutorial.js';

export function registerConsumers(ctx: BotContext<HerbieConfig>, s: HerbieServices): void {
  ctx.bus.on('player.created', 'herbie.tutorial-start', async (e) => {
    await s.tutorial.start({ id: e.payload.memberId, discordUserId: e.payload.discordUserId });
  });
  ctx.bus.on('world.event', 'herbie.world-explain', (e) => s.help.onWorldEvent(e));
  for (const type of TUTORIAL_TRIGGER_EVENTS)
    ctx.bus.on(type, 'herbie.tutorial-trigger', (e) => s.tutorial.onEvent(e));
}
