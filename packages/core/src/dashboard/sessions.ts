import { createHash, randomBytes } from 'node:crypto';
import { eq, lte } from 'drizzle-orm';
import { coreTables } from '../db/core-tables.js';
import type { LegionDb } from '../db/db.js';
import type { Clock } from '../time/clock.js';

/** A logged-in dashboard session (the raw token only lives in the browser cookie). */
export interface DashboardSession {
  tokenHash: string;
  discordUserId: string;
  csrfToken: string;
  expiresAt: string;
}

/** SHA-256 hex of a session token: the only form stored in the database. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Random URL-safe token (32 bytes). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** `last_seen_at` is refreshed at most this often, so each request does not write. */
const SEEN_EVERY_MS = 60_000;

/** Dashboard sessions in `core_dashboard_sessions`. */
export class DashboardSessionStore {
  constructor(
    private readonly db: LegionDb,
    private readonly clock: Clock,
    private readonly sessionHours: number,
  ) {}

  private get t() {
    return coreTables(this.db).coreDashboardSessions;
  }

  /** A new session for the user; returns the raw token for the cookie. */
  async create(discordUserId: string): Promise<{ token: string; session: DashboardSession }> {
    const now = this.clock.now();
    const token = randomToken();
    const row = {
      tokenHash: hashToken(token),
      discordUserId,
      csrfToken: randomToken(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.sessionHours * 3_600_000).toISOString(),
      lastSeenAt: now.toISOString(),
    };
    await this.db.orm.insert(this.t).values(row);
    return { token, session: row };
  }

  /** The live session for a cookie token; an expired one is deleted and gives null. */
  async find(token: string): Promise<DashboardSession | null> {
    const t = this.t;
    const tokenHash = hashToken(token);
    const [row] = await this.db.orm.select().from(t).where(eq(t.tokenHash, tokenHash)).limit(1);
    if (!row) return null;
    const now = this.clock.now();
    if (row.expiresAt <= now.toISOString()) {
      await this.deleteHash(tokenHash);
      return null;
    }
    if (now.getTime() - new Date(row.lastSeenAt).getTime() >= SEEN_EVERY_MS)
      await this.db.orm.update(t).set({ lastSeenAt: now.toISOString() }).where(eq(t.tokenHash, tokenHash));
    return {
      tokenHash: row.tokenHash,
      discordUserId: row.discordUserId,
      csrfToken: row.csrfToken,
      expiresAt: row.expiresAt,
    };
  }

  async delete(token: string): Promise<void> {
    await this.deleteHash(hashToken(token));
  }

  async deleteHash(tokenHash: string): Promise<void> {
    await this.db.orm.delete(this.t).where(eq(this.t.tokenHash, tokenHash));
  }

  /** Deletes expired sessions (daily job). Returns how many. */
  async purgeExpired(): Promise<number> {
    const rows = await this.db.orm
      .delete(this.t)
      .where(lte(this.t.expiresAt, this.clock.now().toISOString()))
      .returning({ tokenHash: this.t.tokenHash });
    return rows.length;
  }
}
