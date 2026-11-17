import { CerebroRepo, cerebro } from '@legion/bot-cerebro';
import { coreTables, createTestContext, type EventType, type TestContext } from '@legion/core';
import { eq } from 'drizzle-orm';
import { jarvis, jarvisServices } from '../src/index.js';

export async function setupJarvis(
  config: Record<string, unknown> = {},
  start?: string,
): Promise<TestContext> {
  return createTestContext({ bots: [cerebro, jarvis], config, ...(start ? { start } : {}) });
}

export const servicesOf = (t: TestContext) => jarvisServices(t.ctxOf(jarvis));

/** A registered member row in Cérebro's table (what onboarding would create). */
export async function addMember(t: TestContext, discordUserId: string, faction = 'xmen') {
  t.gateway.members.get(discordUserId) ?? t.gateway.addMember({ userId: discordUserId });
  const repo = new CerebroRepo(t.db, t.gateway.guildId, t.clock, t.runtime.newId);
  const { row } = await repo.ensureMember(discordUserId);
  await repo.updateMember(row.id, { onboardingStep: 'registered', faction });
  return row.id;
}

export async function events(t: TestContext, type: EventType) {
  const log = coreTables(t.db).coreEventLog;
  const rows = await t.db.orm.select().from(log).where(eq(log.type, type)).orderBy(log.occurredAt, log.id);
  return rows.map((r) => JSON.parse(r.payload));
}

/** Awards XP through the single write path, like a consumer or trivia answer would. */
export async function award(
  t: TestContext,
  memberId: string,
  amount: number,
  sourceKey: string,
  reason: 'trivia' | 'grant' | 'admin_adjust' = 'grant',
) {
  const s = servicesOf(t);
  const r = await t.runtime.bus
    .forSource('jarvis')
    .transaction((tx) => s.xp.award(tx, { memberId, amount, reason, sourceKey }));
  await t.runtime.bus.drain();
  return r;
}
