import { type Executor, factionAllowsOrigin, type LegionEvent } from '@legion/core';
import type { MemberRow } from './db/repo.js';
import type { CerebroFlow } from './flow.js';

export const FACTION_JOIN = 'cerebro.faction-join';

/**
 * The single write path for a team switch: audit row (unique `source_key`), `members.faction`,
 * `faction_changed_at` and `player.faction_changed`, in the caller's transaction. Returns null when
 * the member vanished, is already on the team, or this `sourceKey` was already recorded.
 */
export async function recordFactionChange(
  flow: CerebroFlow,
  tx: Executor,
  v: { memberId: string; to: string; reason: 'arc' | 'staff'; sourceKey: string; by: string | null },
): Promise<MemberRow | null> {
  const { ctx, repo } = flow;
  const fresh = await repo.memberById(v.memberId, tx);
  if (!fresh || fresh.faction === v.to) return null;
  const inserted = await repo.insertFactionChange(
    { memberId: fresh.id, from: fresh.faction, to: v.to, reason: v.reason, sourceKey: v.sourceKey, by: v.by },
    tx,
  );
  if (!inserted) return null;
  const member = await repo.updateMember(
    fresh.id,
    { faction: v.to, factionChangedAt: ctx.clock.now().toISOString() },
    tx,
  );
  await ctx.bus.emit(tx, 'player.faction_changed', {
    memberId: fresh.id,
    discordUserId: fresh.discordUserId,
    from: fresh.faction,
    to: v.to,
    reason: v.reason,
    sourceKey: v.sourceKey,
  });
  return member;
}

/**
 * `faction.join_requested` (J.A.R.V.I.S., end of a recruitment arc). Cérebro alone decides (ADR 0032,
 * D12): enabled team, origin rule, same team, cooldown since the last switch. Delivery is at least
 * once: a `sourceKey` already in the audit table is a no-op.
 */
export class FactionJoin {
  constructor(private readonly flow: CerebroFlow) {}

  async onRequest(e: LegionEvent<'faction.join_requested'>): Promise<void> {
    const { ctx, repo } = this.flow;
    const { memberId, faction, sourceKey } = e.payload;
    if (await repo.factionChangeBySource(sourceKey)) return; // duplicate request
    const row = await repo.memberById(memberId);
    const mutant = row?.onboardingStep === 'registered' ? await repo.mutantByMemberId(row.id) : null;
    if (!row || row.leftAt || !mutant) {
      ctx.log.info(
        { memberId, sourceKey },
        'faction join for a member who left or is not registered; ignored',
      );
      return;
    }
    const refuse = async (code: 'cooldown' | 'origin' | 'disabled' | 'same', availableAt?: string) => {
      await ctx.bus.transaction((tx) =>
        ctx.bus.emit(tx, 'player.faction_change_refused', {
          memberId,
          faction,
          sourceKey,
          code,
          ...(availableAt ? { availableAt } : {}),
        }),
      );
    };
    const team = ctx.config.factions.find((f) => f.key === faction);
    if (!team) return refuse('disabled');
    if (row.faction === faction) return refuse('same');
    if (!factionAllowsOrigin(team, mutant.originType)) return refuse('origin');
    const days = ctx.botConfig.teams.switchCooldownDays;
    if (row.factionChangedAt && days > 0) {
      const until = new Date(new Date(row.factionChangedAt).getTime() + days * 86_400_000);
      if (until > ctx.clock.now()) return refuse('cooldown', until.toISOString());
    }
    const updated = await ctx.bus.transaction((tx) =>
      recordFactionChange(this.flow, tx, { memberId, to: faction, reason: 'arc', sourceKey, by: null }),
    );
    if (updated && !(await this.flow.applyExpectedRoles(updated)))
      ctx.log.warn({ memberId, faction }, 'team joined, but the role could not be changed');
  }
}
