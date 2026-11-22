import { randomInt } from 'node:crypto';
import {
  AuditLog,
  type BotContext,
  customId,
  type Executor,
  factionAllowsOrigin,
  GatewayError,
  type I18n,
  isCanonName,
  type Locale,
  normalizeName,
} from '@legion/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { CerebroConfig } from './config.js';
import type { MemberRow } from './db/repo.js';
import { cerebroTables } from './db/tables.js';
import { recordFactionChange } from './faction-join.js';
import type { CerebroFlow } from './flow.js';
import { V } from './ui.js';

/** 31 symbols: no 0/O/1/I/9, so 31^6 matches the spec (~887 million). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ2345678';
const OPEN = ['requested', 'active'] as const;

export interface SquadOutcome {
  ok: boolean;
  key: string;
  vars?: Record<string, string | number>;
}

const no = (key: string, vars?: Record<string, string | number>): SquadOutcome => ({ ok: false, key, vars });
const yes = (key: string, vars?: Record<string, string | number>): SquadOutcome => ({ ok: true, key, vars });

export const squadText = (
  i18n: I18n,
  key: string,
  vars: Record<string, string | number> | undefined,
  locale: Locale,
) => i18n.t(`cerebro.squads.${key}`, vars ?? {}, locale);

type SquadRow = ReturnType<typeof cerebroTables>['cerebroSquads']['$inferSelect'];

/** Wrong codes only. Five in ten minutes; the router limiter is a different counter. */
const CODE_WINDOW_MS = 10 * 60 * 1000;
const CODE_MAX = 5;

class CodeAttempts {
  private readonly hits = new Map<string, number[]>();

  /** Minutes to wait when the user is over the limit, or null when another try is allowed. */
  blocked(userId: string, now: number): number | null {
    const recent = this.prune(userId, now);
    if (recent.length < CODE_MAX) return null;
    const oldest = recent[0] ?? now;
    return Math.max(1, Math.ceil((CODE_WINDOW_MS - (now - oldest)) / 60_000));
  }

  record(userId: string, now: number): void {
    const recent = this.prune(userId, now);
    recent.push(now);
    this.hits.set(userId, recent);
  }

  private prune(userId: string, now: number): number[] {
    const recent = (this.hits.get(userId) ?? []).filter((t) => now - t < CODE_WINDOW_MS);
    this.hits.set(userId, recent);
    return recent;
  }
}

/**
 * Squads (US-35). One write path for request, approval, join, leave and archive.
 * A team change and the membership row commit together; the role and the thread happen after.
 */
export class Squads {
  /** In-memory wrong-code limiter (not the interaction router). */
  private readonly codes = new CodeAttempts();

  constructor(private readonly flow: CerebroFlow) {}

  private get ctx(): BotContext<CerebroConfig> {
    return this.flow.ctx;
  }

  private tables() {
    return cerebroTables(this.ctx.db);
  }

  private audit() {
    return new AuditLog(this.ctx.db, this.ctx.guildId, () => this.ctx.clock.now(), this.ctx.newId);
  }

  async byId(id: string): Promise<SquadRow | null> {
    const t = this.tables().cerebroSquads;
    const [row] = await this.ctx.db.orm
      .select()
      .from(t)
      .where(and(eq(t.id, id), eq(t.guildId, this.ctx.guildId)));
    return row ?? null;
  }

  /** Autocomplete stores the id. A typed name resolves by `name_key`. */
  async resolve(token: string): Promise<SquadRow | null> {
    const raw = token.trim();
    if (!raw) return null;
    const found = await this.byId(raw);
    if (found) return found;
    const key = normalizeName(raw);
    if (!key) return null;
    return (await this.list()).find((r) => r.nameKey === key) ?? null;
  }

  async list(statuses?: readonly string[]): Promise<SquadRow[]> {
    const t = this.tables().cerebroSquads;
    const rows = await this.ctx.db.orm.select().from(t).where(eq(t.guildId, this.ctx.guildId));
    const filtered = statuses ? rows.filter((r) => statuses.includes(r.status)) : rows;
    return filtered.sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  }

  /** Autocomplete choices. `value` is the squad id. */
  async choices(query: string, statuses: readonly string[]): Promise<{ name: string; value: string }[]> {
    const q = normalizeName(query);
    const rows = await this.list(statuses);
    return rows
      .filter((r) => !q || normalizeName(r.name).includes(q))
      .slice(0, 25)
      .map((r) => ({ name: r.name.slice(0, 100), value: r.id }));
  }

  async request(o: {
    founderDiscordId: string;
    name: string;
    base: string;
    isStaff: boolean;
    memberRoleIds: string[];
  }): Promise<SquadOutcome> {
    if (!this.ctx.config.squads.enabled) return no('squads_disabled');
    const name = o.name.trim().replace(/\s+/g, ' ');
    if (name.length < 3 || name.length > 32 || !normalizeName(name)) return no('name_length', { name });
    if (isCanonName(name)) return no('canon_name', { name });
    const nameKey = normalizeName(name);
    const base = this.ctx.config.factions.find((f) => f.key === o.base);
    if (!base || base.key === 'independent') return no('base_invalid');
    const member = await this.flow.repo.memberByDiscordId(o.founderDiscordId);
    const mutant = member ? await this.flow.repo.mutantByMemberId(member.id) : null;
    if (!member || member.leftAt || member.onboardingStep !== 'registered' || !mutant)
      return no('not_registered');
    if (!factionAllowsOrigin(base, mutant.originType)) return no('base_origin', { team: base.key });
    if (!o.isStaff && !(await this.hasFounderRole(o.memberRoleIds))) return no('not_founder');

    const open = await this.list(OPEN);
    if (open.length >= this.ctx.config.squads.maxSquads)
      return no('squad_limit', { max: this.ctx.config.squads.maxSquads });
    const mine = open.filter((r) => r.founderMemberId === member.id);
    if (mine.some((r) => r.status === 'requested') || mine.length >= this.ctx.config.squads.maxPerFounder)
      return no('founder_limit', { max: this.ctx.config.squads.maxPerFounder });
    if ((await this.list()).some((r) => r.nameKey === nameKey)) return no('name_taken', { name });

    const id = this.ctx.newId();
    const now = this.ctx.clock.now().toISOString();
    try {
      await this.ctx.bus.transaction(async (tx) => {
        await tx.insert(this.tables().cerebroSquads).values({
          id,
          guildId: this.ctx.guildId,
          name,
          nameKey,
          baseFaction: base.key,
          founderMemberId: member.id,
          status: 'requested',
          requestedAt: now,
        });
        await this.ctx.bus.emit(tx, 'squad.created', {
          squadId: id,
          name,
          baseFaction: base.key,
          founderDiscordId: o.founderDiscordId,
        });
      });
    } catch (err) {
      this.ctx.log.warn({ err }, 'squad request insert failed');
      return no('name_taken', { name });
    }
    await this.postRequest(id, name, base.key);
    return yes('requested', { name });
  }

  async decide(o: {
    squadId: string;
    approve: boolean;
    reason?: string;
    actorId: string;
    source: 'command' | 'dashboard';
  }): Promise<SquadOutcome> {
    if (!this.ctx.config.squads.enabled) return no('squads_disabled');
    const squad = await this.byId(o.squadId);
    if (!squad || squad.status !== 'requested') return no('not_pending');
    if (!o.approve) return this.refuse(squad, o);
    return this.approve(squad, o);
  }

  async leave(o: { discordUserId: string }): Promise<SquadOutcome> {
    if (!this.ctx.config.squads.enabled) return no('squads_disabled');
    const member = await this.flow.repo.memberByDiscordId(o.discordUserId);
    if (!member) return no('not_in_squad');
    const seat = await this.membership(member.id);
    if (!seat) return no('not_in_squad');
    const squad = await this.byId(seat.squadId);
    if (!squad || squad.status !== 'active') return no('not_in_squad');
    if (squad.founderMemberId === member.id) return no('leader_cannot_leave', { name: squad.name });
    await this.removeSeat(squad, member, 'left');
    return yes('left', { name: squad.name });
  }

  /**
   * Join by invite link (`squadId`) or by code. One transaction locks the squad row, checks the
   * seat count, writes the membership and, for Independente or a hero still registering, the team.
   * The role and the thread are added after commit.
   */
  async join(o: {
    discordUserId: string;
    code?: string;
    squadId?: string;
    via: 'link' | 'code';
  }): Promise<SquadOutcome> {
    if (!this.ctx.config.squads.enabled) return no('squads_disabled');
    const nowMs = this.ctx.clock.now().getTime();
    if (o.via === 'code') {
      const wait = this.codes.blocked(o.discordUserId, nowMs);
      if (wait !== null) return no('code_limited', { minutes: wait });
    }
    const squad = await this.squadForJoin(o, nowMs);
    if (!squad || 'key' in squad) return squad ?? no('bad_code');
    if (squad.status !== 'active') return no('squad_inactive');

    const member = await this.flow.repo.memberByDiscordId(o.discordUserId);
    if (!member || member.leftAt) return no('not_registered');
    if (await this.membership(member.id)) return no('already_in_squad');
    const origin = await this.originOf(member);
    if (!origin) return no('not_registered');
    const team = this.ctx.config.factions.find((f) => f.key === squad.baseFaction);
    if (!team || !factionAllowsOrigin(team, origin)) {
      if (member.pendingSquadId) await this.flow.repo.updateMember(member.id, { pendingSquadId: null });
      return no('origin', { team: squad.baseFaction });
    }
    const movable = !member.faction || member.faction === 'independent';
    if (member.faction !== squad.baseFaction && !movable)
      return no('other_team', { team: squad.baseFaction });

    const joined = await this.ctx.bus.transaction(async (tx) => {
      const locked = await this.lockActive(tx, squad.id);
      if (!locked) return 'inactive' as const;
      const members = this.tables().cerebroSquadMembers;
      const [seat] = await tx.select().from(members).where(eq(members.memberId, member.id));
      if (seat) return 'already' as const;
      const taken = await tx
        .select({ id: members.memberId })
        .from(members)
        .where(eq(members.squadId, squad.id));
      if (taken.length >= this.ctx.config.squads.maxMembers) return 'full' as const;

      let changed = false;
      if (member.faction !== squad.baseFaction) {
        const moved = await this.moveToSquadTeam(tx, member, squad);
        if (!moved) return 'inactive' as const;
        changed = true;
      }
      const at = this.ctx.clock.now().toISOString();
      const inserted = await tx
        .insert(members)
        .values({ memberId: member.id, squadId: squad.id, joinedAt: at, via: o.via })
        .onConflictDoNothing()
        .returning({ id: members.memberId });
      if (!inserted.length) return 'already' as const;
      const fresh = (await this.flow.repo.updateMember(member.id, { pendingSquadId: null }, tx)) ?? member;
      await this.ctx.bus.emit(tx, 'squad.joined', {
        squadId: squad.id,
        discordUserId: member.discordUserId,
        via: o.via,
      });
      return { fresh, changed };
    });
    if (joined === 'inactive') return no('squad_inactive');
    if (joined === 'already') return no('already_in_squad');
    if (joined === 'full') return no('squad_full', { max: this.ctx.config.squads.maxMembers });

    await this.placeOnDiscord(squad, o.discordUserId);
    if (joined.changed) await this.flow.applyExpectedRoles(joined.fresh);
    return yes('joined', { name: squad.name, team: squad.baseFaction });
  }

  /** A team switch that is not itself a squad join removes the seat, including the leader's. */
  async onTeamSwitched(discordUserId: string): Promise<void> {
    if (!this.ctx.config.squads.enabled) return;
    const member = await this.flow.repo.memberByDiscordId(discordUserId);
    if (!member) return;
    const seat = await this.membership(member.id);
    if (!seat) return;
    const squad = await this.byId(seat.squadId);
    if (!squad || squad.status !== 'active') return;
    await this.removeSeat(squad, member, 'team_switch');
  }

  /**
   * Someone left the server. A member loses the seat and does not get it back on rejoin.
   * The founder archives the squad (v1.1 has no co-leader) and staff are told in the mod queue.
   */
  async onServerLeft(member: MemberRow): Promise<void> {
    if (!this.ctx.config.squads.enabled) return;
    const seat = await this.membership(member.id);
    if (!seat) return;
    const squad = await this.byId(seat.squadId);
    if (!squad || squad.status !== 'active') return;
    if (squad.founderMemberId !== member.id) {
      await this.removeSeat(squad, member, 'left_server');
      return;
    }
    try {
      await this.removeSquadDiscord(squad, 'left_server');
    } catch (err) {
      this.ctx.log.warn({ err, squadId: squad.id }, 'could not remove the squad on Discord');
      return;
    }
    await this.markArchived(squad, 'left_server', member.discordUserId, 'left_server');
    await this.postFounderLeft(squad);
  }

  /** Leader or staff opening `/esquadrao ver`: recreate a permanent invite a mod deleted. */
  async repairInvite(squad: SquadRow): Promise<SquadRow> {
    if (squad.status !== 'active') return squad;
    const welcome = this.ctx.config.channels.welcome;
    if (!welcome) return squad;
    try {
      const invites = await this.ctx.gateway.fetchInvites();
      if (squad.inviteCode && invites.some((i) => i.code === squad.inviteCode)) return squad;
      const invite = await this.ctx.gateway.createInvite(welcome, {
        maxAge: 0,
        maxUses: 0,
        unique: true,
        reason: `squad ${squad.name}`,
      });
      const t = this.tables().cerebroSquads;
      const [row] = await this.ctx.db.orm
        .update(t)
        .set({ inviteCode: invite.code })
        .where(and(eq(t.id, squad.id), eq(t.status, 'active')))
        .returning();
      if (squad.inviteCode) this.flow.invites.forget(squad.inviteCode);
      this.flow.invites.remember(invite.code, 0);
      return row ?? squad;
    } catch (err) {
      this.ctx.log.warn({ err, squadId: squad.id }, 'could not recreate the squad invite');
      return squad;
    }
  }

  async archive(o: {
    squadId: string;
    reason: string;
    actorId: string;
    source: 'command' | 'dashboard';
  }): Promise<SquadOutcome> {
    if (!this.ctx.config.squads.enabled) return no('squads_disabled');
    const reason = o.reason.trim();
    if (!reason || reason.length > 200) return no('reason_length');
    const squad = await this.byId(o.squadId);
    if (!squad || squad.status !== 'active') return no('not_active');
    try {
      await this.removeSquadDiscord(squad, reason);
    } catch (err) {
      return this.discordFailed(err);
    }
    await this.markArchived(squad, reason, o.actorId, 'archived');
    await this.recordAudit(o.source, 'cerebro/squad-archive', o.actorId, squad.id, {
      name: squad.name,
      reason,
    });
    return yes('archived', { name: squad.name });
  }

  /** Founder of an active squad, for `/esquadrao ver`. */
  async membershipOf(discordUserId: string) {
    const member = await this.flow.repo.memberByDiscordId(discordUserId);
    if (!member) return null;
    const seat = await this.membership(member.id);
    if (!seat) return null;
    const squad = await this.byId(seat.squadId);
    return squad ? { member, squad, via: seat.via } : null;
  }

  async memberCount(squadId: string): Promise<number> {
    return (await this.seats(squadId)).length;
  }

  private async hasFounderRole(memberRoleIds: string[]): Promise<boolean> {
    const key = this.ctx.config.squads.founderRole;
    if (!key) return false;
    if (/^\d{5,25}$/.test(key)) return memberRoleIds.includes(key);
    const role = await this.ctx.roles.resolve(key);
    return Boolean(role && memberRoleIds.includes(role.id));
  }

  private async refuse(
    squad: SquadRow,
    o: { reason?: string; actorId: string; source: 'command' | 'dashboard' },
  ): Promise<SquadOutcome> {
    const reason = (o.reason ?? '').trim();
    if (!reason || reason.length > 200) return no('reason_length');
    const now = this.ctx.clock.now().toISOString();
    const t = this.tables().cerebroSquads;
    const updated = await this.ctx.db.orm
      .update(t)
      .set({ status: 'refused', refuseReason: reason, decidedAt: now, decidedBy: o.actorId })
      .where(and(eq(t.id, squad.id), eq(t.status, 'requested')))
      .returning({ id: t.id });
    if (!updated.length) return no('not_pending');
    await this.recordAudit(o.source, 'cerebro/squad-refuse', o.actorId, squad.id, {
      name: squad.name,
      reason,
    });
    await this.dm(squad, 'dm_refused', { name: squad.name, reason });
    return yes('refused', { name: squad.name, reason });
  }

  private async approve(
    squad: SquadRow,
    o: { actorId: string; source: 'command' | 'dashboard' },
  ): Promise<SquadOutcome> {
    const faction = this.ctx.config.factions.find((f) => f.key === squad.baseFaction);
    const squadChannelId = faction?.squadChannelId;
    const welcome = this.ctx.config.channels.welcome;
    if (!squadChannelId)
      return no('discord_failed', {
        error: squad.baseFaction,
        fix: 'fix_squad_channel',
        team: squad.baseFaction,
      });
    if (!welcome) return no('discord_failed', { error: 'channels.welcome', fix: 'fix_welcome' });
    const founder = await this.flow.repo.memberById(squad.founderMemberId);
    if (!founder) return no('not_pending');
    try {
      const roleId = await this.ensureRole(squad);
      const threadId = await this.ensureThread(squad, squadChannelId);
      const inviteCode = await this.ensureInvite(squad, welcome);
      const code = await this.ensureCode(squad);
      await this.ctx.gateway.addMemberRole(founder.discordUserId, roleId, `squad ${squad.name}`);
      await this.ctx.gateway.addThreadMember(threadId, founder.discordUserId);
      const now = this.ctx.clock.now().toISOString();
      const activated = await this.ctx.bus.transaction(async (tx) => {
        const t = this.tables().cerebroSquads;
        const updated = await tx
          .update(t)
          .set({
            status: 'active',
            roleId,
            threadId,
            inviteCode,
            code,
            decidedAt: now,
            decidedBy: o.actorId,
          })
          .where(and(eq(t.id, squad.id), eq(t.status, 'requested')))
          .returning({ id: t.id });
        if (!updated.length) return false;
        await tx
          .insert(this.tables().cerebroSquadMembers)
          .values({ memberId: founder.id, squadId: squad.id, joinedAt: now, via: 'founder' })
          .onConflictDoNothing();
        await this.ctx.bus.emit(tx, 'squad.joined', {
          squadId: squad.id,
          discordUserId: founder.discordUserId,
          via: 'founder',
        });
        return true;
      });
      if (!activated) return no('not_pending');
      await this.recordAudit(o.source, 'cerebro/squad-approve', o.actorId, squad.id, {
        name: squad.name,
        code,
      });
      await this.dm(squad, 'dm_approved', { name: squad.name, code });
      return yes('approved', { name: squad.name, code });
    } catch (err) {
      return this.discordFailed(err);
    }
  }

  private async ensureRole(squad: SquadRow): Promise<string> {
    const fresh = (await this.byId(squad.id)) ?? squad;
    if (fresh.roleId) return fresh.roleId;
    const role = await this.ctx.gateway.createRole({
      name: fresh.name,
      color: 0x5865f2,
      hoist: false,
      mentionable: false,
    });
    const saved = await this.fill(fresh.id, { roleId: role.id }, 'roleId');
    if (saved) return role.id;
    await this.ctx.gateway.deleteRole(role.id, 'duplicate squad role').catch(() => undefined);
    const again = await this.byId(fresh.id);
    if (!again?.roleId) throw new GatewayError('role was not saved', null);
    return again.roleId;
  }

  private async ensureThread(squad: SquadRow, channelId: string): Promise<string> {
    const fresh = (await this.byId(squad.id)) ?? squad;
    if (fresh.threadId) return fresh.threadId;
    const thread = await this.ctx.gateway.createPrivateThread(channelId, fresh.name);
    const saved = await this.fill(fresh.id, { threadId: thread.threadId }, 'threadId');
    if (saved) return thread.threadId;
    await this.ctx.gateway.deleteChannel(thread.threadId, 'duplicate squad thread').catch(() => undefined);
    const again = await this.byId(fresh.id);
    if (!again?.threadId) throw new GatewayError('thread was not saved', null);
    return again.threadId;
  }

  private async ensureInvite(squad: SquadRow, channelId: string): Promise<string> {
    const fresh = (await this.byId(squad.id)) ?? squad;
    if (fresh.inviteCode) return fresh.inviteCode;
    const invite = await this.ctx.gateway.createInvite(channelId, {
      maxAge: 0,
      maxUses: 0,
      unique: true,
      reason: `squad ${fresh.name}`,
    });
    const saved = await this.fill(fresh.id, { inviteCode: invite.code }, 'inviteCode');
    if (saved) {
      this.flow.invites.remember(invite.code, 0);
      return invite.code;
    }
    await this.ctx.gateway.deleteInvite(invite.code, 'duplicate squad invite').catch(() => undefined);
    const again = await this.byId(fresh.id);
    if (!again?.inviteCode) throw new GatewayError('invite was not saved', null);
    return again.inviteCode;
  }

  private async ensureCode(squad: SquadRow): Promise<string> {
    const fresh = (await this.byId(squad.id)) ?? squad;
    if (fresh.code) return fresh.code;
    for (let n = 0; n < 5; n++) {
      const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      try {
        if (await this.fill(fresh.id, { code }, 'code')) return code;
      } catch {
        // unique collision with another squad; try another code
      }
      const again = await this.byId(fresh.id);
      if (again?.code) return again.code;
    }
    throw new GatewayError('could not allocate a squad code', null);
  }

  /** Sets a column that is still null, and only while the squad is `requested`. */
  private async fill(
    id: string,
    patch: Partial<Pick<SquadRow, 'roleId' | 'threadId' | 'inviteCode' | 'code'>>,
    column: 'roleId' | 'threadId' | 'inviteCode' | 'code',
  ): Promise<boolean> {
    const t = this.tables().cerebroSquads;
    const updated = await this.ctx.db.orm
      .update(t)
      .set(patch)
      .where(and(eq(t.id, id), eq(t.status, 'requested'), isNull(t[column])))
      .returning({ id: t.id });
    return updated.length > 0;
  }

  private discordFailed(err: unknown): SquadOutcome {
    const error = err instanceof Error ? err.message : 'unknown';
    const code = err instanceof GatewayError ? err.code : null;
    this.ctx.log.warn({ err }, 'squad discord call failed');
    const fix = code === 50013 ? 'fix_permissions' : 'fix_retry';
    return no('discord_failed', { error, fix });
  }

  private async gone(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if (err instanceof GatewayError && (err.code === 10003 || err.code === 10006 || err.code === 10011))
        return;
      throw err;
    }
  }

  private async dropDiscordMember(squad: SquadRow, discordUserId: string): Promise<void> {
    if (squad.roleId)
      await this.gone(() => this.ctx.gateway.removeMemberRole(discordUserId, squad.roleId as string));
    if (squad.threadId)
      await this.gone(() => this.ctx.gateway.removeThreadMember(squad.threadId as string, discordUserId));
  }

  /** Unknown codes count toward the limit. A known squad that is not active does not. */
  private async squadForJoin(
    o: { discordUserId: string; code?: string; squadId?: string; via: 'link' | 'code' },
    nowMs: number,
  ): Promise<SquadRow | SquadOutcome | null> {
    if (o.via === 'link') {
      if (!o.squadId) return no('squad_inactive');
      return (await this.byId(o.squadId)) ?? no('squad_inactive');
    }
    const code = (o.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      this.codes.record(o.discordUserId, nowMs);
      return no('bad_code');
    }
    const t = this.tables().cerebroSquads;
    const [row] = await this.ctx.db.orm
      .select()
      .from(t)
      .where(and(eq(t.guildId, this.ctx.guildId), eq(t.code, code)));
    if (!row) {
      this.codes.record(o.discordUserId, nowMs);
      return no('bad_code');
    }
    return row;
  }

  private async originOf(member: MemberRow): Promise<string | null> {
    if (member.onboardingStep === 'registered') {
      const mutant = await this.flow.repo.mutantByMemberId(member.id);
      return mutant?.originType ?? null;
    }
    return member.pendingOrigin;
  }

  /** UPDATE locks the row on Postgres. SQLite runs the transaction alone. */
  private async lockActive(tx: Executor, id: string): Promise<SquadRow | null> {
    const t = this.tables().cerebroSquads;
    const [current] = await tx
      .select()
      .from(t)
      .where(and(eq(t.id, id), eq(t.guildId, this.ctx.guildId), eq(t.status, 'active')));
    if (!current) return null;
    const [row] = await tx
      .update(t)
      .set({ name: current.name })
      .where(and(eq(t.id, id), eq(t.status, 'active')))
      .returning();
    return row ?? null;
  }

  /** `sourceKey` is stable per member. A later rejoin that must move teams again gets a suffix. */
  private async moveToSquadTeam(tx: Executor, member: MemberRow, squad: SquadRow): Promise<MemberRow | null> {
    const sourceKey = `squad:${squad.id}:${member.id}`;
    const moved = await recordFactionChange(this.flow, tx, {
      memberId: member.id,
      to: squad.baseFaction,
      reason: 'squad',
      sourceKey,
      by: null,
    });
    if (moved) return moved;
    const fresh = await this.flow.repo.memberById(member.id, tx);
    if (fresh?.faction === squad.baseFaction) return fresh;
    return recordFactionChange(this.flow, tx, {
      memberId: member.id,
      to: squad.baseFaction,
      reason: 'squad',
      sourceKey: `${sourceKey}:${this.ctx.clock.now().toISOString()}`,
      by: null,
    });
  }

  private async placeOnDiscord(squad: SquadRow, discordUserId: string): Promise<void> {
    const fresh = (await this.byId(squad.id)) ?? squad;
    if (fresh.roleId) {
      try {
        await this.ctx.gateway.addMemberRole(discordUserId, fresh.roleId, `squad ${fresh.name}`);
      } catch (err) {
        this.ctx.log.warn({ err, squadId: fresh.id }, 'could not add the squad role');
      }
    }
    if (!fresh.threadId) return;
    try {
      await this.ctx.gateway.addThreadMember(fresh.threadId, discordUserId);
    } catch (err) {
      this.ctx.log.warn({ err, squadId: fresh.id }, 'squad thread add failed; recreating the thread');
      await this.recreateThread(fresh, discordUserId);
    }
  }

  /** One new private thread. Membership stays committed if the second add also fails. */
  private async recreateThread(squad: SquadRow, discordUserId: string): Promise<void> {
    const channelId = this.ctx.config.factions.find((f) => f.key === squad.baseFaction)?.squadChannelId;
    if (!channelId) return;
    try {
      const thread = await this.ctx.gateway.createPrivateThread(channelId, squad.name);
      const t = this.tables().cerebroSquads;
      await this.ctx.db.orm
        .update(t)
        .set({ threadId: thread.threadId })
        .where(and(eq(t.id, squad.id), eq(t.status, 'active')));
      await this.ctx.gateway.addThreadMember(thread.threadId, discordUserId);
    } catch (err) {
      this.ctx.log.warn({ err, squadId: squad.id }, 'squad thread could not be recreated');
    }
  }

  private async removeSeat(
    squad: SquadRow,
    member: MemberRow,
    reason: 'left' | 'team_switch' | 'left_server',
  ): Promise<void> {
    try {
      await this.dropDiscordMember(squad, member.discordUserId);
    } catch (err) {
      if (reason === 'left') throw err;
      this.ctx.log.warn({ err, squadId: squad.id }, 'could not remove the member from the squad on Discord');
    }
    await this.ctx.bus.transaction(async (tx) => {
      const t = this.tables().cerebroSquadMembers;
      await tx.delete(t).where(eq(t.memberId, member.id));
      await this.ctx.bus.emit(tx, 'squad.left', {
        squadId: squad.id,
        discordUserId: member.discordUserId,
        reason,
      });
    });
  }

  private async removeSquadDiscord(squad: SquadRow, reason: string): Promise<void> {
    if (squad.roleId) await this.gone(() => this.ctx.gateway.deleteRole(squad.roleId as string, reason));
    if (squad.threadId)
      await this.gone(() => this.ctx.gateway.deleteChannel(squad.threadId as string, reason));
    if (squad.inviteCode)
      await this.gone(() => this.ctx.gateway.deleteInvite(squad.inviteCode as string, reason));
  }

  private async markArchived(
    squad: SquadRow,
    reason: string,
    actorId: string,
    eventReason: 'archived' | 'left_server',
  ): Promise<void> {
    const seats = await this.seats(squad.id);
    const now = this.ctx.clock.now().toISOString();
    await this.ctx.bus.transaction(async (tx) => {
      const squads = this.tables().cerebroSquads;
      const updated = await tx
        .update(squads)
        .set({ status: 'archived', decidedAt: now, decidedBy: actorId, refuseReason: reason })
        .where(and(eq(squads.id, squad.id), eq(squads.status, 'active')))
        .returning({ id: squads.id });
      if (!updated.length) return;
      const members = this.tables().cerebroSquadMembers;
      await tx.delete(members).where(eq(members.squadId, squad.id));
      for (const seat of seats) {
        const row = await this.flow.repo.memberById(seat.memberId, tx);
        if (!row) continue;
        await this.ctx.bus.emit(tx, 'squad.left', {
          squadId: squad.id,
          discordUserId: row.discordUserId,
          reason: eventReason,
        });
      }
    });
  }

  private async postFounderLeft(squad: SquadRow): Promise<void> {
    const channelId = this.ctx.config.channels.modQueue;
    if (!channelId) return;
    const locale = this.ctx.config.locale;
    try {
      await this.ctx.gateway.sendMessage(channelId, {
        persona: 'cerebro',
        embeds: [
          {
            title: squadText(this.ctx.i18n, 'queue_left_title', {}, locale),
            description: squadText(this.ctx.i18n, 'queue_left_body', { name: squad.name }, locale),
          },
        ],
      });
    } catch (err) {
      this.ctx.log.warn({ err, squadId: squad.id }, 'could not tell staff the squad leader left');
    }
  }

  private async membership(memberId: string) {
    const t = this.tables().cerebroSquadMembers;
    const [row] = await this.ctx.db.orm.select().from(t).where(eq(t.memberId, memberId));
    return row ?? null;
  }

  private async seats(squadId: string) {
    const t = this.tables().cerebroSquadMembers;
    return this.ctx.db.orm.select().from(t).where(eq(t.squadId, squadId));
  }

  private async postRequest(squadId: string, name: string, team: string): Promise<void> {
    const channelId = this.ctx.config.channels.modQueue;
    if (!channelId) return;
    const locale = this.ctx.config.locale;
    const label = this.flow.ui.factionLabel(team, locale);
    try {
      await this.ctx.gateway.sendMessage(channelId, {
        persona: 'cerebro',
        embeds: [
          {
            title: squadText(this.ctx.i18n, 'queue_title', {}, locale),
            description: squadText(this.ctx.i18n, 'queue_body', { name, team: label }, locale),
          },
        ],
        components: [
          [
            {
              type: 'button',
              customId: customId('cerebro', V, 'squad-approve', squadId),
              label: squadText(this.ctx.i18n, 'approve_button', {}, locale),
              style: 'success',
            },
            {
              type: 'button',
              customId: customId('cerebro', V, 'squad-refuse', squadId),
              label: squadText(this.ctx.i18n, 'refuse_button', {}, locale),
              style: 'danger',
            },
          ],
        ],
      });
    } catch (err) {
      this.ctx.log.warn({ err, squadId }, 'could not post the squad request');
    }
  }

  private async dm(squad: SquadRow, key: string, vars: Record<string, string | number>): Promise<void> {
    const founder = await this.flow.repo.memberById(squad.founderMemberId);
    if (!founder) return;
    const locale = await this.ctx.i18n.localeFor(founder.discordUserId);
    try {
      await this.ctx.gateway.sendDm(founder.discordUserId, {
        persona: 'cerebro',
        content: squadText(this.ctx.i18n, key, vars, locale),
      });
    } catch (err) {
      if (err instanceof GatewayError && err.code === 50007) return;
      this.ctx.log.warn({ err, squadId: squad.id }, 'could not DM the squad founder');
    }
  }

  private async recordAudit(
    source: 'command' | 'dashboard',
    action: string,
    actorId: string,
    squadId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit().record({
      actorDiscordId: actorId,
      source,
      action,
      target: squadId,
      details: { ok: true, ...details },
    });
  }
}

/** Staff-facing text. `discord_failed` nests a second locale key in `fix`. */
export function renderSquadOutcome(i18n: I18n, outcome: SquadOutcome, locale: Locale): string {
  const vars = { ...(outcome.vars ?? {}) };
  if (typeof vars.team === 'string') {
    const label = i18n.t(`cerebro.faction.${vars.team}.name`, {}, locale);
    if (label !== `cerebro.faction.${vars.team}.name`) vars.team = label;
  }
  if (typeof vars.fix === 'string') vars.fix = squadText(i18n, vars.fix, vars, locale);
  return squadText(i18n, outcome.key, vars, locale);
}
