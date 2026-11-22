import {
  AuditLog,
  type BotContext,
  type ComponentDefinition,
  customId,
  type IncomingInteraction,
  type Responder,
  readTextAttachment,
} from '@legion/core';
import type { CerebroConfig } from './config.js';
import { founderActiveSquad } from './db/repo.js';
import type { CerebroFlow } from './flow.js';
import { squadText } from './squads.js';
import { V } from './ui.js';

/** Same size limit as J.A.R.V.I.S. staff imports. */
const IMPORT_MAX_BYTES = 64 * 1024;

export const squadContentIds = {
  decide: (action: 'approve' | 'refuse', stageId: string) =>
    customId('cerebro', V, 'squad-content', action, stageId),
};

async function audit(
  ctx: BotContext<CerebroConfig>,
  action: string,
  actorId: string,
  target: string,
  details: Record<string, unknown>,
) {
  await new AuditLog(ctx.db, ctx.guildId, () => ctx.clock.now(), ctx.newId).record({
    actorDiscordId: actorId,
    source: 'command',
    action,
    target,
    details: { ok: true, ...details },
  });
}

/** `/esquadrao conteudo enviar` — founder YAML to the mod queue. */
export async function submitSquadContent(
  ctx: BotContext<CerebroConfig>,
  flow: CerebroFlow,
  i: IncomingInteraction,
  r: Responder,
): Promise<void> {
  const locale = await ctx.i18n.localeFor(i.userId);
  const text = (key: string, vars?: Record<string, string | number>) =>
    flow.ui.text(squadText(ctx.i18n, key, vars, locale));

  if (!ctx.config.squads.enabled) return r.reply(text('squads_disabled'));

  const member = await flow.repo.memberByDiscordId(i.userId);
  if (!member || member.onboardingStep !== 'registered' || member.leftAt)
    return r.reply(text('not_registered'));

  const squad = await founderActiveSquad(ctx.db, member.id);
  if (!squad) return r.reply(text('content_not_founder'));

  const api = ctx.provider('squadContentImport');
  if (!api) return r.reply(text('content_jarvis_off'));

  const att = i.attachments?.arquivo;
  const got = await readTextAttachment(ctx.gateway, att, {
    maxBytes: IMPORT_MAX_BYTES,
    extensions: ['.yaml', '.yml'],
  });
  if ('problem' in got)
    return r.reply(text(`content_problem_${got.problem}`, { kb: IMPORT_MAX_BYTES / 1024 }));

  const staged = await api.stage({
    text: got.text,
    fileName: att?.name ?? 'conteudo.yaml',
    squadId: squad.id,
    founderUserId: i.userId,
    locale,
  });
  if (!staged.ok) {
    const shown = staged.errors.slice(0, 15).map((e) => `• ${e}`);
    if (staged.errors.length > 15) shown.push(`… +${staged.errors.length - 15}`);
    return r.reply(text('content_invalid', { errors: shown.join('\n') }));
  }

  const channelId = ctx.config.channels.modQueue;
  if (!channelId) return r.reply(text('content_no_queue'));

  const kindLabel = squadText(ctx.i18n, `content_kind_${staged.kind}`, {}, locale);
  try {
    await ctx.gateway.sendMessage(channelId, {
      persona: 'cerebro',
      embeds: [
        {
          title: squadText(ctx.i18n, 'content_queue_title', {}, locale),
          description: squadText(
            ctx.i18n,
            'content_queue_body',
            { name: squad.name, kind: kindLabel, summary: staged.summary, founder: `<@${i.userId}>` },
            locale,
          ),
          color: 0x5865f2,
          fields: staged.embed.fields,
        },
        staged.embed,
      ],
      components: [
        [
          {
            type: 'button',
            customId: squadContentIds.decide('approve', staged.stageId),
            label: squadText(ctx.i18n, 'content_approve', {}, locale),
            style: 'success',
          },
          {
            type: 'button',
            customId: squadContentIds.decide('refuse', staged.stageId),
            label: squadText(ctx.i18n, 'content_refuse', {}, locale),
            style: 'danger',
          },
        ],
      ],
      allowedMentions: { users: [] },
    });
  } catch (err) {
    await api.cancel(staged.stageId);
    ctx.log.warn({ err, stageId: staged.stageId }, 'could not post squad content to mod queue');
    return r.reply(text('content_queue_failed'));
  }

  await r.reply(text('content_submitted', { name: squad.name, kind: kindLabel }));
}

export function squadContentComponents(
  ctx: BotContext<CerebroConfig>,
  flow: CerebroFlow,
): ComponentDefinition[] {
  return [
    {
      action: 'squad-content',
      version: V,
      handle: async (i, r, [action, stageId]) => {
        const locale = await ctx.i18n.localeFor(i.userId);
        const say = (key: string, vars?: Record<string, string | number>) =>
          flow.ui.text(squadText(ctx.i18n, key, vars, locale));
        if (!(await ctx.isStaff(i))) return r.reply(say('content_not_staff'));
        const api = ctx.provider('squadContentImport');
        if (!api) return r.reply(say('content_jarvis_off'));
        const id = stageId ?? '';
        if (action === 'refuse') {
          await api.cancel(id);
          await audit(ctx, 'cerebro/squad-content-refuse', i.userId, id, {});
          return r.update({
            ...say('content_refused'),
            embeds: [],
            components: [],
          });
        }
        if (action !== 'approve') return r.reply(say('content_not_staff'));
        const published = await api.publish(id, i.userId);
        if (!published.ok) {
          return r.update({
            ...say(published.key === 'expired' ? 'content_expired' : 'content_publish_failed'),
            embeds: [],
            components: [],
          });
        }
        await audit(ctx, 'cerebro/squad-content-approve', i.userId, published.id, {
          stageId: id,
        });
        return r.update({
          ...say('content_approved', { id: published.id }),
          embeds: [],
          components: [],
        });
      },
    },
  ];
}

/** Slash option group under `/esquadrao`. */
export function squadContentGroup(localeKeys: {
  description: Record<string, unknown>;
  enviar: Record<string, unknown>;
  arquivo: Record<string, unknown>;
}) {
  return {
    type: 2,
    name: 'conteudo',
    name_localizations: { 'en-US': 'content' },
    ...localeKeys.description,
    options: [
      {
        type: 1,
        name: 'enviar',
        name_localizations: { 'en-US': 'submit' },
        ...localeKeys.enviar,
        options: [
          {
            type: 11,
            name: 'arquivo',
            name_localizations: { 'en-US': 'file' },
            required: true,
            ...localeKeys.arquivo,
          },
        ],
      },
    ],
  };
}
