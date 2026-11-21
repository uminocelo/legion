import type { BotContext, PanelSpec } from '@legion/core';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { jarvisTables } from './db/tables.js';

const DAY_MS = 86_400_000;

/** Staff dashboard panels of J.A.R.V.I.S. (US-20): economy totals, top balances, latest purchases. */
export function jarvisPanels(ctx: BotContext<unknown>): PanelSpec[] {
  const t = (k: string) => ctx.i18n.t(`jarvis.dashboard.${k}`);
  const tables = () => jarvisTables(ctx.db);
  const guild = ctx.guildId;
  const nameOf = async (memberId: string) =>
    (await ctx.read.mutants.getByMemberId(memberId))?.codename ?? memberId;

  return [
    {
      id: 'economy',
      titleKey: 'jarvis.dashboard.economy',
      render: async () => {
        const { jarvisWallets: w, jarvisWalletLedger: l } = tables();
        const since = new Date(ctx.clock.now().getTime() - 7 * DAY_MS).toISOString();
        const [circ] = await ctx.db.orm
          .select({ total: sql<number>`coalesce(sum(${w.balance}), 0)`, wallets: sql<number>`count(*)` })
          .from(w)
          .where(eq(w.guildId, guild));
        const [week] = await ctx.db.orm
          .select({
            earned: sql<number>`coalesce(sum(case when ${l.amount} > 0 then ${l.amount} else 0 end), 0)`,
            spent: sql<number>`coalesce(sum(case when ${l.amount} < 0 then -${l.amount} else 0 end), 0)`,
          })
          .from(l)
          .where(and(eq(l.guildId, guild), gte(l.createdAt, since)));
        return {
          kind: 'stats',
          items: [
            { labelKey: 'jarvis.dashboard.in_circulation', value: Number(circ?.total ?? 0) },
            { labelKey: 'jarvis.dashboard.wallets', value: Number(circ?.wallets ?? 0) },
            { labelKey: 'jarvis.dashboard.earned_7d', value: Number(week?.earned ?? 0) },
            { labelKey: 'jarvis.dashboard.spent_7d', value: Number(week?.spent ?? 0) },
          ],
        };
      },
    },
    {
      id: 'top-balances',
      titleKey: 'jarvis.dashboard.top_balances',
      render: async () => {
        const { jarvisWallets: w } = tables();
        const rows = await ctx.db.orm
          .select()
          .from(w)
          .where(eq(w.guildId, guild))
          .orderBy(desc(w.balance), w.memberId)
          .limit(10);
        return {
          kind: 'table',
          columns: ['#', t('hero'), t('balance')],
          rows: await Promise.all(rows.map(async (r, i) => [i + 1, await nameOf(r.memberId), r.balance])),
        };
      },
    },
    {
      id: 'purchases',
      titleKey: 'jarvis.dashboard.purchases',
      render: async () => {
        const { jarvisWalletLedger: l, jarvisItems: it } = tables();
        const rows = await ctx.db.orm
          .select()
          .from(l)
          .where(and(eq(l.guildId, guild), eq(l.reason, 'purchase')))
          .orderBy(desc(l.createdAt), desc(l.id))
          .limit(20);
        const ids = [...new Set(rows.map((r) => r.note).filter((n): n is string => !!n))];
        const items = ids.length ? await ctx.db.orm.select().from(it).where(inArray(it.id, ids)) : [];
        const itemName = (id: string | null) => {
          const def = items.find((x) => x.id === id)?.definition;
          try {
            const n = (JSON.parse(def ?? '{}') as { name?: Record<string, string> }).name;
            return n?.[ctx.config.locale] ?? n?.['pt-BR'] ?? id ?? '';
          } catch {
            return id ?? '';
          }
        };
        const when = new Intl.DateTimeFormat(ctx.config.locale, {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: ctx.config.timezone,
        });
        return {
          kind: 'table',
          columns: [t('when'), t('hero'), t('item'), t('price')],
          rows: await Promise.all(
            rows.map(async (r) => [
              when.format(new Date(r.createdAt)),
              await nameOf(r.memberId),
              itemName(r.note),
              -r.amount,
            ]),
          ),
        };
      },
    },
  ];
}
