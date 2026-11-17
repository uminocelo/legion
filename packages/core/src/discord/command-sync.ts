import { createHash } from 'node:crypto';
import type { KvStore } from '../db/kv.js';
import type { DiscordGateway } from './gateway.js';

export const COMMAND_HASH_KEY = 'core.commandHash';

/** Stable JSON: object keys sorted, so the hash only changes when the commands do. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const hashCommands = (commands: unknown[]): string =>
  createHash('sha256').update(canonicalJson(commands)).digest('hex');

/** Registers guild commands only when their JSON changed (or when forced). */
export async function syncCommands(
  gateway: DiscordGateway,
  kv: KvStore,
  commands: unknown[],
  force = false,
  appKey = 'main',
) {
  const key = appKey === 'main' ? COMMAND_HASH_KEY : `${COMMAND_HASH_KEY}:${appKey}`;
  const hash = hashCommands(commands);
  const prev = await kv.get<string>(key);
  if (!force && prev === hash) return { changed: false, hash };
  await gateway.registerCommands(commands);
  await kv.set(key, hash);
  return { changed: true, hash };
}
