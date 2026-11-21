import type { LegionConfig } from '../config/schema.js';
import type { I18n } from '../i18n/i18n.js';
import type { ReadModels } from '../registries/read-models.js';
import type { PanelSpec } from './registry.js';

/** Level bands of the members panel: [label, min, max]. */
export const LEVEL_BANDS: [string, number, number][] = [
  ['1–4', 1, 4],
  ['5–9', 5, 9],
  ['10–19', 10, 19],
  ['20+', 20, Number.POSITIVE_INFINITY],
];

/** Core members panel: registered heroes per faction and per level band. */
export function membersPanel(read: ReadModels, config: LegionConfig, i18n: I18n): PanelSpec {
  const t = (k: string) => i18n.t(`core.dashboard.members.${k}`);
  return {
    id: 'members',
    titleKey: 'core.dashboard.members.title',
    render: async () => {
      const members = await read.members.listRegistered();
      const levels = await Promise.all(members.map(async (m) => (await read.progress.get(m.id))?.level ?? 1));
      const label = (key: string | null) => {
        if (!key) return t('no_faction');
        const f = config.factions.find((x) => x.key === key);
        const name = config.roles.find((r) => r.key === f?.roleKey)?.name ?? key;
        return f?.emoji ? `${f.emoji} ${name}` : name;
      };
      const keys = [
        ...config.factions.map((f) => f.key as string | null),
        ...[...new Set(members.map((m) => m.faction))].filter(
          (k) => !config.factions.some((f) => f.key === k),
        ),
      ];
      const row = (name: string, pick: (i: number) => boolean) => {
        const idx = members.map((_, i) => i).filter(pick);
        return [
          name,
          idx.length,
          ...LEVEL_BANDS.map(
            ([, lo, hi]) => idx.filter((i) => (levels[i] ?? 1) >= lo && (levels[i] ?? 1) <= hi).length,
          ),
        ];
      };
      return {
        kind: 'table',
        columns: [t('faction'), t('registered'), ...LEVEL_BANDS.map(([b]) => `${t('level')} ${b}`)],
        rows: [
          ...keys.map((k) => row(label(k), (i) => (members[i]?.faction ?? null) === k)),
          row(t('total'), () => true),
        ],
      };
    },
  };
}
