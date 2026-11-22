import { activeSquadOf } from '@legion/bot-cerebro';
import type { LegionConfig, LegionDb } from '@legion/core';

/** Whether a player may see/start content scoped to `squadId` (null = global). */
export async function squadContentVisible(
  ctx: { db: LegionDb; config: LegionConfig },
  squadId: string | null,
  memberId: string,
): Promise<boolean> {
  if (!squadId) return true;
  if (!ctx.config.squads.enabled) return false;
  const seat = await activeSquadOf(ctx.db, memberId);
  return seat?.id === squadId;
}
