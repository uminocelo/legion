import {
  type BotContext,
  type Embed,
  GatewayError,
  type IncomingInteraction,
  type Responder,
} from '@legion/core';
import { z } from 'zod';
import type { HerbieConfig } from './config.js';
import { loadLocalized } from './content.js';

export const guideSectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  title: z.string().min(1).max(256),
  body: z.string().min(1).max(4000),
  bot: z.enum(['cerebro', 'jarvis', 'herbie', 'sentinel', 'ultron']).optional(),
});
export type GuideSection = z.infer<typeof guideSectionSchema>;
export const guideSchema = z.array(guideSectionSchema).min(1);

export const GUIDE_KEY = 'herbie.guide';
interface Posted {
  channelId: string;
  messageIds: string[];
}

/** Embeds per message: Discord allows 10 and 6000 characters in total. */
export function packEmbeds(embeds: Embed[]): Embed[][] {
  const size = (e: Embed) => (e.title?.length ?? 0) + (e.description?.length ?? 0);
  const out: Embed[][] = [];
  let cur: Embed[] = [];
  let total = 0;
  for (const e of embeds) {
    if (cur.length && (cur.length === 10 || total + size(e) > 6000)) {
      out.push(cur);
      cur = [];
      total = 0;
    }
    cur.push(e);
    total += size(e);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The "how to play" post: `/herbie guia publicar` posts it (or updates the last post) and pins it. */
export class HerbieGuide {
  /** Errors of the server's guide file at the last load (the shipped guide was used instead). */
  lastErrors: string[] = [];

  constructor(private readonly ctx: BotContext<HerbieConfig>) {}

  /** Sections for enabled bots, in the server language. Throws a readable error when the file is invalid. */
  sections(serverDir?: string): GuideSection[] {
    const g = loadLocalized('guide', this.ctx.config.locale, guideSchema, serverDir);
    this.lastErrors = g.errors;
    const list = g.value ?? g.bundled;
    if (!list) throw new Error(g.errors.join('\n') || 'guide missing');
    return list.filter((s) => !s.bot || this.ctx.config.bots.includes(s.bot));
  }

  messages(serverDir?: string): Embed[][] {
    const color = 0x9b59b6;
    return packEmbeds(
      this.sections(serverDir).map((s) => ({ title: s.title, description: s.body.trim(), color })),
    );
  }

  /** Posts or updates the guide. Returns where it went, whether it was edited in place and pinned. */
  async publish(channelId: string, serverDir?: string) {
    const pages = this.messages(serverDir);
    const prev = await this.ctx.kv.get<Posted>(GUIDE_KEY);
    let ids: string[] = [];
    let edited = false;
    if (prev?.channelId === channelId && prev.messageIds.length === pages.length) {
      try {
        for (const [i, embeds] of pages.entries())
          await this.ctx.gateway.editMessage(channelId, prev.messageIds[i] ?? '', {
            persona: 'herbie',
            embeds,
          });
        ids = prev.messageIds;
        edited = true;
      } catch (err) {
        if (!(err instanceof GatewayError)) throw err;
        this.ctx.log.info({ err }, 'previous guide post is gone; posting a new one');
      }
    }
    if (!edited)
      for (const embeds of pages)
        ids.push((await this.ctx.gateway.sendMessage(channelId, { persona: 'herbie', embeds })).messageId);
    await this.ctx.kv.set(GUIDE_KEY, { channelId, messageIds: ids } satisfies Posted);
    let pinned = true;
    try {
      await this.ctx.gateway.pinMessage(channelId, ids[0] ?? '');
    } catch (err) {
      if (!(err instanceof GatewayError)) throw err;
      pinned = false;
      this.ctx.log.warn({ err, channelId }, 'could not pin the guide; pin it by hand or give Pin Messages');
    }
    return { channelId, messages: ids.length, edited, pinned };
  }

  /** `/herbie guia publicar [canal]` (staff checked by the command). */
  async command(i: IncomingInteraction, r: Responder) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const t = (k: string, v: Record<string, string | number> = {}) =>
      this.ctx.i18n.t(`herbie.guide.${k}`, v, l);
    const channelId =
      (typeof i.options?.canal === 'string' && i.options.canal) ||
      this.ctx.config.channels.rules ||
      i.channelId;
    try {
      const res = await this.publish(channelId);
      const lines = [
        t(res.edited ? 'updated' : 'posted', { channel: `<#${channelId}>`, n: res.messages }),
        ...(res.pinned ? [] : [t('not_pinned')]),
        ...(this.lastErrors.length
          ? [t('server_file_invalid', { errors: this.lastErrors.slice(0, 5).join('\n') })]
          : []),
      ];
      return r.reply({ persona: 'herbie', ephemeral: true, content: lines.join('\n') });
    } catch (err) {
      if (err instanceof GatewayError)
        return r.reply({
          persona: 'herbie',
          ephemeral: true,
          content: t('send_failed', { channel: `<#${channelId}>` }),
        });
      return r.reply({
        persona: 'herbie',
        ephemeral: true,
        content: t('invalid', { errors: (err as Error).message.slice(0, 1500) }),
      });
    }
  }
}
