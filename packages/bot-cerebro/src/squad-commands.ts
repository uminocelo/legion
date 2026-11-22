import type {
  ActionSpec,
  BotContext,
  ComponentDefinition,
  I18n,
  IncomingInteraction,
  PanelSpec,
  Responder,
  SlashCommandDefinition,
} from '@legion/core';
import { customId, normalizeName } from '@legion/core';
import type { CerebroConfig } from './config.js';
import type { CerebroFlow } from './flow.js';
import { renderSquadOutcome, squadText } from './squads.js';
import { V } from './ui.js';

const desc = (i18n: I18n, key: string) => ({
  description: i18n.t(key, {}, 'pt-BR').slice(0, 100),
  description_localizations: { 'en-US': i18n.t(key, {}, 'en').slice(0, 100) },
});

async function say(
  ctx: BotContext<CerebroConfig>,
  flow: CerebroFlow,
  i: IncomingInteraction,
  r: Responder,
  outcome: { ok: boolean; key: string; vars?: Record<string, string | number> },
) {
  const locale = await ctx.i18n.localeFor(i.userId);
  await r.reply(flow.ui.text(renderSquadOutcome(ctx.i18n, outcome, locale)));
}

async function staffOrRefuse(
  ctx: BotContext<CerebroConfig>,
  flow: CerebroFlow,
  i: IncomingInteraction,
  r: Responder,
) {
  if (await ctx.isStaff(i)) return true;
  const locale = await ctx.i18n.localeFor(i.userId);
  await r.reply(flow.ui.text(ctx.i18n.t('cerebro.errors.not_staff', {}, locale)));
  return false;
}

/** `/esquadrao criar|sair|ver`. */
export function esquadraoCommand(ctx: BotContext<CerebroConfig>, flow: CerebroFlow): SlashCommandDefinition {
  const { i18n } = ctx;
  return {
    name: 'esquadrao',
    json: {
      name: 'esquadrao',
      name_localizations: { 'en-US': 'squad' },
      ...desc(i18n, 'cerebro.commands.esquadrao.description'),
      options: [
        {
          type: 1,
          name: 'criar',
          name_localizations: { 'en-US': 'create' },
          ...desc(i18n, 'cerebro.commands.esquadrao.criar'),
          options: [
            {
              type: 3,
              name: 'nome',
              name_localizations: { 'en-US': 'name' },
              required: true,
              min_length: 3,
              max_length: 32,
              ...desc(i18n, 'cerebro.commands.esquadrao.nome'),
            },
            {
              type: 3,
              name: 'base',
              name_localizations: { 'en-US': 'base' },
              required: true,
              autocomplete: true,
              ...desc(i18n, 'cerebro.commands.esquadrao.base'),
            },
          ],
        },
        {
          type: 1,
          name: 'entrar',
          name_localizations: { 'en-US': 'join' },
          ...desc(i18n, 'cerebro.commands.esquadrao.entrar'),
          options: [
            {
              type: 3,
              name: 'codigo',
              name_localizations: { 'en-US': 'code' },
              required: true,
              min_length: 6,
              max_length: 6,
              ...desc(i18n, 'cerebro.commands.esquadrao.codigo'),
            },
          ],
        },
        {
          type: 1,
          name: 'sair',
          name_localizations: { 'en-US': 'leave' },
          ...desc(i18n, 'cerebro.commands.esquadrao.sair'),
        },
        {
          type: 1,
          name: 'ver',
          name_localizations: { 'en-US': 'view' },
          ...desc(i18n, 'cerebro.commands.esquadrao.ver'),
          options: [
            {
              type: 3,
              name: 'nome',
              name_localizations: { 'en-US': 'name' },
              required: false,
              autocomplete: true,
              ...desc(i18n, 'cerebro.commands.esquadrao.nome_opt'),
            },
          ],
        },
      ],
    },
    autocomplete: (i, r) => squadAutocomplete(ctx, flow, i, r, false),
    execute: async (i, r) => {
      if (i.subcommand === 'criar') {
        return say(
          ctx,
          flow,
          i,
          r,
          await flow.squads.request({
            founderDiscordId: i.userId,
            name: String(i.options?.nome ?? ''),
            base: String(i.options?.base ?? ''),
            isStaff: await ctx.isStaff(i),
            memberRoleIds: i.memberRoleIds,
          }),
        );
      }
      if (i.subcommand === 'entrar')
        return say(
          ctx,
          flow,
          i,
          r,
          await flow.squads.join({
            discordUserId: i.userId,
            code: String(i.options?.codigo ?? ''),
            via: 'code',
          }),
        );
      if (i.subcommand === 'sair')
        return say(ctx, flow, i, r, await flow.squads.leave({ discordUserId: i.userId }));
      return r.reply(await viewMessage(ctx, flow, i));
    },
  };
}

/** `/cerebro esquadrao` group (type 2). */
export function cerebroSquadGroup(i18n: I18n): Record<string, unknown> {
  const squadOpt = {
    type: 3,
    name: 'esquadrao',
    name_localizations: { 'en-US': 'squad' },
    required: true,
    autocomplete: true,
    ...desc(i18n, 'cerebro.commands.cerebro.esquadrao_opt'),
  };
  const reason = {
    type: 3,
    name: 'motivo',
    name_localizations: { 'en-US': 'reason' },
    required: true,
    max_length: 200,
    ...desc(i18n, 'cerebro.commands.cerebro.motivo'),
  };
  return {
    type: 2,
    name: 'esquadrao',
    name_localizations: { 'en-US': 'squad' },
    ...desc(i18n, 'cerebro.commands.cerebro.esquadrao'),
    options: [
      {
        type: 1,
        name: 'aprovar',
        name_localizations: { 'en-US': 'approve' },
        ...desc(i18n, 'cerebro.commands.cerebro.aprovar'),
        options: [squadOpt],
      },
      {
        type: 1,
        name: 'recusar',
        name_localizations: { 'en-US': 'refuse' },
        ...desc(i18n, 'cerebro.commands.cerebro.recusar'),
        options: [squadOpt, reason],
      },
      {
        type: 1,
        name: 'arquivar',
        name_localizations: { 'en-US': 'archive' },
        ...desc(i18n, 'cerebro.commands.cerebro.arquivar'),
        options: [squadOpt, reason],
      },
    ],
  };
}

export async function runCerebroSquad(
  ctx: BotContext<CerebroConfig>,
  flow: CerebroFlow,
  i: IncomingInteraction,
  r: Responder,
): Promise<void> {
  const squadId = (await flow.squads.resolve(String(i.options?.esquadrao ?? '')))?.id ?? '';
  const actorId = i.userId;
  const source = 'command' as const;
  if (i.subcommand === 'esquadrao aprovar')
    return say(ctx, flow, i, r, await flow.squads.decide({ squadId, approve: true, actorId, source }));
  if (i.subcommand === 'esquadrao recusar')
    return say(
      ctx,
      flow,
      i,
      r,
      await flow.squads.decide({
        squadId,
        approve: false,
        reason: String(i.options?.motivo ?? ''),
        actorId,
        source,
      }),
    );
  return say(
    ctx,
    flow,
    i,
    r,
    await flow.squads.archive({ squadId, reason: String(i.options?.motivo ?? ''), actorId, source }),
  );
}

export function squadAutocomplete(
  ctx: BotContext<CerebroConfig>,
  flow: CerebroFlow,
  i: IncomingInteraction,
  r: Responder,
  staff: boolean,
): Promise<void> {
  return (async () => {
    if (staff && !(await ctx.isStaff(i))) return r.autocomplete([]);
    const focused = i.focused?.name;
    const query = i.focused?.value ?? '';
    if (focused === 'base') {
      const q = normalizeName(query);
      const choices = ctx.config.factions
        .filter((f) => f.key !== 'independent')
        .filter(
          (f) =>
            !q || normalizeName(f.key).includes(q) || normalizeName(flow.ui.factionLabel(f.key)).includes(q),
        )
        .slice(0, 25)
        .map((f) => ({ name: flow.ui.factionLabel(f.key).slice(0, 100), value: f.key }));
      return r.autocomplete(choices);
    }
    if (focused !== 'nome' && focused !== 'esquadrao') return r.autocomplete([]);
    const statuses =
      i.subcommand === 'esquadrao arquivar'
        ? ['active']
        : i.subcommand === 'esquadrao aprovar' || i.subcommand === 'esquadrao recusar'
          ? ['requested']
          : ['requested', 'active'];
    return r.autocomplete(await flow.squads.choices(query, statuses));
  })();
}

async function viewMessage(ctx: BotContext<CerebroConfig>, flow: CerebroFlow, i: IncomingInteraction) {
  const locale = await ctx.i18n.localeFor(i.userId);
  const text = (key: string, vars?: Record<string, string | number>) =>
    flow.ui.text(squadText(ctx.i18n, key, vars, locale));
  if (!ctx.config.squads.enabled) return text('squads_disabled');
  const token = String(i.options?.nome ?? '').trim();
  const squad = token
    ? await flow.squads.resolve(token)
    : ((await flow.squads.membershipOf(i.userId))?.squad ?? null);
  if (!squad) return text(token ? 'view_missing' : 'view_none', token ? { name: token } : undefined);
  const founder = await flow.repo.memberById(squad.founderMemberId);
  const mutant = founder ? await flow.repo.mutantByMemberId(founder.id) : null;
  const count = await flow.squads.memberCount(squad.id);
  let description = squadText(
    ctx.i18n,
    'view_line',
    {
      team: flow.ui.factionLabel(squad.baseFaction, locale),
      leader: mutant?.codename ?? '—',
      count,
      max: ctx.config.squads.maxMembers,
    },
    locale,
  );
  const mine = await flow.squads.membershipOf(i.userId);
  const isLeader = Boolean(mine && mine.squad.id === squad.id && squad.founderMemberId === mine.member.id);
  const staff = await ctx.isStaff(i);
  const shown = isLeader || staff ? await flow.squads.repairInvite(squad) : squad;
  if ((isLeader || staff) && shown.inviteCode && shown.code) {
    description += `\n${squadText(
      ctx.i18n,
      'view_secret',
      { url: `https://discord.gg/${shown.inviteCode}`, code: shown.code },
      locale,
    )}`;
  }
  return { persona: 'cerebro' as const, ephemeral: true, embeds: [{ title: squad.name, description }] };
}

export function squadComponents(ctx: BotContext<CerebroConfig>, flow: CerebroFlow): ComponentDefinition[] {
  return [
    { action: 'squad-join', version: V, handle: (i, r) => flow.acceptSquadHint(i, r) },
    { action: 'squad-skip', version: V, handle: (i, r) => flow.skipSquad(i, r) },
    { action: 'squad-code', version: V, handle: (i, r) => flow.askSquadCode(i, r) },
    { action: 'squad-code-modal', version: V, handle: (i, r) => flow.submitSquadCode(i, r) },
    {
      action: 'squad-approve',
      version: V,
      handle: async (i, r, [squadId]) => {
        if (!(await staffOrRefuse(ctx, flow, i, r))) return;
        await say(
          ctx,
          flow,
          i,
          r,
          await flow.squads.decide({
            squadId: squadId ?? '',
            approve: true,
            actorId: i.userId,
            source: 'command',
          }),
        );
      },
    },
    {
      action: 'squad-refuse',
      version: V,
      handle: async (i, r, [squadId]) => {
        if (!(await staffOrRefuse(ctx, flow, i, r))) return;
        const locale = await ctx.i18n.localeFor(i.userId);
        await r.showModal({
          customId: customId('cerebro', V, 'squad-refuse-modal', squadId ?? ''),
          title: squadText(ctx.i18n, 'modal_title', {}, locale).slice(0, 45),
          inputs: [
            {
              customId: 'motivo',
              label: squadText(ctx.i18n, 'modal_reason', {}, locale).slice(0, 45),
              style: 'paragraph',
              minLength: 1,
              maxLength: 200,
              required: true,
            },
          ],
        });
      },
    },
    {
      action: 'squad-refuse-modal',
      version: V,
      handle: async (i, r, [squadId]) => {
        if (!(await staffOrRefuse(ctx, flow, i, r))) return;
        await say(
          ctx,
          flow,
          i,
          r,
          await flow.squads.decide({
            squadId: squadId ?? '',
            approve: false,
            reason: i.fields?.motivo ?? '',
            actorId: i.userId,
            source: 'command',
          }),
        );
      },
    },
  ];
}

/** Staff panel `cerebro/squads`. */
export function squadPanels(ctx: BotContext<CerebroConfig>, flow: CerebroFlow): PanelSpec[] {
  const t = (key: string) => ctx.i18n.t(`cerebro.squads.${key}`, {}, ctx.config.locale);
  const when = () =>
    new Intl.DateTimeFormat(ctx.config.locale, {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: ctx.config.timezone,
    });
  return [
    {
      id: 'squads',
      titleKey: 'cerebro.squads.dash_title',
      render: async () => {
        const rows = (await flow.squads.list()).slice(0, 40);
        const body = [];
        for (const row of rows) {
          const founder = await flow.repo.memberById(row.founderMemberId);
          const mutant = founder ? await flow.repo.mutantByMemberId(founder.id) : null;
          const statusKey = `status_${row.status}`;
          body.push([
            row.name,
            flow.ui.factionLabel(row.baseFaction, ctx.config.locale),
            mutant?.codename ?? '—',
            `${await flow.squads.memberCount(row.id)}/${ctx.config.squads.maxMembers}`,
            t(statusKey) === `cerebro.squads.${statusKey}` ? row.status : t(statusKey),
            when().format(new Date(row.requestedAt)),
          ]);
        }
        return {
          kind: 'table' as const,
          columns: [
            t('dash_name'),
            t('dash_base'),
            t('dash_leader'),
            t('dash_members'),
            t('dash_status'),
            t('dash_requested'),
          ],
          rows: body,
        };
      },
    },
  ];
}

/** Same decisions and messages as `/cerebro esquadrao`. */
export function squadActions(ctx: BotContext<CerebroConfig>, flow: CerebroFlow): ActionSpec[] {
  const sayAction = (outcome: { ok: boolean; key: string; vars?: Record<string, string | number> }) => ({
    ok: outcome.ok,
    message: renderSquadOutcome(ctx.i18n, outcome, ctx.config.locale),
  });
  const squadField = {
    name: 'squad',
    type: 'text' as const,
    labelKey: 'cerebro.squads.dash_squad',
    required: true,
    min: 1,
    max: 40,
  };
  return [
    {
      id: 'squad-approve',
      titleKey: 'cerebro.squads.dash_approve',
      fields: [squadField],
      run: async (input, actor) =>
        sayAction(
          await flow.squads.decide({
            squadId: String(input.squad ?? ''),
            approve: true,
            actorId: actor.discordUserId,
            source: 'dashboard',
          }),
        ),
    },
    {
      id: 'squad-refuse',
      titleKey: 'cerebro.squads.dash_refuse',
      fields: [
        squadField,
        {
          name: 'reason',
          type: 'text',
          labelKey: 'cerebro.squads.dash_reason',
          required: true,
          min: 1,
          max: 200,
        },
      ],
      run: async (input, actor) =>
        sayAction(
          await flow.squads.decide({
            squadId: String(input.squad ?? ''),
            approve: false,
            reason: String(input.reason ?? ''),
            actorId: actor.discordUserId,
            source: 'dashboard',
          }),
        ),
    },
  ];
}
