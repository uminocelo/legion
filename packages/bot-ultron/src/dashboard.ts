import type { ActionSpec, BotContext, FieldSpec, PanelSpec } from '@legion/core';
import { and, desc, eq, gte, inArray, or } from 'drizzle-orm';
import type { UltronConfig } from './config.js';
import { ultronTables } from './db/tables.js';
import { invasionSize, THREAT_MAX, threatBand } from './domain/threat.js';
import type { UltronServices } from './services.js';
import {
  cancelEvent,
  type EventKind,
  endWar,
  type StaffOutcome,
  scheduleEvent,
  setThreat,
  startWar,
} from './staff-actions.js';

const DAY_MS = 86_400_000;

/** Staff dashboard panels of ULTRON (US-20): world events, war (scoreboard + history) and threat. */
export function ultronPanels(ctx: BotContext<UltronConfig>, s: UltronServices): PanelSpec[] {
  const t = (k: string, v: Record<string, string | number> = {}) => ctx.i18n.t(`ultron.dashboard.${k}`, v);
  const tables = () => ultronTables(ctx.db);
  const guild = ctx.guildId;
  const when = () =>
    new Intl.DateTimeFormat(ctx.config.locale, {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: ctx.config.timezone,
    });
  const fmt = (iso: string) => when().format(new Date(iso));

  return [
    {
      id: 'events',
      titleKey: 'ultron.dashboard.events',
      render: async () => {
        const e = tables().ultronWorldEvents;
        const since = new Date(ctx.clock.now().getTime() - 7 * DAY_MS).toISOString();
        const rows = await ctx.db.orm
          .select()
          .from(e)
          .where(
            and(
              eq(e.guildId, guild),
              or(inArray(e.status, ['scheduled', 'announced', 'active']), gte(e.endsAt, since)),
            ),
          )
          .orderBy(desc(e.startsAt))
          .limit(30);
        return {
          kind: 'table',
          columns: [t('kind'), t('status'), t('starts'), t('ends'), t('hp'), t('wave'), t('outcome')],
          rows: rows.map((r) => [
            ctx.i18n.t(`ultron.kinds.${r.kind}`),
            t(`status_${r.status}`),
            fmt(r.startsAt),
            fmt(r.endsAt),
            r.maxHp ? `${r.hp ?? 0} / ${r.maxHp}` : '—',
            `${r.wave} / ${r.waves}`,
            r.outcome ? t(`outcome_${r.outcome}`) : '—',
          ]),
        };
      },
    },
    {
      id: 'war',
      titleKey: 'ultron.dashboard.war',
      render: async () => {
        const war = (await s.warRepo.findStatus('active')) ?? (await s.warRepo.latestEnded());
        if (!war) return { kind: 'stats', items: [{ labelKey: 'ultron.dashboard.no_war', value: '—' }] };
        const scores = (await s.warRepo.scores(war.id)).sort((a, b) => b.points - a.points);
        return {
          kind: 'table',
          columns: [t('faction'), t('points'), t('members_scored')],
          rows: [
            [t(war.status === 'active' ? 'war_active' : 'war_last', { ends: fmt(war.endsAt) }), '', ''],
            ...scores.map((x) => [s.war.factionLabel(x.faction), x.points, x.members]),
          ],
        };
      },
    },
    {
      id: 'war-history',
      titleKey: 'ultron.dashboard.war_history',
      render: async () => {
        const w = tables().ultronWars;
        const rows = await ctx.db.orm
          .select()
          .from(w)
          .where(and(eq(w.guildId, guild), eq(w.status, 'ended')))
          .orderBy(desc(w.endsAt))
          .limit(12);
        const label = (json: string | null) => {
          try {
            const keys = JSON.parse(json ?? '[]') as string[];
            return keys.length ? keys.map((k) => s.war.factionLabel(k)).join(', ') : t('no_winner');
          } catch {
            return t('no_winner');
          }
        };
        return {
          kind: 'table',
          columns: [t('starts'), t('ends'), t('winners')],
          rows: rows.map((r) => [fmt(r.startsAt), fmt(r.endsAt), label(r.winners)]),
        };
      },
    },
    {
      id: 'threat',
      titleKey: 'ultron.dashboard.threat',
      render: async () => {
        const th = tables().ultronThreat;
        const [row] = await ctx.db.orm.select().from(th).where(eq(th.guildId, guild)).limit(1);
        const level = row?.level ?? 0;
        const next = invasionSize(level);
        return {
          kind: 'stats',
          items: [
            { labelKey: 'ultron.dashboard.threat_level', value: `${level} / ${THREAT_MAX}` },
            {
              labelKey: 'ultron.dashboard.threat_band',
              value: ctx.i18n.t(`ultron.threat.band_${threatBand(level)}`),
            },
            { labelKey: 'ultron.dashboard.next_waves', value: next.waves },
            { labelKey: 'ultron.dashboard.next_difficulty', value: next.difficulty },
          ],
        };
      },
    },
  ];
}

/** Staff dashboard actions of ULTRON (US-21): same functions and messages as `/ultron`. */
export function ultronActions(ctx: BotContext<UltronConfig>, s: UltronServices): ActionSpec[] {
  const l = ctx.config.locale;
  const say = (o: StaffOutcome) => ({ ok: o.ok, message: ctx.i18n.t(o.key, o.vars ?? {}, l) });
  const k = (x: string) => `ultron.dashboard.actions.${x}`;
  const kind = (required: boolean): FieldSpec => ({
    name: 'kind',
    type: 'select',
    labelKey: k('kind'),
    required,
    options: (['invasion', 'raid'] as const).map((v) => ({ value: v, labelKey: `ultron.kinds.${v}` })),
  });
  const kindOf = (v: unknown) => (v === 'invasion' || v === 'raid' ? { kind: v as EventKind } : {});
  return [
    {
      id: 'event-schedule',
      titleKey: k('event_schedule'),
      fields: [kind(true), { name: 'when', type: 'datetime', labelKey: k('when'), required: true }],
      run: async (input, actor) =>
        say(
          await scheduleEvent(ctx, s, {
            ...kindOf(input.kind),
            startsAt: typeof input.when === 'string' ? new Date(input.when) : null,
            now: false,
            actorId: actor.discordUserId,
          }),
        ),
    },
    {
      id: 'event-start',
      titleKey: k('event_start'),
      fields: [kind(true)],
      run: async (input, actor) =>
        say(
          await scheduleEvent(ctx, s, {
            ...kindOf(input.kind),
            startsAt: null,
            now: true,
            actorId: actor.discordUserId,
          }),
        ),
    },
    {
      id: 'event-cancel',
      titleKey: k('event_cancel'),
      fields: [kind(false)],
      run: async (input) => say(await cancelEvent(s, kindOf(input.kind).kind)),
    },
    { id: 'war-start', titleKey: k('war_start'), fields: [], run: async () => say(await startWar(s)) },
    { id: 'war-end', titleKey: k('war_end'), fields: [], run: async () => say(await endWar(s)) },
    {
      id: 'threat-set',
      titleKey: k('threat_set'),
      fields: [{ name: 'level', type: 'int', labelKey: k('level'), required: true, min: 0, max: THREAT_MAX }],
      run: async (input) => say(await setThreat(ctx, s, Number(input.level))),
    },
  ];
}
