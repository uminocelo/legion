import type { IncomingMessage, ServerResponse } from 'node:http';

/** Headers on every dashboard response (security.md § v1.0). */
export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
};

export const SESSION_COOKIE = 'legion_session';
export const STATE_COOKIE = 'legion_oauth_state';

export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    try {
      if (!out.has(name)) out.set(name, decodeURIComponent(value));
    } catch {
      // malformed value: ignore the cookie
    }
  }
  return out;
}

export interface CookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
}

/** `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` on https; max age 0 clears it. */
export function cookie(name: string, value: string, o: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(o.maxAgeSeconds))}`,
  ];
  if (o.secure) parts.push('Secure');
  return parts.join('; ');
}

/** Reads a small urlencoded body; null when too large. */
export async function readForm(req: IncomingMessage, maxBytes = 8192): Promise<URLSearchParams | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) return null;
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for HTML content and attribute values. */
export const escapeHtml = (v: unknown): string => String(v).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

export function send(
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string | string[]> = {},
): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

export function redirect(
  res: ServerResponse,
  location: string,
  headers: Record<string, string | string[]> = {},
) {
  res.writeHead(302, { ...SECURITY_HEADERS, location, ...headers });
  res.end();
}
