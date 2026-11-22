import { randomInt } from 'node:crypto';
import {
  AuditLog,
  type BotContext,
  customId,
  factionAllowsOrigin,
  GatewayError,
  type I18n,
  isCanonName,
  type Locale,
  normalizeName,
} from '@legion/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { CerebroConfig } from './config.js';
import { cerebroTables } from './db/tables.js';
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

/**
 * Squads (US-35). One write path for request, approval, leave and archive.
 * Joining by link or code is added in stream 2 on top of these tables.
 */
export class Squads {
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
    await this.dropDiscordMember(squad, o.discordUserId);
    await this.ctx.bus.transaction(async (tx) => {
      const t = this.tables().cerebroSquadMembers;
      await tx.delete(t).where(eq(t.memberId, member.id));
      await this.ctx.bus.emit(tx, 'squad.left', {
        squadId: squad.id,
        discordUserId: o.discordUserId,
        reason: 'left',
      });
    });
    return yes('left', { name: squad.name });
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
      if (squad.roleId) await this.gone(() => this.ctx.gateway.deleteRole(squad.roleId as string, reason));
      if (squad.threadId)
        await this.gone(() => this.ctx.gateway.deleteChannel(squad.threadId as string, reason));
      if (squad.inviteCode)
        await this.gone(() => this.ctx.gateway.deleteInvite(squad.inviteCode as string, reason));
    } catch (err) {
      return this.discordFailed(err);
    }
    const seats = await this.seats(squad.id);
    const now = this.ctx.clock.now().toISOString();
    await this.ctx.bus.transaction(async (tx) => {
      const squads = this.tables().cerebroSquads;
      const updated = await tx
        .update(squads)
        .set({ status: 'archived', decidedAt: now, decidedBy: o.actorId, refuseReason: reason })
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
          reason: 'archived',
        });
      }
    });
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
    if (saved) return invite.code;
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
