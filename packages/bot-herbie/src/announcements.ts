import type { BotContext } from '@legion/core';
import type { HerbieConfig } from './config.js';

export const ORIGINS_ANNOUNCEMENT_KEY = 'herbie.announce.origins';
interface Done {
  at: string;
  channelId: string | null;
  posted: boolean;
}

/**
 * v0.9 origins (D15): tells the server once that heroes now have an origin and that heroes from
 * before can pick theirs with `/heroi origem`. One channel post per server, never DMs. Recorded in
 * `kv` so restarts do not post again; a server with no heroes yet is marked done without a post.
 */
export async function announceOrigins(
  ctx: BotContext<HerbieConfig>,
): Promise<'posted' | 'skipped' | 'done' | 'no_channel'> {
  if (!ctx.config.bots.includes('cerebro')) return 'skipped';
  if (await ctx.kv.get<Done>(ORIGINS_ANNOUNCEMENT_KEY)) return 'done';
  const at = ctx.clock.now().toISOString();
  const heroes = await ctx.read.members.listRegistered().catch(() => []);
  if (!heroes.length) {
    await ctx.kv.set(ORIGINS_ANNOUNCEMENT_KEY, { at, channelId: null, posted: false } satisfies Done);
    return 'skipped';
  }
  const channelId =
    ctx.config.channels.tutorial ?? ctx.botConfig.tips.channelId ?? ctx.config.channels.welcome;
  if (!channelId) {
    ctx.log.warn(
      'no channel for the origins announcement; set channels.tutorial (tries again on the next start)',
    );
    return 'no_channel';
  }
  const l = ctx.config.locale;
  try {
    await ctx.gateway.sendMessage(channelId, {
      persona: 'herbie',
      embeds: [
        {
          title: ctx.i18n.t('herbie.announce.origins_title', {}, l),
          description: ctx.i18n.t('herbie.announce.origins_body', {}, l),
        },
      ],
    });
  } catch (err) {
    ctx.log.warn(
      { err, channelId },
      'could not post the origins announcement; tries again on the next start',
    );
    return 'no_channel';
  }
  await ctx.kv.set(ORIGINS_ANNOUNCEMENT_KEY, { at, channelId, posted: true } satisfies Done);
  return 'posted';
}
