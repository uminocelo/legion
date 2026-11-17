import type { BotContext, I18n, IncomingInteraction, Responder, SlashCommandDefinition } from '@legion/core';
import { DIFFICULTIES, type UltronConfig } from './config.js';
import { parseWhen } from './domain/when.js';
import type { UltronServices } from './services.js';

export const desc = (i18n: I18n, key: string) => ({
  description: i18n.t(key, {}, 'pt-BR').slice(0, 100),
  description_localizations: { 'en-US': i18n.t(key, {}, 'en').slice(0, 100) },
});

const choicesOf = (i18n: I18n, values: readonly string[], prefix: string) =>
  values.map((v) => ({
    name: i18n.t(`${prefix}.${v}`, {}, 'pt-BR'),
    name_localizations: { 'en-US': i18n.t(`${prefix}.${v}`, {}, 'en') },
    value: v,
  }));

export function ultronCommands(ctx: BotContext<UltronConfig>, s: UltronServices): SlashCommandDefinition[] {
  const { i18n } = ctx;
  const say = async (
    i: IncomingInteraction,
    r: Responder,
    key: string,
    v: Record<string, string | number> = {},
  ) =>
    r.reply({ persona: 'ultron', ephemeral: true, content: i18n.t(key, v, await i18n.localeFor(i.userId)) });
  const kindOption = (required: boolean) => ({
    type: 3,
    name: 'tipo',
    name_localizations: { 'en-US': 'kind' },
    required,
    choices: choicesOf(i18n, ['invasion', 'raid'], 'ultron.kinds'),
    ...desc(i18n, 'ultron.commands.ultron.tipo'),
  });
  const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
  const evento = async (i: IncomingInteraction, r: Responder) => {
    const kind = (i.options?.tipo as 'invasion' | 'raid' | undefined) ?? undefined;
    if (i.subcommand === 'evento cancelar') {
      const open = await s.eventsRepo.openEvents(kind);
      const target = open.find((e) => e.status === 'active') ?? open[0];
      if (!target) return say(i, r, 'ultron.events.nothing_to_cancel');
      await s.world.cancel(target.id);
      return say(i, r, 'ultron.events.cancelled', {
        title: s.world.title(target, (await s.repo.template(target.templateId))?.name ?? target.templateId),
      });
    }
    const now = ctx.clock.now();
    const startsAt =
      i.subcommand === 'evento iniciar'
        ? now
        : parseWhen(String(i.options?.quando ?? ''), now, ctx.config.timezone);
    if (!startsAt) return say(i, r, 'ultron.errors.bad_when');
    if (!ctx.config.channels.events) return say(i, r, 'ultron.errors.no_events_channel');
    const res = await s.world.schedule({
      kind: kind ?? 'raid',
      startsAt,
      scheduledBy: i.userId,
      announceNow: i.subcommand === 'evento iniciar',
    });
    if (!res.ok) return say(i, r, `ultron.errors.schedule_${res.error}`);
    if (i.subcommand === 'evento iniciar') {
      await s.world.start(res.event.id);
      return say(i, r, 'ultron.events.started_now', { channel: `<#${ctx.config.channels.events}>` });
    }
    return say(i, r, 'ultron.events.scheduled', {
      at: `<t:${unix(res.event.startsAt)}:F>`,
      announce: `<t:${unix(res.event.announceAt)}:R>`,
    });
  };
  return [
    {
      name: 'ameaca',
      json: {
        name: 'ameaca',
        name_localizations: { 'en-US': 'threat' },
        ...desc(i18n, 'ultron.commands.ameaca'),
      },
      execute: (i, r) => s.world.threat(i, r),
    },
    {
      name: 'ultron',
      json: {
        name: 'ultron',
        ...desc(i18n, 'ultron.commands.ultron.description'),
        default_member_permissions: '0',
        options: [
          {
            type: 1,
            name: 'spawn',
            ...desc(i18n, 'ultron.commands.ultron.spawn'),
            options: [
              {
                type: 3,
                name: 'dificuldade',
                name_localizations: { 'en-US': 'difficulty' },
                required: true,
                choices: choicesOf(i18n, DIFFICULTIES, 'ultron.difficulty'),
                ...desc(i18n, 'ultron.commands.ultron.dificuldade'),
              },
              ...[1, 2, 3, 4].map((n) => ({
                type: 6,
                name: `membro${n}`,
                name_localizations: { 'en-US': `member${n}` },
                required: false,
                ...desc(i18n, 'ultron.commands.ultron.membro'),
              })),
            ],
          },
          {
            type: 2,
            name: 'evento',
            name_localizations: { 'en-US': 'event' },
            ...desc(i18n, 'ultron.commands.ultron.evento'),
            options: [
              {
                type: 1,
                name: 'agendar',
                name_localizations: { 'en-US': 'schedule' },
                ...desc(i18n, 'ultron.commands.ultron.agendar'),
                options: [
                  kindOption(true),
                  {
                    type: 3,
                    name: 'quando',
                    name_localizations: { 'en-US': 'when' },
                    required: true,
                    max_length: 20,
                    ...desc(i18n, 'ultron.commands.ultron.quando'),
                  },
                ],
              },
              {
                type: 1,
                name: 'iniciar',
                name_localizations: { 'en-US': 'start' },
                ...desc(i18n, 'ultron.commands.ultron.iniciar'),
                options: [kindOption(true)],
              },
              {
                type: 1,
                name: 'cancelar',
                name_localizations: { 'en-US': 'cancel' },
                ...desc(i18n, 'ultron.commands.ultron.cancelar'),
                options: [kindOption(false)],
              },
            ],
          },
          { type: 1, name: 'status', ...desc(i18n, 'ultron.commands.ultron.status') },
        ],
      },
      execute: async (i, r) => {
        if (!(await ctx.isStaff(i)))
          return r.reply({
            persona: 'ultron',
            ephemeral: true,
            content: i18n.t('ultron.errors.not_staff', {}, await i18n.localeFor(i.userId)),
          });
        if (i.subcommand?.startsWith('evento ')) return evento(i, r);
        if (i.subcommand === 'status') return s.status.reply(i, r);
        return s.encounters.spawnCommand(i, r);
      },
    },
  ];
}
