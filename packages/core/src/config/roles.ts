import { z } from 'zod';
import { ORIGINS } from '../game/origins.js';

export const ROLE_GROUPS = ['staff', 'onboarding', 'faction', 'rank', 'community', 'rivals'] as const;
export const ROLE_MANAGERS = ['manual', 'cerebro', 'integration'] as const;

export const TIKTOK_ROLE_KEY = 'tiktok_sub';
export const TIKTOK_ROLE_NAME = 'Assinante TikTok';

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, { message: 'config.hex_color' });

export const roleSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, { message: 'config.role_key' }),
  name: z.string().min(1).max(100),
  color: hexColor.nullable().default(null),
  group: z.enum(ROLE_GROUPS),
  managedBy: z.enum(ROLE_MANAGERS),
  hoist: z.boolean().default(false),
  mentionable: z.boolean().default(false),
  /** Old names of this role: role sync renames a role found by one of them instead of creating a new one. */
  renamedFrom: z.array(z.string().min(1).max(100)).default([]),
});
export type RoleConfig = z.infer<typeof roleSchema>;

type RoleInput = z.input<typeof roleSchema>;

/** Default role set (main prompt §12). */
export const DEFAULT_ROLES: RoleInput[] = [
  {
    key: 'staff_owner',
    group: 'staff',
    name: 'Professor X',
    color: '#F1C40F',
    managedBy: 'manual',
    hoist: true,
  },
  {
    key: 'staff_council',
    group: 'staff',
    name: 'Conselho da Legião',
    color: '#9B59B6',
    managedBy: 'manual',
    hoist: true,
  },
  { key: 'staff_bots', group: 'staff', name: 'Sentinela', color: '#95A5A6', managedBy: 'manual' },
  { key: 'signal', group: 'onboarding', name: 'Sinal Detectado', color: null, managedBy: 'cerebro' },
  {
    key: 'registered',
    group: 'onboarding',
    name: 'Herói Registrado',
    renamedFrom: ['Mutante Registrado'],
    color: '#5DADE2',
    managedBy: 'cerebro',
  },
  {
    key: 'faction_xmen',
    group: 'faction',
    name: 'X-Men',
    color: '#3498DB',
    managedBy: 'cerebro',
    hoist: true,
  },
  {
    key: 'faction_brotherhood',
    group: 'faction',
    name: 'Irmandade',
    color: '#E74C3C',
    managedBy: 'cerebro',
    hoist: true,
  },
  {
    key: 'faction_independent',
    group: 'faction',
    name: 'Independente',
    color: '#2ECC71',
    managedBy: 'cerebro',
    hoist: true,
  },
  ...(
    [
      ['faction_avengers', 'Vingadores', '#D4AC0D'],
      ['faction_shield', 'S.H.I.E.L.D.', '#566573'],
      ['faction_guardians', 'Guardiões', '#8E44AD'],
      ['faction_defenders', 'Defensores', '#E67E22'],
      ['faction_thunderbolts', 'Thunderbolts', '#17A589'],
      ['faction_midnight_sons', 'Filhos da Meia-Noite', '#6C3483'],
    ] as const
  ).map(([key, name, color]) => ({
    key,
    group: 'faction' as const,
    name,
    color,
    managedBy: 'cerebro' as const,
    hoist: true,
  })),
  { key: 'rank_recruta', group: 'rank', name: 'Recruta', color: null, managedBy: 'cerebro' },
  { key: 'rank_agente', group: 'rank', name: 'Agente', color: null, managedBy: 'cerebro' },
  { key: 'rank_veterano', group: 'rank', name: 'Veterano', color: null, managedBy: 'cerebro' },
  { key: TIKTOK_ROLE_KEY, group: 'community', name: TIKTOK_ROLE_NAME, color: null, managedBy: 'integration' },
  { key: 'supporter', group: 'community', name: 'Apoiador', color: null, managedBy: 'manual' },
  { key: 'live_ping', group: 'community', name: 'Aviso de Live', color: null, managedBy: 'cerebro' },
  { key: 'rivals_vanguard', group: 'rivals', name: 'Vanguarda', color: null, managedBy: 'cerebro' },
  { key: 'rivals_duelist', group: 'rivals', name: 'Duelista', color: null, managedBy: 'cerebro' },
  { key: 'rivals_strategist', group: 'rivals', name: 'Estrategista', color: null, managedBy: 'cerebro' },
];

export const factionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, { message: 'config.role_key' }),
  roleKey: z.string(),
  emoji: z.string().default(''),
  /** Origins that may join this team (v0.9); absent = every origin. */
  origins: z.array(z.enum(ORIGINS)).min(1).optional(),
});
export type FactionConfig = z.infer<typeof factionSchema>;

/**
 * The nine default teams (v0.9). The first three keys are the v0 factions and never change, so
 * members keep their teams. Order = list order on screen.
 */
export const DEFAULT_FACTIONS: z.input<typeof factionSchema>[] = [
  { key: 'independent', roleKey: 'faction_independent', emoji: '🟢' },
  { key: 'xmen', roleKey: 'faction_xmen', emoji: '🔵' },
  { key: 'brotherhood', roleKey: 'faction_brotherhood', emoji: '🔴', origins: ['mutante', 'inumano'] },
  { key: 'avengers', roleKey: 'faction_avengers', emoji: '🟡' },
  { key: 'shield', roleKey: 'faction_shield', emoji: '⚫' },
  { key: 'guardians', roleKey: 'faction_guardians', emoji: '🟣' },
  { key: 'defenders', roleKey: 'faction_defenders', emoji: '🟠' },
  { key: 'thunderbolts', roleKey: 'faction_thunderbolts', emoji: '⚡' },
  { key: 'midnight_sons', roleKey: 'faction_midnight_sons', emoji: '🌙' },
];
export const DEFAULT_FACTION_KEYS = DEFAULT_FACTIONS.map((f) => f.key);

/**
 * The team key to show for a stored one: a key that is no longer in `factions` (team turned off,
 * rollback) shows as Independente. The stored key is never rewritten.
 */
export const shownFaction = (
  factions: readonly Pick<FactionConfig, 'key'>[],
  key: string | null,
): string | null => (!key ? null : factions.some((f) => f.key === key) ? key : 'independent');

/** May a hero of `origin` be on `faction`? */
export const factionAllowsOrigin = (f: Pick<FactionConfig, 'origins'>, origin: string) =>
  !f.origins || (f.origins as readonly string[]).includes(origin);
