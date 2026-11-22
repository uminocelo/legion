import type { Logger } from 'pino';
import { type RoleConfig, TIKTOK_ROLE_KEY, TIKTOK_ROLE_NAME } from '../config/roles.js';
import type { DiscordGateway } from '../discord/gateway.js';
import type { GuildRole } from '../discord/types.js';
import { hexToInt, isProtectedRoleConfig, type RoleSyncPlan } from './sync-plan.js';

export class RoleGuardError extends Error {
  constructor(what: string) {
    super(
      `Refused to touch a protected role (${what}). The TikTok integration role is never managed by Legion.`,
    );
    this.name = 'RoleGuardError';
  }
}

export interface RoleSyncResult {
  created: string[];
  recolored: string[];
  renamed: string[];
  errors: { key: string; error: string }[];
}

export interface HierarchyProblem {
  key: string;
  name: string;
}

/**
 * The only code allowed to touch roles (main prompt §12). Roles are referenced by config key.
 * Any operation on the TikTok role — by key, by name, or because Discord flags it as
 * integration-managed — is refused: thrown in tests (`guard: 'throw'`), logged and skipped in production.
 */
export class RoleService {
  private cache: GuildRole[] | null = null;
  private readonly byKey: Map<string, RoleConfig>;

  constructor(
    private readonly gateway: DiscordGateway,
    private readonly config: readonly RoleConfig[],
    private readonly log: Logger,
    private readonly guard: 'throw' | 'skip' = 'skip',
  ) {
    this.byKey = new Map(config.map((r) => [r.key, r]));
  }

  configFor(key: string): RoleConfig | undefined {
    return this.byKey.get(key);
  }

  async refresh(): Promise<GuildRole[]> {
    this.cache = await this.gateway.fetchRoles();
    return this.cache;
  }

  private async roles(): Promise<GuildRole[]> {
    return this.cache ?? this.refresh();
  }

  /** The Discord role for a config key, matched by its configured name. */
  async resolve(key: string): Promise<GuildRole | null> {
    const cfg = this.byKey.get(key);
    if (!cfg) return null;
    // The current name first; an old name (`renamedFrom`) until role sync renames it.
    const find = (list: GuildRole[]) =>
      list.find((r) => r.name === cfg.name) ??
      list.find((r) => (cfg.renamedFrom ?? []).includes(r.name) && !r.managed) ??
      null;
    return find(await this.roles()) ?? find(await this.refresh());
  }

  /** Role ids for keys (unknown or missing roles are skipped). */
  async idsFor(keys: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const key of keys) {
      const role = await this.resolve(key);
      if (role) out.set(key, role.id);
    }
    return out;
  }

  isProtected(key: string | null, role: GuildRole | null): boolean {
    if (key === TIKTOK_ROLE_KEY) return true;
    const cfg = key ? this.byKey.get(key) : undefined;
    if (cfg && isProtectedRoleConfig(cfg)) return true;
    if (role && (role.name === TIKTOK_ROLE_NAME || role.managed)) return true;
    return false;
  }

  /** Returns true when the operation may proceed. */
  private check(key: string | null, role: GuildRole | null, op: string): boolean {
    if (!this.isProtected(key, role)) return true;
    const what = `${op} ${key ?? role?.name ?? '?'}`;
    if (this.guard === 'throw') throw new RoleGuardError(what);
    this.log.error({ op, key, roleName: role?.name }, 'refused to touch a protected role');
    return false;
  }

  async assign(userId: string, key: string, reason?: string): Promise<boolean> {
    if (!this.check(key, null, 'assign')) return false;
    const role = await this.resolve(key);
    if (!role) {
      this.log.warn({ key }, 'role not found in guild; run /cerebro setup');
      return false;
    }
    if (!this.check(key, role, 'assign')) return false;
    await this.gateway.addMemberRole(userId, role.id, reason);
    return true;
  }

  async remove(userId: string, key: string, reason?: string): Promise<boolean> {
    if (!this.check(key, null, 'remove')) return false;
    const role = await this.resolve(key);
    if (!role) return false;
    if (!this.check(key, role, 'remove')) return false;
    await this.gateway.removeMemberRole(userId, role.id, reason);
    return true;
  }

  /**
   * Makes the member hold exactly `key` (or none) out of `group`: removes every other role
   * of the group the member holds, then adds `key` if missing.
   */
  async setExactlyOne(
    userId: string,
    group: readonly string[],
    key: string | null,
    reason?: string,
  ): Promise<void> {
    for (const k of [...group, ...(key ? [key] : [])]) this.check(k, null, 'set');
    const member = await this.gateway.fetchMember(userId);
    if (!member) return;
    const ids = await this.idsFor(group);
    for (const [k, id] of ids) {
      if (k !== key && member.roleIds.includes(id)) await this.remove(userId, k, reason);
    }
    const target = key ? ids.get(key) : undefined;
    if (key && target && !member.roleIds.includes(target)) await this.assign(userId, key, reason);
    else if (key && !target) await this.assign(userId, key, reason); // logs the missing role
  }

  /** Brings a member to the expected set: adds `add`, removes `remove` (only what differs). */
  async reconcileMember(userId: string, add: readonly string[], remove: readonly string[], reason?: string) {
    const member = await this.gateway.fetchMember(userId);
    if (!member) return { missingMember: true };
    const ids = await this.idsFor([...add, ...remove]);
    for (const k of remove) {
      const id = ids.get(k);
      if (id && member.roleIds.includes(id)) await this.remove(userId, k, reason);
    }
    for (const k of add) {
      const id = ids.get(k);
      if (!id || !member.roleIds.includes(id)) await this.assign(userId, k, reason);
    }
    return { missingMember: false };
  }

  /** Applies a plan from `planRoleSync`, logging each change. Continues past individual failures. */
  async applySyncPlan(plan: RoleSyncPlan): Promise<RoleSyncResult> {
    const result: RoleSyncResult = { created: [], recolored: [], renamed: [], errors: [] };
    for (const r of plan.rename ?? []) {
      try {
        if (!this.check(r.key, null, 'edit')) continue;
        await this.gateway.editRole(r.roleId, { name: r.to });
        result.renamed.push(r.key);
        this.log.info({ key: r.key, from: r.from, to: r.to }, 'role renamed');
      } catch (err) {
        result.errors.push({ key: r.key, error: (err as Error).message });
        this.log.warn({ err, key: r.key }, 'could not rename role');
      }
    }
    for (const r of plan.create) {
      try {
        if (!this.check(r.key, null, 'create')) continue;
        await this.gateway.createRole({
          name: r.name,
          color: hexToInt(r.color),
          hoist: r.hoist,
          mentionable: r.mentionable,
        });
        result.created.push(r.key);
        this.log.info({ key: r.key, name: r.name }, 'role created');
      } catch (err) {
        result.errors.push({ key: r.key, error: (err as Error).message });
        this.log.warn({ err, key: r.key }, 'could not create role');
      }
    }
    const current = await this.refresh();
    for (const u of plan.updateColor) {
      try {
        const role = current.find((x) => x.id === u.roleId) ?? null;
        if (!this.check(u.key, role, 'edit')) continue;
        await this.gateway.editRole(u.roleId, { color: u.to });
        result.recolored.push(u.key);
        this.log.info({ key: u.key, from: u.from, to: u.to }, 'role color updated');
      } catch (err) {
        result.errors.push({ key: u.key, error: (err as Error).message });
        this.log.warn({ err, key: u.key }, 'could not edit role');
      }
    }
    if (result.created.length || result.recolored.length || result.renamed.length) await this.refresh();
    return result;
  }

  /** Roles (by key) that sit at or above the bot's top role, so the bot cannot assign them. */
  async checkHierarchy(keys: readonly string[]): Promise<HierarchyProblem[]> {
    const roles = await this.refresh();
    const bot = await this.gateway.fetchMember(this.gateway.botUserId);
    const top = Math.max(0, ...roles.filter((r) => bot?.roleIds.includes(r.id)).map((r) => r.position));
    const problems: HierarchyProblem[] = [];
    for (const key of keys) {
      const cfg = this.byKey.get(key);
      const role =
        cfg &&
        (roles.find((r) => r.name === cfg.name) ??
          roles.find((r) => (cfg.renamedFrom ?? []).includes(r.name)));
      if (role && role.position >= top) problems.push({ key, name: role.name });
    }
    return problems;
  }

  /** Keys of roles a given manager owns (e.g. every `managedBy: cerebro` role). */
  keysManagedBy(manager: RoleConfig['managedBy']): string[] {
    return this.config.filter((r) => r.managedBy === manager).map((r) => r.key);
  }
}
