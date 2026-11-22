import type { BotContext, I18n, IncomingInteraction, Responder, SlashCommandDefinition } from '@legion/core';
import { DIFFICULTIES, type JarvisConfig } from './config.js';
import { PERIODS } from './domain/periods.js';
import type { JarvisLeaderboard } from './leaderboard.js';
import type { JarvisServices } from './services.js';
import { TRIVIA_STATUSES } from './staff-trivia.js';
import type { JarvisTrivia } from './trivia.js';

const desc = (i18n: I18n, key: string) => ({
  description: i18n.t(key, {}, 'pt-BR').slice(0, 100),
  description_localizations: { 'en-US': i18n.t(key, {}, 'en').slice(0, 100) },
});

export function jarvisCommands(
  ctx: BotContext<JarvisConfig>,
  s: JarvisServices,
  trivia: JarvisTrivia,
  board: JarvisLeaderboard,
): SlashCommandDefinition[] {
  const { i18n } = ctx;
  const ui = trivia.ui;
  const staffOnly = async (i: IncomingInteraction, r: Responder) => {
    if (await ctx.isStaff(i)) return true;
    await r.reply(ui.text(ui.t('jarvis.errors.not_staff', {}, await i18n.localeFor(i.userId))));
    return false;
  };
  const choice = (value: string, key: string) => ({
    name: i18n.t(key, {}, 'pt-BR'),
    name_localizations: { 'en-US': i18n.t(key, {}, 'en') },
    value,
  });
  const categories = ctx.botConfig.trivia.categories.map((c) => choice(c, `jarvis.trivia.category.${c}`));

  return [
    {
      name: 'trivia',
      json: {
        name: 'trivia',
        ...desc(i18n, 'jarvis.commands.trivia.description'),
        options: [
          {
            type: 3,
            name: 'categoria',
            name_localizations: { 'en-US': 'category' },
            required: false,
            choices: categories,
            ...desc(i18n, 'jarvis.commands.trivia.categoria'),
          },
        ],
      },
      execute: (i, r) =>
        trivia.ask(i, r, typeof i.options?.categoria === 'string' ? i.options.categoria : null),
    },
    {
      name: 'ranking',
      json: {
        name: 'ranking',
        name_localizations: { 'en-US': 'leaderboard' },
        ...desc(i18n, 'jarvis.commands.ranking.description'),
        options: [
          {
            type: 3,
            name: 'periodo',
            name_localizations: { 'en-US': 'period' },
            required: false,
            choices: PERIODS.map((p) => choice(p, `jarvis.ranking.period.${p}`)),
            ...desc(i18n, 'jarvis.commands.ranking.periodo'),
          },
          {
            type: 3,
            name: 'faccao',
            name_localizations: { 'en-US': 'faction' },
            required: false,
            choices: ctx.config.factions.map((f) => choice(f.key, `cerebro.faction.${f.key}.name`)),
            ...desc(i18n, 'jarvis.commands.ranking.faccao'),
          },
        ],
      },
      execute: (i, r) => board.command(i, r),
    },
    {
      name: 'temporada',
      json: {
        name: 'temporada',
        name_localizations: { 'en-US': 'season' },
        ...desc(i18n, 'jarvis.commands.temporada.description'),
      },
      execute: async (i, r) => {
        const l = await i18n.localeFor(i.userId);
        await r.reply(await s.season.playerView(i.userId, l));
      },
    },
    {
      name: 'sequencia',
      json: {
        name: 'sequencia',
        name_localizations: { 'en-US': 'streak' },
        ...desc(i18n, 'jarvis.commands.sequencia.description'),
      },
      execute: async (i, r) => {
        const l = await i18n.localeFor(i.userId);
        const m = await trivia.registered(i, r, l);
        if (m) await r.reply(await board.streak(m.id, l));
      },
    },
    {
      name: 'missao',
      json: {
        name: 'missao',
        name_localizations: { 'en-US': 'mission' },
        ...desc(i18n, 'jarvis.commands.missao.description'),
        options: [
          {
            type: 1,
            name: 'lista',
            name_localizations: { 'en-US': 'list' },
            ...desc(i18n, 'jarvis.commands.missao.lista'),
          },
          {
            type: 1,
            name: 'iniciar',
            name_localizations: { 'en-US': 'start' },
            ...desc(i18n, 'jarvis.commands.missao.iniciar'),
            options: [
              {
                type: 3,
                name: 'missao',
                name_localizations: { 'en-US': 'mission' },
                required: true,
                autocomplete: true,
                ...desc(i18n, 'jarvis.commands.missao.missao'),
              },
            ],
          },
          {
            type: 1,
            name: 'abandonar',
            name_localizations: { 'en-US': 'abandon' },
            ...desc(i18n, 'jarvis.commands.missao.abandonar'),
          },
        ],
      },
      execute: (i, r) => {
        if (i.subcommand === 'iniciar') return s.missions.start(i, r, String(i.options?.missao ?? ''));
        if (i.subcommand === 'abandonar') return s.missions.abandon(i, r);
        return s.missions.list(i, r);
      },
      autocomplete: (i, r) => s.missions.autocomplete(i, r),
    },
    {
      name: 'campanha',
      json: {
        name: 'campanha',
        name_localizations: { 'en-US': 'campaign' },
        ...desc(i18n, 'jarvis.commands.campanha.description'),
        options: [
          {
            type: 3,
            name: 'campanha',
            name_localizations: { 'en-US': 'campaign' },
            required: false,
            autocomplete: true,
            ...desc(i18n, 'jarvis.commands.campanha.campanha'),
          },
        ],
      },
      execute: (i, r) => s.campaigns.command(i, r),
      autocomplete: (i, r) => s.campaigns.autocomplete(i, r),
    },
    {
      name: 'carteira',
      json: {
        name: 'carteira',
        name_localizations: { 'en-US': 'wallet' },
        ...desc(i18n, 'jarvis.commands.carteira.description'),
      },
      execute: (i, r) => s.walletUi.command(i, r),
    },
    {
      name: 'loja',
      json: {
        name: 'loja',
        name_localizations: { 'en-US': 'shop' },
        ...desc(i18n, 'jarvis.commands.loja.description'),
        options: [
          {
            type: 4,
            name: 'pagina',
            name_localizations: { 'en-US': 'page' },
            required: false,
            min_value: 1,
            max_value: 100,
            ...desc(i18n, 'jarvis.commands.loja.pagina'),
          },
        ],
      },
      execute: (i, r) => s.shop.command(i, r),
    },
    {
      name: 'inventario',
      json: {
        name: 'inventario',
        name_localizations: { 'en-US': 'inventory' },
        ...desc(i18n, 'jarvis.commands.inventario.description'),
      },
      execute: (i, r) => s.inventoryUi.command(i, r),
    },
    {
      name: 'jarvis',
      json: {
        name: 'jarvis',
        ...desc(i18n, 'jarvis.commands.jarvis.description'),
        default_member_permissions: '0',
        options: [
          {
            type: 1,
            name: 'xp',
            ...desc(i18n, 'jarvis.commands.jarvis.xp'),
            options: [
              {
                type: 6,
                name: 'membro',
                name_localizations: { 'en-US': 'member' },
                required: true,
                ...desc(i18n, 'jarvis.commands.jarvis.membro'),
              },
              {
                type: 4,
                name: 'quantidade',
                name_localizations: { 'en-US': 'amount' },
                required: true,
                min_value: -1000,
                max_value: 1000,
                ...desc(i18n, 'jarvis.commands.jarvis.quantidade'),
              },
              {
                type: 3,
                name: 'motivo',
                name_localizations: { 'en-US': 'reason' },
                required: true,
                max_length: 200,
                ...desc(i18n, 'jarvis.commands.jarvis.motivo'),
              },
            ],
          },
          {
            type: 2,
            name: 'trivia',
            ...desc(i18n, 'jarvis.commands.jarvis.trivia'),
            options: [
              {
                type: 1,
                name: 'recarregar',
                name_localizations: { 'en-US': 'reload' },
                ...desc(i18n, 'jarvis.commands.jarvis.recarregar'),
              },
              {
                type: 1,
                name: 'estatisticas',
                name_localizations: { 'en-US': 'stats' },
                ...desc(i18n, 'jarvis.commands.jarvis.estatisticas'),
              },
              {
                type: 1,
                name: 'nova',
                name_localizations: { 'en-US': 'new' },
                ...desc(i18n, 'jarvis.commands.jarvis.nova'),
                options: [
                  {
                    type: 3,
                    name: 'categoria',
                    name_localizations: { 'en-US': 'category' },
                    required: true,
                    choices: categories,
                    ...desc(i18n, 'jarvis.commands.trivia.categoria'),
                  },
                  {
                    type: 3,
                    name: 'dificuldade',
                    name_localizations: { 'en-US': 'difficulty' },
                    required: true,
                    choices: DIFFICULTIES.map((d) => choice(d, `jarvis.trivia.difficulty.${d}`)),
                    ...desc(i18n, 'jarvis.commands.jarvis.dificuldade'),
                  },
                  {
                    type: 3,
                    name: 'idioma',
                    name_localizations: { 'en-US': 'language' },
                    required: false,
                    choices: [
                      { name: 'Português (Brasil)', value: 'pt-BR' },
                      { name: 'English', value: 'en' },
                    ],
                    ...desc(i18n, 'jarvis.commands.jarvis.idioma'),
                  },
                ],
              },
              {
                type: 1,
                name: 'lista',
                name_localizations: { 'en-US': 'list' },
                ...desc(i18n, 'jarvis.commands.jarvis.lista'),
                options: [
                  {
                    type: 3,
                    name: 'status',
                    required: false,
                    choices: TRIVIA_STATUSES.map((st) => choice(st, `jarvis.staff_trivia.status.${st}`)),
                    ...desc(i18n, 'jarvis.commands.jarvis.status'),
                  },
                  {
                    type: 3,
                    name: 'categoria',
                    name_localizations: { 'en-US': 'category' },
                    required: false,
                    choices: categories,
                    ...desc(i18n, 'jarvis.commands.trivia.categoria'),
                  },
                  {
                    type: 6,
                    name: 'autor',
                    name_localizations: { 'en-US': 'author' },
                    required: false,
                    ...desc(i18n, 'jarvis.commands.jarvis.autor'),
                  },
                  {
                    type: 4,
                    name: 'pagina',
                    name_localizations: { 'en-US': 'page' },
                    required: false,
                    min_value: 1,
                    ...desc(i18n, 'jarvis.commands.jarvis.pagina'),
                  },
                ],
              },
              ...(['editar', 'desativar', 'ativar'] as const).map((name) => ({
                type: 1,
                name,
                name_localizations: {
                  'en-US': { editar: 'edit', desativar: 'disable', ativar: 'enable' }[name],
                },
                ...desc(i18n, `jarvis.commands.jarvis.${name}`),
                options: [
                  {
                    type: 3,
                    name: 'pergunta',
                    name_localizations: { 'en-US': 'question' },
                    required: true,
                    autocomplete: true,
                    ...desc(i18n, 'jarvis.commands.jarvis.pergunta'),
                  },
                ],
              })),
              {
                type: 1,
                name: 'exportar',
                name_localizations: { 'en-US': 'export' },
                ...desc(i18n, 'jarvis.commands.jarvis.exportar'),
              },
              {
                type: 1,
                name: 'importar',
                name_localizations: { 'en-US': 'import' },
                ...desc(i18n, 'jarvis.commands.jarvis.trivia_importar'),
                options: [
                  {
                    type: 11,
                    name: 'arquivo',
                    name_localizations: { 'en-US': 'file' },
                    required: true,
                    ...desc(i18n, 'jarvis.commands.jarvis.trivia_arquivo'),
                  },
                ],
              },
            ],
          },
          {
            type: 2,
            name: 'campanha',
            name_localizations: { 'en-US': 'campaign' },
            ...desc(i18n, 'jarvis.commands.jarvis.campanha'),
            options: [
              {
                type: 1,
                name: 'importar',
                name_localizations: { 'en-US': 'import' },
                ...desc(i18n, 'jarvis.commands.jarvis.campanha_importar'),
                options: [
                  {
                    type: 11,
                    name: 'arquivo',
                    name_localizations: { 'en-US': 'file' },
                    required: true,
                    ...desc(i18n, 'jarvis.commands.jarvis.campanha_arquivo'),
                  },
                ],
              },
            ],
          },
          {
            type: 2,
            name: 'missao',
            name_localizations: { 'en-US': 'mission' },
            ...desc(i18n, 'jarvis.commands.jarvis.missao'),
            options: [
              {
                type: 1,
                name: 'importar',
                name_localizations: { 'en-US': 'import' },
                ...desc(i18n, 'jarvis.commands.jarvis.importar'),
                options: [
                  {
                    type: 11,
                    name: 'arquivo',
                    name_localizations: { 'en-US': 'file' },
                    required: true,
                    ...desc(i18n, 'jarvis.commands.jarvis.arquivo'),
                  },
                ],
              },
              {
                type: 1,
                name: 'lista',
                name_localizations: { 'en-US': 'list' },
                ...desc(i18n, 'jarvis.commands.jarvis.missao_lista'),
              },
              ...(['desativar', 'ativar'] as const).map((name) => ({
                type: 1,
                name,
                name_localizations: { 'en-US': { desativar: 'disable', ativar: 'enable' }[name] },
                ...desc(i18n, `jarvis.commands.jarvis.missao_${name}`),
                options: [
                  {
                    type: 3,
                    name: 'missao',
                    name_localizations: { 'en-US': 'mission' },
                    required: true,
                    autocomplete: true,
                    ...desc(i18n, 'jarvis.commands.missao.missao'),
                  },
                ],
              })),
            ],
          },
          {
            type: 2,
            name: 'creditos',
            name_localizations: { 'en-US': 'credits' },
            ...desc(i18n, 'jarvis.commands.jarvis.creditos'),
            options: [
              {
                type: 1,
                name: 'dar',
                name_localizations: { 'en-US': 'give' },
                ...desc(i18n, 'jarvis.commands.jarvis.creditos_dar'),
                options: [
                  {
                    type: 6,
                    name: 'membro',
                    name_localizations: { 'en-US': 'member' },
                    required: true,
                    ...desc(i18n, 'jarvis.commands.jarvis.membro'),
                  },
                  {
                    type: 4,
                    name: 'quantidade',
                    name_localizations: { 'en-US': 'amount' },
                    required: true,
                    min_value: -10000,
                    max_value: 10000,
                    ...desc(i18n, 'jarvis.commands.jarvis.creditos_quantidade'),
                  },
                  {
                    type: 3,
                    name: 'motivo',
                    name_localizations: { 'en-US': 'reason' },
                    required: true,
                    max_length: 200,
                    ...desc(i18n, 'jarvis.commands.jarvis.motivo'),
                  },
                ],
              },
            ],
          },
          {
            type: 2,
            name: 'item',
            ...desc(i18n, 'jarvis.commands.jarvis.item'),
            options: [
              {
                type: 1,
                name: 'dar',
                name_localizations: { 'en-US': 'give' },
                ...desc(i18n, 'jarvis.commands.jarvis.item_dar'),
                options: [
                  {
                    type: 6,
                    name: 'membro',
                    name_localizations: { 'en-US': 'member' },
                    required: true,
                    ...desc(i18n, 'jarvis.commands.jarvis.membro'),
                  },
                  {
                    type: 3,
                    name: 'item',
                    required: true,
                    autocomplete: true,
                    max_length: 48,
                    ...desc(i18n, 'jarvis.commands.jarvis.item_item'),
                  },
                  {
                    type: 3,
                    name: 'motivo',
                    name_localizations: { 'en-US': 'reason' },
                    required: false,
                    max_length: 200,
                    ...desc(i18n, 'jarvis.commands.jarvis.item_motivo'),
                  },
                ],
              },
              {
                type: 1,
                name: 'importar',
                name_localizations: { 'en-US': 'import' },
                ...desc(i18n, 'jarvis.commands.jarvis.item_importar'),
                options: [
                  {
                    type: 11,
                    name: 'arquivo',
                    name_localizations: { 'en-US': 'file' },
                    required: true,
                    ...desc(i18n, 'jarvis.commands.jarvis.item_arquivo'),
                  },
                ],
              },
              {
                type: 1,
                name: 'exportar',
                name_localizations: { 'en-US': 'export' },
                ...desc(i18n, 'jarvis.commands.jarvis.item_exportar'),
              },
              ...(['desativar', 'ativar'] as const).map((name) => ({
                type: 1,
                name,
                name_localizations: { 'en-US': { desativar: 'disable', ativar: 'enable' }[name] },
                ...desc(i18n, `jarvis.commands.jarvis.item_${name}`),
                options: [
                  {
                    type: 3,
                    name: 'item',
                    required: true,
                    autocomplete: true,
                    max_length: 48,
                    ...desc(i18n, 'jarvis.commands.jarvis.item_item'),
                  },
                ],
              })),
            ],
          },
          {
            type: 2,
            name: 'pack',
            name_localizations: { 'en-US': 'pack' },
            ...desc(i18n, 'jarvis.commands.jarvis.pack'),
            options: [
              {
                type: 1,
                name: 'importar',
                name_localizations: { 'en-US': 'import' },
                ...desc(i18n, 'jarvis.commands.jarvis.pack_importar'),
                options: [
                  {
                    type: 11,
                    name: 'arquivo',
                    name_localizations: { 'en-US': 'file' },
                    required: true,
                    ...desc(i18n, 'jarvis.commands.jarvis.pack_arquivo'),
                  },
                ],
              },
              {
                type: 1,
                name: 'lista',
                name_localizations: { 'en-US': 'list' },
                ...desc(i18n, 'jarvis.commands.jarvis.pack_lista'),
              },
              {
                type: 1,
                name: 'remover',
                name_localizations: { 'en-US': 'remove' },
                ...desc(i18n, 'jarvis.commands.jarvis.pack_remover'),
                options: [
                  {
                    type: 3,
                    name: 'id',
                    required: true,
                    max_length: 48,
                    ...desc(i18n, 'jarvis.commands.jarvis.pack_id'),
                  },
                ],
              },
            ],
          },
          {
            type: 1,
            name: 'recalcular',
            name_localizations: { 'en-US': 'recalculate' },
            ...desc(i18n, 'jarvis.commands.jarvis.recalcular'),
            options: [
              {
                type: 6,
                name: 'membro',
                name_localizations: { 'en-US': 'member' },
                required: true,
                ...desc(i18n, 'jarvis.commands.jarvis.membro'),
              },
            ],
          },
          {
            type: 2,
            name: 'temporada',
            name_localizations: { 'en-US': 'season' },
            ...desc(i18n, 'jarvis.commands.jarvis.temporada'),
            options: [
              {
                type: 1,
                name: 'iniciar',
                name_localizations: { 'en-US': 'start' },
                ...desc(i18n, 'jarvis.commands.jarvis.temporada_iniciar'),
              },
              {
                type: 1,
                name: 'encerrar',
                name_localizations: { 'en-US': 'end' },
                ...desc(i18n, 'jarvis.commands.jarvis.temporada_encerrar'),
              },
            ],
          },
        ],
      },
      autocomplete: async (i, r) => {
        if (!(await ctx.isStaff(i))) return r.autocomplete([]);
        if (i.focused?.name === 'missao') return s.imports.autocomplete(i, r);
        if (i.focused?.name === 'item') return s.inventoryUi.autocomplete(i, r);
        return s.staffTrivia.autocomplete(i, r);
      },
      execute: async (i, r) => {
        if (!(await staffOnly(i, r))) return;
        const l = await i18n.localeFor(i.userId);
        const sub = i.subcommand;
        if (sub === 'xp') return staffXp(ctx, s, i, r, l);
        if (sub === 'temporada iniciar') return staffSeasonStart(ctx, s, r, l);
        if (sub === 'temporada encerrar') return staffSeasonEnd(ctx, s, r, l);
        if (sub === 'item dar') return s.inventoryUi.staffGrant(i, r, l);
        if (sub === 'item importar') return s.itemImports.import(i, r);
        if (sub === 'item exportar') return s.itemImports.export(i, r);
        if (sub === 'item desativar') return s.itemImports.setActive(i, r, false);
        if (sub === 'item ativar') return s.itemImports.setActive(i, r, true);
        if (sub === 'pack importar') return s.packImports.import(i, r);
        if (sub === 'pack lista') return s.packImports.list(i, r);
        if (sub === 'pack remover') return s.packImports.remove(i, r);
        if (sub === 'creditos dar') return s.walletUi.staffGive(i, r, l);
        if (sub === 'trivia recarregar') {
          const res = await trivia.reload();
          const { errors, ...counts } = res;
          const lines = [ui.t('jarvis.staff.reload', counts, l)];
          if (errors.length) {
            lines.push(
              '',
              ui.t('jarvis.staff.reload_errors', { count: errors.length }, l),
              ...errors.slice(0, 15).map((e) => `• ${e}`),
            );
            lines.push(ui.t('jarvis.staff.reload_errors_kept', {}, l));
          }
          return r.reply(ui.text(lines.join('\n').slice(0, 1900)));
        }
        if (sub === 'trivia estatisticas') return r.reply(await staffStats(ctx, s, trivia, l));
        if (sub === 'trivia nova') return s.staffTrivia.openCreate(i, r);
        if (sub === 'trivia lista') return s.staffTrivia.list(i, r);
        if (sub === 'trivia editar') return s.staffTrivia.openEdit(i, r);
        if (sub === 'trivia desativar') return s.staffTrivia.setActive(i, r, false);
        if (sub === 'trivia ativar') return s.staffTrivia.setActive(i, r, true);
        if (sub === 'trivia exportar') return s.staffTrivia.export(i, r);
        if (sub === 'trivia importar') return s.triviaImports.import(i, r);
        if (sub === 'missao importar') return s.imports.import(i, r);
        if (sub === 'campanha importar') return s.campaigns.import(i, r);
        if (sub === 'missao lista') return s.imports.list(i, r);
        if (sub === 'missao desativar') return s.imports.setActive(i, r, false);
        if (sub === 'missao ativar') return s.imports.setActive(i, r, true);
        if (sub === 'recalcular') {
          const member = await ctx.read.members.getByDiscordId(String(i.options?.membro ?? ''));
          if (!member) return r.reply(ui.text(ui.t('jarvis.errors.unknown_member', {}, l)));
          const { before, after } = await s.xp.recalculate(member.id);
          return r.reply(
            ui.text(
              ui.t(
                'jarvis.staff.recalc',
                {
                  member: `<@${member.discordUserId}>`,
                  before: before?.xp ?? 0,
                  after: after.xp,
                  level: after.level,
                  rank: after.rank,
                },
                l,
              ),
            ),
          );
        }
      },
    },
  ];
}

async function staffSeasonStart(
  ctx: BotContext<JarvisConfig>,
  s: JarvisServices,
  r: Responder,
  l: 'pt-BR' | 'en',
) {
  const t = (k: string, v: Record<string, string | number> = {}) => ctx.i18n.t(k, v, l);
  const res = await s.season.staffStart();
  if (res === 'disabled')
    return r.reply({ persona: 'jarvis', ephemeral: true, content: t('jarvis.season.disabled') });
  if (res === 'active')
    return r.reply({ persona: 'jarvis', ephemeral: true, content: t('jarvis.season.already_active') });
  const active = await s.season.repo.findStatus('active');
  return r.reply({
    persona: 'jarvis',
    ephemeral: true,
    content: t('jarvis.season.started', { at: `<t:${unix(active?.endsAt ?? '')}:F>` }),
  });
}

async function staffSeasonEnd(
  ctx: BotContext<JarvisConfig>,
  s: JarvisServices,
  r: Responder,
  l: 'pt-BR' | 'en',
) {
  const t = (k: string, v: Record<string, string | number> = {}) => ctx.i18n.t(k, v, l);
  const res = await s.season.staffEnd();
  if (res === 'disabled')
    return r.reply({ persona: 'jarvis', ephemeral: true, content: t('jarvis.season.disabled') });
  if (res === 'none')
    return r.reply({ persona: 'jarvis', ephemeral: true, content: t('jarvis.season.none') });
  return r.reply({ persona: 'jarvis', ephemeral: true, content: t('jarvis.season.ended') });
}

const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

async function staffXp(
  ctx: BotContext<JarvisConfig>,
  s: JarvisServices,
  i: IncomingInteraction,
  r: Responder,
  l: 'pt-BR' | 'en',
) {
  const t = (k: string, v: Record<string, string | number> = {}) => ctx.i18n.t(k, v, l);
  const amount = Number(i.options?.quantidade);
  const reason = String(i.options?.motivo ?? '').trim();
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1000)
    return r.reply({ persona: 'jarvis', ephemeral: true, content: t('jarvis.staff.xp_invalid') });
  const member = await ctx.read.members.getByDiscordId(String(i.options?.membro ?? ''));
  if (!member)
    return r.reply({ persona: 'jarvis', ephemeral: true, content: t('jarvis.errors.unknown_member') });
  const res = await ctx.bus.transaction((tx) =>
    s.xp.award(tx, {
      memberId: member.id,
      amount,
      reason: 'admin_adjust',
      note: `${reason} (por ${i.userId})`.slice(0, 300),
      sourceKey: `admin:${i.id}`,
    }),
  );
  ctx.log.info({ staff: i.userId, memberId: member.id, amount, reason }, 'staff XP adjustment');
  const p = res.progress;
  return r.reply({
    persona: 'jarvis',
    ephemeral: true,
    content: t('jarvis.staff.xp_done', {
      amount: amount > 0 ? `+${amount}` : String(amount),
      member: `<@${member.discordUserId}>`,
      reason,
      total: p?.xp ?? 0,
      level: p?.level ?? 1,
      rank: p?.rank ?? 'recruta',
    }),
  });
}

async function staffStats(
  ctx: BotContext<JarvisConfig>,
  s: JarvisServices,
  trivia: JarvisTrivia,
  l: 'pt-BR' | 'en',
) {
  const t = (k: string, v: Record<string, string | number> = {}) => ctx.i18n.t(k, v, l);
  const questions = (await s.repo.allQuestions()).filter((q) => q.active === 1);
  const perCat = ctx.botConfig.trivia.categories.map(
    (c) => `${trivia.ui.category(c, l)}: ${questions.filter((q) => q.category === c).length}`,
  );
  const acc = new Map<string, { n: number; ok: number }>();
  for (const a of await s.repo.answeredAttempts()) {
    const e = acc.get(a.questionId) ?? { n: 0, ok: 0 };
    e.n++;
    if (a.correct) e.ok++;
    acc.set(a.questionId, e);
  }
  const lowest = [...acc.entries()]
    .filter(([, e]) => e.n >= 3)
    .map(([id, e]) => ({ id, n: e.n, rate: Math.round((100 * e.ok) / e.n) }))
    .sort((a, b) => a.rate - b.rate || b.n - a.n)
    .slice(0, 5)
    .map((x) => t('jarvis.staff.stats_lowest_line', x));
  return {
    persona: 'jarvis' as const,
    ephemeral: true,
    embeds: [
      {
        title: t('jarvis.staff.stats_title'),
        fields: [
          {
            name: t('jarvis.staff.stats_per_category'),
            value: perCat.join('\n') || t('jarvis.staff.stats_none'),
          },
          { name: t('jarvis.staff.stats_lowest'), value: lowest.join('\n') || t('jarvis.staff.stats_none') },
          { name: t('jarvis.staff.stats_today'), value: String(await trivia.attemptsToday()) },
        ],
      },
    ],
  };
}
