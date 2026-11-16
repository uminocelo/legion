import { coreTables, createTestContext, type EventType, type TestContext } from '@legion/core';
import { eq } from 'drizzle-orm';
import { cerebro } from '../src/index.js';

export const CH = {
  welcome: '300000000000000001',
  rules: '300000000000000002',
  registry: '300000000000000003',
  general: '300000000000000004',
};
export const USER = '400000000000000001';

export async function setupCerebro(config: Record<string, unknown> = {}): Promise<TestContext> {
  const t = await createTestContext({
    bots: [cerebro],
    config: { channels: { welcome: CH.welcome, rules: CH.rules, registry: CH.registry }, ...config },
  });
  for (const [name, id] of Object.entries(CH)) t.gateway.addChannel({ id, name });
  await t.runtime.ready({ startPolling: false }); // role sync on ready
  return t;
}

export async function events(t: TestContext, type: EventType) {
  const log = coreTables(t.db).coreEventLog;
  const rows = await t.db.orm.select().from(log).where(eq(log.type, type));
  return rows.map((r) => JSON.parse(r.payload));
}

export async function join(t: TestContext, userId = USER) {
  const member = t.gateway.members.get(userId) ?? t.gateway.addMember({ userId });
  await t.runtime.guildEvents.memberAdded(member);
  await t.runtime.bus.drain();
}

export const FIELDS = {
  codinome: 'Faísca Rubra',
  poder: 'Cria faíscas que cegam',
  origem: 'Acordou no meio de uma tempestade.',
};

/** Walks the whole onboarding for a member. */
export async function register(
  t: TestContext,
  userId = USER,
  opts: { faction?: string; fields?: Partial<typeof FIELDS> } = {},
) {
  await join(t, userId);
  await t.interact({ kind: 'component', userId, customId: 'cerebro:v1:start' });
  await t.interact({ kind: 'component', userId, customId: 'cerebro:v1:rules' });
  await t.interact({
    kind: 'component',
    userId,
    customId: 'cerebro:v1:faction',
    values: [opts.faction ?? 'xmen'],
  });
  await t.interact({ kind: 'component', userId, customId: 'cerebro:v1:archetype', values: ['Elemental'] });
  return t.interact({
    kind: 'modal',
    userId,
    customId: 'cerebro:v1:mutant',
    fields: { ...FIELDS, ...opts.fields },
  });
}
