import type { DiscordGateway } from './gateway.js';
import type { IncomingAttachment } from './types.js';

const CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

/** True for https URLs on Discord's attachment CDN (nothing else is ever downloaded). */
export function isDiscordCdn(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && CDN_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export type AttachmentProblem = 'missing' | 'bad_type' | 'too_big' | 'bad_host' | 'download_failed';

/**
 * Reads a text attachment a staff member uploaded (e.g. a YAML content file): checks the name,
 * the declared size and the host before downloading, and the real size while downloading.
 */
export async function readTextAttachment(
  gateway: Pick<DiscordGateway, 'fetchAttachment'>,
  att: IncomingAttachment | undefined,
  o: { maxBytes: number; extensions: string[] },
): Promise<{ text: string } | { problem: AttachmentProblem }> {
  if (!att) return { problem: 'missing' };
  const lower = att.name.toLowerCase();
  if (!o.extensions.some((e) => lower.endsWith(e))) return { problem: 'bad_type' };
  if (att.size > o.maxBytes) return { problem: 'too_big' };
  if (!isDiscordCdn(att.url)) return { problem: 'bad_host' };
  try {
    return { text: await gateway.fetchAttachment(att.url, o.maxBytes) };
  } catch (err) {
    return { problem: /too large/i.test((err as Error).message) ? 'too_big' : 'download_failed' };
  }
}
