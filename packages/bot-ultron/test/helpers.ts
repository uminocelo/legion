import { CerebroRepo, cerebro } from '@legion/bot-cerebro';
import { jarvis } from '@legion/bot-jarvis';
import { sentinel } from '@legion/bot-sentinel';
import {
  type AnyLegionBot,
  coreTables,
  createTestContext,
  type EventPayloads,
  type EventType,
  type TestContext,
} from '@legion/core';
import { eq } from 'drizzle-orm';
import { ultron, ultronServices } from '../src/index.js';

export const CH = {
  combat: '300000000000000010',
  events: '300000000000000012',
  welcome: '300000000000000001',
};

export async function setupUltron(
  opts: { config?: Record<string, unknown>; jarvis?: boolean; start?: string } = {},
) {
  const bots: AnyLegionBot[] = [cerebro, ...(opts.jarvis === false ? [] : [jarvis]), sentinel, ultron];
  const { channels, ...rest } = (opts.config ?? {}) as { channels?: Record<string, string> };
  const t = await createTestContext({
    bots,
    ...(opts.start ? { start: opts.start } : {}),
    config: { channels: { welcome: CH.welcome, combat: CH.combat, events: CH.events, ...channels }, ...rest },
  });
  for (const [id, name] of [
    [CH.combat, 'combate'],
    [CH.events, 'eventos'],
  ] as const)
    t.gateway.addChannel({ id, name, kind: 'text', parentId: null });
  return t;
}

export const servicesOf = (t: TestContext) => ultronServices(t.ctxOf(ultron));

export async function addMember(t: TestContext, discordUserId: string, faction = 'xmen') {
  t.gateway.members.get(discordUserId) ?? t.gateway.addMember({ userId: discordUserId });
  const repo = new CerebroRepo(t.db, t.gateway.guildId, t.clock, t.runtime.newId);
  const { row } = await repo.ensureMember(discordUserId);
  await repo.updateMember(row.id, { onboardingStep: 'registered', faction });
  return row.id;
}

export async function emit<T extends EventType>(
  t: TestContext,
  type: T,
  payload: EventPayloads[T],
  source = 'jarvis',
) {
  const e = await t.runtime.bus.forSource(source as never).emit(t.db.orm, type, payload);
  await t.runtime.bus.drain();
  return e;
}

export async function events<T extends EventType>(t: TestContext, type: T): Promise<EventPayloads[T][]> {
  const log = coreTables(t.db).coreEventLog;
  const rows = await t.db.orm.select().from(log).where(eq(log.type, type));
  return rows.map((r) => JSON.parse(r.payload));
}
