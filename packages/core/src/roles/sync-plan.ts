import { type RoleConfig, TIKTOK_ROLE_KEY, TIKTOK_ROLE_NAME } from '../config/roles.js';
import type { GuildRole } from '../discord/types.js';

export const hexToInt = (hex: string | null): number => (hex ? Number.parseInt(hex.slice(1), 16) : 0);

export interface RoleSyncPlan {
  create: RoleConfig[];
  updateColor: { roleId: string; key: string; name: string; from: number; to: number }[];
}

/** True for roles no bot may ever create, edit, assign or remove. */
export function isProtectedRoleConfig(r: Pick<RoleConfig, 'key' | 'name' | 'managedBy'>): boolean {
  return r.key === TIKTOK_ROLE_KEY || r.name === TIKTOK_ROLE_NAME || r.managedBy === 'integration';
}

/**
 * Pure role-sync plan (main prompt §12, Cérebro Part B): create missing roles by exact name,
 * fix colors only for Cérebro-managed roles. Never deletes or renames; never touches the TikTok role.
 */
export function planRoleSync(existing: readonly GuildRole[], config: readonly RoleConfig[]): RoleSyncPlan {
  const byName = new Map(existing.map((r) => [r.name, r]));
  const plan: RoleSyncPlan = { create: [], updateColor: [] };
  for (const role of config) {
    if (isProtectedRoleConfig(role)) continue;
    const found = byName.get(role.name);
    if (!found) {
      plan.create.push(role);
      continue;
    }
    if (found.managed) continue;
    if (role.managedBy === 'cerebro' && role.color !== null && found.color !== hexToInt(role.color)) {
      plan.updateColor.push({
        roleId: found.id,
        key: role.key,
        name: role.name,
        from: found.color,
        to: hexToInt(role.color),
      });
    }
  }
  return plan;
}

export const isEmptyPlan = (p: RoleSyncPlan) => p.create.length === 0 && p.updateColor.length === 0;
