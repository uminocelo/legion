import type { CerebroFlow } from './flow.js';

/**
 * Memory of squad-invite use counts. A code this process has never seen is not "grown",
 * so the first fetch after a restart is only a baseline. `remember` at invite creation
 * lets the next join see the count move.
 */
export class InviteTracker {
  private readonly uses = new Map<string, number>();

  constructor(private readonly flow: CerebroFlow) {}

  remember(code: string, uses: number): void {
    this.uses.set(code, uses);
  }

  forget(code: string): void {
    this.uses.delete(code);
  }

  /** Ready: store Discord's current counts. Does not hint anyone. */
  async baseline(): Promise<void> {
    if (!this.flow.ctx.config.squads.enabled) return;
    try {
      const invites = await this.flow.ctx.gateway.fetchInvites();
      this.uses.clear();
      for (const inv of invites) this.uses.set(inv.code, inv.uses);
    } catch (err) {
      this.flow.ctx.log.warn({ err }, 'could not baseline squad invites');
    }
  }

  /**
   * The squad whose invite grew, when exactly one active squad invite did.
   * Zero or two or more returns null (debug log) and does not clear a hint.
   */
  async diff(): Promise<string | null> {
    const { ctx } = this.flow;
    if (!ctx.config.squads.enabled) return null;
    let invites: { code: string; uses: number }[];
    try {
      invites = await ctx.gateway.fetchInvites();
    } catch (err) {
      ctx.log.warn({ err }, 'could not read invites');
      return null;
    }
    const byCode = new Map(
      (await this.flow.squads.list(['active']))
        .filter((s) => s.inviteCode)
        .map((s) => [s.inviteCode as string, s.id]),
    );
    const grown: string[] = [];
    for (const inv of invites) {
      const squadId = byCode.get(inv.code);
      const prev = this.uses.get(inv.code);
      if (squadId && prev !== undefined && inv.uses > prev) grown.push(squadId);
    }
    const seen = new Set(invites.map((i) => i.code));
    for (const code of this.uses.keys()) if (!seen.has(code)) this.uses.delete(code);
    for (const inv of invites) this.uses.set(inv.code, inv.uses);
    if (grown.length !== 1) {
      ctx.log.debug({ grown: grown.length }, 'squad invite diff is not a single squad');
      return null;
    }
    return grown[0] ?? null;
  }
}
