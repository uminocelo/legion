import type { AnyLegionBot, BotId } from '@legion/core';

/** Bots shipped in this image, loaded on demand so disabled bots cost nothing. */
const LOADERS: Partial<Record<BotId, () => Promise<AnyLegionBot>>> = {
  cerebro: async () => (await import('@legion/bot-cerebro')).cerebro,
  jarvis: async () => (await import('@legion/bot-jarvis')).jarvis,
  herbie: async () => (await import('@legion/bot-herbie')).herbie,
  sentinel: async () => (await import('@legion/bot-sentinel')).sentinel,
  ultron: async () => (await import('@legion/bot-ultron')).ultron,
};

export const AVAILABLE_BOTS = Object.keys(LOADERS) as BotId[];

export class UnavailableBotError extends Error {
  constructor(readonly ids: BotId[]) {
    super(
      `Bot(s) not available in this version: ${ids.join(', ')}. Available: ${AVAILABLE_BOTS.join(', ')}. ` +
        'Remove them from "bots:" in legion.config.yaml or update the image.',
    );
    this.name = 'UnavailableBotError';
  }
}

export async function loadBotModules(ids: readonly BotId[]): Promise<AnyLegionBot[]> {
  const missing = ids.filter((id) => !LOADERS[id]);
  if (missing.length) throw new UnavailableBotError(missing);
  return Promise.all(ids.map((id) => (LOADERS[id] as () => Promise<AnyLegionBot>)()));
}
