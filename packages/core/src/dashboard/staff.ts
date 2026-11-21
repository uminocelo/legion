import type { DiscordGateway } from '../discord/gateway.js';
import { guildPermissionsOf } from '../discord/guild-permissions.js';
import type { IncomingInteraction } from '../discord/types.js';
import type { Clock } from '../time/clock.js';

export interface StaffStatus {
  staff: boolean;
  /** Server display name, for the page header. */
  name: string;
}

/** Who may open the dashboard. Throws when Discord cannot answer (the caller answers 503). */
export interface DashboardStaffChecker {
  check(discordUserId: string, opts?: { fresh?: boolean }): Promise<StaffStatus>;
}

export interface GuildStaffCheckerOptions {
  gateway: DiscordGateway;
  guildId: string;
  clock: Clock;
  /** The slash-command staff check (owner or a staff role). */
  isStaff(i: Pick<IncomingInteraction, 'isGuildOwner' | 'memberRoleIds'>): Promise<boolean>;
  /** How long an answer is reused (default 60 s): a removed staff member is out within this. */
  ttlMs?: number;
}

/** Owner, Administrator or a staff role, read from Discord with a short cache. */
export class GuildStaffChecker implements DashboardStaffChecker {
  private readonly cache = new Map<string, { at: number; status: StaffStatus }>();
  constructor(private readonly o: GuildStaffCheckerOptions) {}

  async check(discordUserId: string, opts: { fresh?: boolean } = {}): Promise<StaffStatus> {
    const now = this.o.clock.now().getTime();
    const hit = this.cache.get(discordUserId);
    if (!opts.fresh && hit && now - hit.at < (this.o.ttlMs ?? 60_000)) return hit.status;
    const status = await this.read(discordUserId);
    this.cache.set(discordUserId, { at: now, status });
    if (this.cache.size > 1000)
      for (const [k, v] of this.cache) if (now - v.at >= (this.o.ttlMs ?? 60_000)) this.cache.delete(k);
    return status;
  }

  private async read(discordUserId: string): Promise<StaffStatus> {
    const member = await this.o.gateway.fetchMember(discordUserId);
    if (!member || member.isBot) return { staff: false, name: discordUserId };
    const name = member.displayName;
    if (member.isOwner) return { staff: true, name };
    if (await this.o.isStaff({ isGuildOwner: false, memberRoleIds: member.roleIds }))
      return { staff: true, name };
    const perms = guildPermissionsOf(this.o.guildId, member, await this.o.gateway.fetchRoles());
    return { staff: perms?.has('Administrator') ?? false, name };
  }
}
