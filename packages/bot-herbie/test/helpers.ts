import { CerebroRepo, cerebro } from '@legion/bot-cerebro';
import { jarvis, jarvisServices } from '@legion/bot-jarvis';
import {
  type AnyLegionBot,
  coreTables,
  createTestContext,
  type EventPayloads,
  type EventType,
  type TestContext,
} from '@legion/core';
import { eq } from 'drizzle-orm';
import { herbie, herbieServices } from '../src/index.js';

export const CH = {
  welcome: '300000000000000001',
  tutorial: '300000000000000009',
  events: '300000000000000008',
};

export async function setupHerbie(
  opts: {
    jarvis?: boolean;
    config?: Record<string, unknown>;
    apps?: { key: string; bots: ('herbie' | 'jarvis')[] }[];
  } = {},
) {
  const bots: AnyLegionBot[] = [cerebro, ...(opts.jarvis === false ? [] : [jarvis]), herbie];
  return createTestContext({
    bots,
    config: { channels: { welcome: CH.welcome }, ...opts.config },
    ...(opts.apps ? { apps: opts.apps } : {}),
  });
}

export const servicesOf = (t: TestContext) => herbieServices(t.ctxOf(herbie));
export const xpLedger = async (t: TestContext, memberId: string) =>
  (await jarvisServices(t.ctxOf(jarvis)).repo.ledgerFor(memberId)).map((l) => [l.reason, l.amount]);

/** A registered member row (what Cérebro onboarding creates). */
export async function addMember(t: TestContext, discordUserId: string) {
  t.gateway.members.get(discordUserId) ?? t.gateway.addMember({ userId: discordUserId });
  const repo = new CerebroRepo(t.db, t.gateway.guildId, t.clock, t.runtime.newId);
  const { row } = await repo.ensureMember(discordUserId);
  await repo.updateMember(row.id, { onboardingStep: 'registered', faction: 'xmen' });
  return row.id;
}

/** Emits an event as another bot would, then waits for consumers. */
export async function emit<T extends EventType>(
  t: TestContext,
  type: T,
  payload: EventPayloads[T],
  source: 'cerebro' | 'jarvis' | 'core' = 'cerebro',
) {
  const e = await t.runtime.bus.forSource(source as never).emit(t.db.orm, type, payload);
  await t.runtime.bus.drain();
  return e;
}

export async function playerCreated(t: TestContext, discordUserId: string) {
  const memberId = await addMember(t, discordUserId);
  await emit(t, 'player.created', {
    memberId,
    discordUserId,
    mutantId: `mut-${discordUserId}`,
    codename: `Nome${discordUserId}`,
    archetype: 'Elemental',
    faction: 'xmen',
  });
  return memberId;
}

export async function events<T extends EventType>(t: TestContext, type: T): Promise<EventPayloads[T][]> {
  const log = coreTables(t.db).coreEventLog;
  const rows = await t.db.orm.select().from(log).where(eq(log.type, type));
  return rows.map((r) => JSON.parse(r.payload));
}

/** The tutorial messages a member got: DMs and channel posts mentioning them. */
export function messagesTo(t: TestContext, discordUserId: string) {
  const dms = t.gateway
    .callsOf('sendDm')
    .filter((c) => c[0] === discordUserId && !t.gateway.closedDms.has(discordUserId))
    .map((c) => ({ via: 'dm', msg: c[1] }));
  const posts = t.gateway
    .callsOf('sendMessage')
    .filter((c) => String((c[1] as { content?: string }).content ?? '').includes(`<@${discordUserId}>`))
    .map((c) => ({ via: `channel:${c[0]}`, msg: c[1] }));
  return [...dms, ...posts] as {
    via: string;
    msg: { content?: string; embeds?: { title?: string; description?: string }[] };
  }[];
}
