import type { AnyLegionBot, LegionBot } from '../bot.js';
import { parseConfig } from '../config/load.js';
import type { BotId, LegionConfig } from '../config/schema.js';
import { FakeDiscordGateway } from '../discord/fake-gateway.js';
import type { IncomingInteraction } from '../discord/types.js';
import { FakeRandomSource } from '../game/random.js';
import { CoreRuntime } from '../runtime.js';
import { silentLogger } from '../silent-log.js';
import { FakeClock } from '../time/clock.js';
import { createTestDb } from './db.js';

export interface TestContextOptions {
  config?: Record<string, unknown>;
  bots?: AnyLegionBot[];
  start?: string;
  seed?: number;
  /** Extra Discord apps (own fake gateway each) for bots with their own token. */
  apps?: { key: string; bots: BotId[] }[];
}

/**
 * Real DB (temp SQLite or isolated Postgres schema), FakeDiscordGateway, FakeClock, seeded random,
 * real bus/scheduler/router. Loads the given bots exactly like the runner does.
 */
export async function createTestContext(opts: TestContextOptions = {}) {
  const db = await createTestDb();
  const clock = new FakeClock(opts.start ?? '2026-11-16T15:00:00.000Z');
  const gateway = new FakeDiscordGateway();
  const bots = opts.bots ?? [];
  const schemas = Object.fromEntries(bots.map((b) => [b.id, b.configSchema]));
  const config: LegionConfig = parseConfig({ bots: bots.map((b) => b.id), ...opts.config }, schemas);
  const apps = (opts.apps ?? []).map((a, n) => ({
    ...a,
    gateway: new FakeDiscordGateway(`90000000000000010${n}`, gateway.guildId),
  }));
  const runtime = new CoreRuntime({
    ...(apps.length ? { apps } : {}),
    config,
    db,
    gateway,
    clock,
    random: new FakeRandomSource(opts.seed ?? 42),
    log: silentLogger(),
    guildId: gateway.guildId,
    roleGuard: 'throw',
  });
  await runtime.loadBots(bots);
  let seq = 0;
  /** Builds an interaction and routes it; returns its id (read replies with gateway.repliesTo). */
  const interact = async (
    i: Partial<IncomingInteraction> & Pick<IncomingInteraction, 'kind' | 'userId'>,
    app = 'main',
  ) => {
    const id = `int-${++seq}`;
    const member = gateway.members.get(i.userId);
    await runtime.router.handle(
      {
        id,
        guildId: gateway.guildId,
        channelId: '200000000000000001',
        memberRoleIds: member?.roleIds ?? [],
        isGuildOwner: false,
        locale: null,
        ...i,
      },
      app,
    );
    await runtime.bus.drain();
    return id;
  };
  return {
    db,
    clock,
    gateway,
    /** Fake gateway of each extra app, by key. */
    appGateways: new Map(apps.map((a) => [a.key, a.gateway])),
    runtime,
    config,
    interact,
    ctxOf: <C>(bot: LegionBot<C>) => runtime.contextFor(bot),
    settle: async () => {
      await runtime.bus.drain();
      await runtime.scheduler.tick();
      await runtime.bus.drain();
    },
    close: async () => {
      await runtime.stop(1000);
      await db.close();
    },
  };
}
export type TestContext = Awaited<ReturnType<typeof createTestContext>>;
