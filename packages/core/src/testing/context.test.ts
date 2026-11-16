import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LegionBot } from '../bot.js';
import { createTestContext } from './context.js';

describe('createTestContext', () => {
  it('builds a BotContext for a bot in one call', async () => {
    const bot: LegionBot<{ n: number }> = {
      id: 'cerebro',
      version: '0',
      configSchema: z.object({ n: z.number().default(3) }),
      intents: [],
      permissions: [],
      commands: () => [],
      register: () => {},
    };
    const t = await createTestContext({ bots: [bot] });
    try {
      const ctx = t.ctxOf(bot);
      expect(ctx.botConfig.n).toBe(3);
      expect(ctx.clock.now().toISOString()).toBe('2026-11-16T15:00:00.000Z');
      expect(ctx.random.create(1).d(6)).toBe(ctx.random.create(1).d(6));
      expect(await ctx.db.ping()).toBe(true);
      expect(await ctx.isStaff({ isGuildOwner: true, memberRoleIds: [] })).toBe(true);
      expect(await ctx.isStaff({ isGuildOwner: false, memberRoleIds: [] })).toBe(false);
    } finally {
      await t.close();
    }
  });
});
