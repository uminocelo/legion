import type { BotContext, I18n, IncomingInteraction, Responder, SlashCommandDefinition } from '@legion/core';
import type { SentinelConfig } from './config.js';
import { MOTIVOS } from './moderation.js';
import type { SentinelServices } from './services.js';

export const desc = (i18n: I18n, key: string) => ({
  description: i18n.t(key, {}, 'pt-BR').slice(0, 100),
  description_localizations: { 'en-US': i18n.t(key, {}, 'en').slice(0, 100) },
});

export function sentinelCommands(
  ctx: BotContext<SentinelConfig>,
  s: SentinelServices,
): SlashCommandDefinition[] {
  const { i18n } = ctx;
  const reply = async (
    i: IncomingInteraction,
    r: Responder,
    key: string,
    v: Record<string, string | number> = {},
  ) =>
    r.reply({
      persona: 'sentinel',
      ephemeral: true,
      content: i18n.t(key, v, await i18n.localeFor(i.userId)),
    });
  return [
    {
      name: 'treino',
      json: {
        name: 'treino',
        name_localizations: { 'en-US': 'training' },
        ...desc(i18n, 'sentinel.commands.treino'),
      },
      execute: (i, r) => s.combat.training(i, r),
    },
    {
      name: 'combate',
      json: {
        name: 'combate',
        name_localizations: { 'en-US': 'combat' },
        ...desc(i18n, 'sentinel.commands.combate.description'),
        options: [
          { type: 1, name: 'status', ...desc(i18n, 'sentinel.commands.combate.status') },
          {
            type: 1,
            name: 'log',
            ...desc(i18n, 'sentinel.commands.combate.log'),
            options: [
              {
                type: 3,
                name: 'id',
                required: true,
                autocomplete: true,
                ...desc(i18n, 'sentinel.commands.combate.id'),
              },
            ],
          },
        ],
      },
      autocomplete: (i, r) => s.combat.autocomplete(i, r, true),
      execute: async (i, r) => {
        if (i.subcommand === 'status') return s.combat.statusOf(i, r);
        const page = await s.combat.logPage(
          String(i.options?.id ?? '').trim(),
          0,
          await i18n.localeFor(i.userId),
        );
        return page ? r.reply(page) : reply(i, r, 'sentinel.errors.combat_not_found');
      },
    },
    {
      name: 'denunciar',
      json: {
        name: 'denunciar',
        name_localizations: { 'en-US': 'report' },
        ...desc(i18n, 'sentinel.commands.denunciar.description'),
        options: [
          {
            type: 6,
            name: 'membro',
            name_localizations: { 'en-US': 'member' },
            required: true,
            ...desc(i18n, 'sentinel.commands.denunciar.membro'),
          },
          {
            type: 3,
            name: 'motivo',
            name_localizations: { 'en-US': 'reason' },
            required: true,
            choices: MOTIVOS.map((m) => ({
              name: i18n.t(`sentinel.motivos.${m}`, {}, 'pt-BR'),
              name_localizations: { 'en-US': i18n.t(`sentinel.motivos.${m}`, {}, 'en') },
              value: m,
            })),
            ...desc(i18n, 'sentinel.commands.denunciar.motivo'),
          },
          {
            type: 3,
            name: 'detalhes',
            name_localizations: { 'en-US': 'details' },
            required: false,
            max_length: 400,
            ...desc(i18n, 'sentinel.commands.denunciar.detalhes'),
          },
        ],
      },
      execute: (i, r) => s.moderation.denunciar(i, r),
    },
    {
      name: 'Denunciar mensagem',
      json: { name: 'Denunciar mensagem', name_localizations: { 'en-US': 'Report message' }, type: 3 },
      execute: (i, r) => s.moderation.reportMessageMenu(i, r),
    },
    {
      name: 'sentinel',
      json: {
        name: 'sentinel',
        ...desc(i18n, 'sentinel.commands.sentinel.description'),
        default_member_permissions: '0',
        options: [
          {
            type: 1,
            name: 'replay',
            ...desc(i18n, 'sentinel.commands.sentinel.replay'),
            options: [
              {
                type: 3,
                name: 'combate',
                name_localizations: { 'en-US': 'combat' },
                required: true,
                autocomplete: true,
                ...desc(i18n, 'sentinel.commands.combate.id'),
              },
            ],
          },
          {
            type: 1,
            name: 'denuncias',
            name_localizations: { 'en-US': 'reports' },
            ...desc(i18n, 'sentinel.commands.sentinel.denuncias'),
            options: [
              {
                type: 3,
                name: 'status',
                required: false,
                choices: ['open', 'resolved', 'ignored'].map((v) => ({
                  name: i18n.t(`sentinel.mod.status_${v}`, {}, 'pt-BR'),
                  name_localizations: { 'en-US': i18n.t(`sentinel.mod.status_${v}`, {}, 'en') },
                  value: v,
                })),
                ...desc(i18n, 'sentinel.commands.sentinel.status'),
              },
            ],
          },
          {
            type: 1,
            name: 'historico',
            name_localizations: { 'en-US': 'history' },
            ...desc(i18n, 'sentinel.commands.sentinel.historico'),
            options: [
              {
                type: 6,
                name: 'membro',
                name_localizations: { 'en-US': 'member' },
                required: true,
                ...desc(i18n, 'sentinel.commands.denunciar.membro'),
              },
            ],
          },
        ],
      },
      autocomplete: (i, r) => s.combat.autocomplete(i, r, false),
      execute: async (i, r) => {
        if (!(await ctx.isStaff(i))) return reply(i, r, 'sentinel.errors.not_staff');
        const l = await i18n.localeFor(i.userId);
        if (i.subcommand === 'denuncias')
          return r.reply(await s.moderation.list(String(i.options?.status ?? 'open'), l));
        if (i.subcommand === 'historico')
          return r.reply(await s.moderation.history(String(i.options?.membro ?? ''), l));
        const id = String(i.options?.combate ?? '').trim();
        const v = await s.combat.verify(id);
        if (!v) return reply(i, r, 'sentinel.errors.combat_not_found');
        return reply(i, r, v.ok ? 'sentinel.replay.ok' : 'sentinel.replay.mismatch', {
          id: `#${v.id.slice(-6)}`,
          stored: v.stored?.slice(0, 16) ?? '—',
          computed: v.computed.slice(0, 16),
        });
      },
    },
  ];
}
