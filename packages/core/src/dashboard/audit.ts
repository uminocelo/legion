import { lt } from 'drizzle-orm';
import { coreTables } from '../db/core-tables.js';
import type { Executor, LegionDb } from '../db/db.js';

const FREE_TEXT_MAX = 200;
const DETAILS_MAX = 2048;

export interface AuditEntry {
  actorDiscordId: string;
  source: 'dashboard' | 'command';
  action: string;
  target?: string | null;
  /** Inputs and outcome; strings are cut at 200 chars and the JSON at 2 KB. Never pass secrets. */
  details: Record<string, unknown>;
}

const cut = (v: unknown): unknown =>
  typeof v === 'string' ? (v.length > FREE_TEXT_MAX ? `${v.slice(0, FREE_TEXT_MAX)}…` : v) : v;

/** Audit details as stored: free text cut at 200 chars, the whole JSON at most 2 KB. */
export function auditDetails(details: Record<string, unknown>): string {
  const clean = Object.fromEntries(
    Object.entries(details).map(([k, v]) => [
      k,
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([a, b]) => [a, cut(b)]))
        : cut(v),
    ]),
  );
  const json = JSON.stringify(clean);
  return json.length <= DETAILS_MAX
    ? json
    : JSON.stringify({ truncated: true, ...('ok' in clean ? { ok: clean.ok } : {}) });
}

/** Append-only staff audit log in `core_audit_log` (security.md § v1.0). */
export class AuditLog {
  constructor(
    private readonly db: LegionDb,
    private readonly guildId: string,
    private readonly now: () => Date,
    private readonly newId: () => string,
  ) {}

  async record(e: AuditEntry, ex: Executor = this.db.orm): Promise<void> {
    await ex.insert(coreTables(this.db).coreAuditLog).values({
      id: this.newId(),
      guildId: this.guildId,
      actorDiscordId: e.actorDiscordId,
      source: e.source,
      action: e.action,
      target: e.target ?? null,
      details: auditDetails(e.details),
      createdAt: this.now().toISOString(),
    });
  }

  /** Deletes rows older than `days` (daily job). */
  async purgeOlderThan(days: number): Promise<number> {
    const a = coreTables(this.db).coreAuditLog;
    const before = new Date(this.now().getTime() - days * 86_400_000).toISOString();
    return (await this.db.orm.delete(a).where(lt(a.createdAt, before)).returning({ id: a.id })).length;
  }
}
