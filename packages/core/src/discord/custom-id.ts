import { BOT_IDS, type BotId } from '../config/schema.js';

export interface ParsedCustomId {
  bot: BotId;
  version: number;
  action: string;
  args: string[];
}

/** Builds `<bot>:v<n>:<action>[:<arg>...]` (max 100 chars). */
export function customId(bot: BotId, version: number, action: string, ...args: (string | number)[]): string {
  const id = [bot, `v${version}`, action, ...args.map(String)].join(':');
  if (id.length > 100) throw new Error(`custom id too long (${id.length}): ${id}`);
  return id;
}

export function parseCustomId(id: string): ParsedCustomId | null {
  const [bot, v, action, ...args] = id.split(':');
  if (!bot || !v || !action || !(BOT_IDS as readonly string[]).includes(bot)) return null;
  const m = /^v(\d+)$/.exec(v);
  if (!m) return null;
  return { bot: bot as BotId, version: Number(m[1]), action, args };
}
