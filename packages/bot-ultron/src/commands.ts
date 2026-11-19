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
  const guerra = async (i: IncomingInteraction, r: Responder) => {
    if (i.subcommand === 'guerra iniciar') {
      const res = await s.war.staffStart();
      if (res === 'active') return say(i, r, 'ultron.war.already_active');
      if (res === 'disabled') return say(i, r, 'ultron.war.disabled');
      const active = await s.war.repo.findStatus('active');
      return say(i, r, 'ultron.war.started', { at: `<t:${unix(active?.endsAt ?? '')}:F>` });
    }
    if (i.subcommand === 'guerra encerrar') {
      const res = await s.war.staffEnd();
      if (res === 'none') return say(i, r, 'ultron.war.no_war');
      if (res === 'disabled') return say(i, r, 'ultron.war.disabled');
      return say(i, r, 'ultron.war.ended');
    }
    const raw = i.options?.pontos;
    const points = typeof raw === 'number' ? raw : Number(raw);
    const target = String(i.options?.membro ?? '');
    const res = await s.war.staffPoints({
      discordUserId: target,
      points,
      note: String(i.options?.motivo ?? ''),
      actorId: i.userId,
      sourceKey: `war:staff:${i.id}`,
    });
    if (!res.ok) {
      const key = {
        range: 'ultron.war.points_range',
        zero: 'ultron.war.points_zero',
        note: 'ultron.war.note_required',
        missing: 'ultron.war.missing',
        left: 'ultron.war.left',
        independent: 'ultron.war.independent',
        no_war: 'ultron.war.no_war',
        disabled: 'ultron.war.disabled',
        duplicate: 'ultron.war.duplicate',
      }[res.error];
      return say(i, r, key);
    }
    return say(i, r, 'ultron.war.points_ok', {
      points: res.points,
      user: `<@${target}>`,
      faction: s.war.factionLabel(res.faction),
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
      name: 'guerra',
      json: {
        name: 'guerra',
        name_localizations: { 'en-US': 'war' },
        ...desc(i18n, 'ultron.commands.guerra'),
      },
      execute: async (i, r) =>
        r.reply({
          persona: 'ultron',
          ephemeral: true,
          content: await s.war.playerView(i.userId, await i18n.localeFor(i.userId)),
        }),
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
          {
            type: 2,
            name: 'inimigo',
            name_localizations: { 'en-US': 'enemy' },
            ...desc(i18n, 'ultron.commands.ultron.inimigo'),
            options: [
              {
                type: 1,
                name: 'importar',
                name_localizations: { 'en-US': 'import' },
                ...desc(i18n, 'ultron.commands.ultron.importar'),
                options: [
                  {
                    type: 11,
                    name: 'arquivo',
                    name_localizations: { 'en-US': 'file' },
                    required: true,
                    ...desc(i18n, 'ultron.commands.ultron.arquivo'),
                  },
                ],
              },
              {
                type: 1,
                name: 'lista',
                name_localizations: { 'en-US': 'list' },
                ...desc(i18n, 'ultron.commands.ultron.lista'),
              },
              ...(['desativar', 'ativar'] as const).map((name) => ({
                type: 1,
                name,
                name_localizations: { 'en-US': { desativar: 'disable', ativar: 'enable' }[name] },
                ...desc(i18n, `ultron.commands.ultron.${name}`),
                options: [
                  {
                    type: 3,
                    name: 'inimigo',
                    name_localizations: { 'en-US': 'enemy' },
                    required: true,
                    autocomplete: true,
                    ...desc(i18n, 'ultron.commands.ultron.inimigo_opt'),
                  },
                ],
              })),
            ],
          },
          {
            type: 2,
            name: 'guerra',
            name_localizations: { 'en-US': 'war' },
            ...desc(i18n, 'ultron.commands.ultron.guerra'),
            options: [
              {
                type: 1,
                name: 'iniciar',
                name_localizations: { 'en-US': 'start' },
                ...desc(i18n, 'ultron.commands.ultron.guerra_iniciar'),
              },
              {
                type: 1,
                name: 'encerrar',
                name_localizations: { 'en-US': 'end' },
                ...desc(i18n, 'ultron.commands.ultron.guerra_encerrar'),
              },
              {
                type: 1,
                name: 'pontos',
                name_localizations: { 'en-US': 'points' },
                ...desc(i18n, 'ultron.commands.ultron.guerra_pontos'),
                options: [
                  {
                    type: 6,
                    name: 'membro',
                    name_localizations: { 'en-US': 'member' },
                    required: true,
                    ...desc(i18n, 'ultron.commands.ultron.guerra_membro'),
                  },
                  {
                    type: 4,
                    name: 'pontos',
                    name_localizations: { 'en-US': 'points' },
                    required: true,
                    min_value: -1000,
                    max_value: 1000,
                    ...desc(i18n, 'ultron.commands.ultron.guerra_valor'),
                  },
                  {
                    type: 3,
                    name: 'motivo',
                    name_localizations: { 'en-US': 'reason' },
                    required: true,
                    max_length: 200,
                    ...desc(i18n, 'ultron.commands.ultron.guerra_motivo'),
                  },
                ],
              },
            ],
          },
        ],
      },
      autocomplete: async (i, r) => {
        if (!(await ctx.isStaff(i))) return r.autocomplete([]);
        return s.imports.autocomplete(i, r);
      },
      execute: async (i, r) => {
        if (!(await ctx.isStaff(i)))
          return r.reply({
            persona: 'ultron',
            ephemeral: true,
            content: i18n.t('ultron.errors.not_staff', {}, await i18n.localeFor(i.userId)),
          });
        if (i.subcommand?.startsWith('evento ')) return evento(i, r);
        if (i.subcommand?.startsWith('guerra ')) return guerra(i, r);
        if (i.subcommand === 'status') return s.status.reply(i, r);
        if (i.subcommand === 'inimigo importar') return s.imports.import(i, r);
        if (i.subcommand === 'inimigo lista') return s.imports.list(i, r);
        if (i.subcommand === 'inimigo desativar') return s.imports.setActive(i, r, false);
        if (i.subcommand === 'inimigo ativar') return s.imports.setActive(i, r, true);
        return s.encounters.spawnCommand(i, r);
      },
    },
  ];
}
