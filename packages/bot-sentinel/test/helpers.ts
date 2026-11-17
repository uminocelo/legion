import { CerebroRepo, cerebro } from '@legion/bot-cerebro';
import { jarvis } from '@legion/bot-jarvis';
import {
  type AnyLegionBot,
  type Combatant,
  coreTables,
  createTestContext,
  type EventPayloads,
  type EventType,
  type TestContext,
} from '@legion/core';
import { eq } from 'drizzle-orm';
import { sentinel, sentinelServices } from '../src/index.js';

export const CH = {
  combat: '300000000000000010',
  modQueue: '300000000000000011',
  welcome: '300000000000000001',
};

export async function setupSentinel(opts: { config?: Record<string, unknown>; jarvis?: boolean } = {}) {
  const bots: AnyLegionBot[] = [cerebro, ...(opts.jarvis === false ? [] : [jarvis]), sentinel];
  const t = await createTestContext({
    bots,
    config: { channels: { welcome: CH.welcome, combat: CH.combat, modQueue: CH.modQueue }, ...opts.config },
  });
  t.gateway.addChannel({ id: CH.combat, name: 'combate', kind: 'text', parentId: null });
  t.gateway.addChannel({ id: CH.modQueue, name: 'mod-queue', kind: 'text', parentId: null });
  return t;
}

export const servicesOf = (t: TestContext) => sentinelServices(t.ctxOf(sentinel));

export async function addMember(t: TestContext, discordUserId: string) {
  t.gateway.members.get(discordUserId) ?? t.gateway.addMember({ userId: discordUserId });
  const repo = new CerebroRepo(t.db, t.gateway.guildId, t.clock, t.runtime.newId);
  const { row } = await repo.ensureMember(discordUserId);
  await repo.updateMember(row.id, { onboardingStep: 'registered', faction: 'xmen' });
  return row.id;
}

export async function emit<T extends EventType>(
  t: TestContext,
  type: T,
  payload: EventPayloads[T],
  source: 'ultron' | 'jarvis' | 'core' = 'ultron',
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

export const player = (id: string, refId: string, o: Partial<Combatant> = {}): Combatant => ({
  id,
  side: 'players',
  kind: 'player',
  refId,
  name: `Mutante ${id}`,
  archetype: 'Elemental',
  level: 1,
  stats: { hp: 95, atk: 12, def: 6, spd: 9, foc: 10 },
  powerCooldown: 0,
  ...o,
});
export const enemy = (id: string, o: Partial<Combatant> = {}): Combatant => ({
  id,
  side: 'enemies',
  kind: 'enemy',
  refId: 'ultron',
  name: `Sentinela ${id}`,
  archetype: null,
  level: 1,
  stats: { hp: 60, atk: 8, def: 5, spd: 7, foc: 6 },
  powerCooldown: 0,
  ...o,
});

/** combat.requested as another bot (ULTRON) would send it. */
export const request = (
  combatId: string,
  participants: Combatant[],
  o: Partial<EventPayloads['combat.requested']> = {},
): EventPayloads['combat.requested'] => ({
  combatId,
  requestedBy: 'ultron',
  mode: 'party',
  missionId: null,
  raidId: null,
  channelId: CH.combat,
  participants,
  maxRounds: 20,
  ...o,
});

/** The last round prompt posted for a combat (embed + buttons). */
export function lastPrompt(t: TestContext) {
  return t.gateway.messages
    .filter((m) =>
      m.msg.components?.[0]?.some((c) => c.type === 'button' && c.customId?.startsWith('sentinel:v1:act:')),
    )
    .at(-1);
}
export const actId = (combatId: string, round: number, action: string) =>
  `sentinel:v1:act:${combatId}:${round}:${action}`;
