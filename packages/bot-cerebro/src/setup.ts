import {
  GatewayError,
  type HierarchyProblem,
  isEmptyPlan,
  planRoleSync,
  type RoleSyncResult,
} from '@legion/core';
import { toMemberView } from './db/repo.js';
import { planChannelVisibility } from './domain/channels.js';
import { expectedRoles } from './domain/onboarding.js';
import type { CerebroFlow } from './flow.js';

export const LAST_ROLE_SYNC_KEY = 'cerebro.lastRoleSync';
export const PERSISTENT_WELCOME_KEY = 'cerebro.persistentWelcome';
const MAX_LINES = 40;

export interface LastRoleSync {
  at: string;
  created: string[];
  recolored: string[];
  errors: { key: string; error: string }[];
}

/** Role sync, channel visibility, persistent welcome and member reconcile (`/cerebro setup`, `onReady`). */
export class CerebroSetup {
  constructor(private readonly flow: CerebroFlow) {}

  private get ctx() {
    return this.flow.ctx;
  }
  private t(key: string, vars: Record<string, string | number> = {}) {
    return this.ctx.i18n.t(`cerebro.setup.${key}`, vars);
  }

  async syncRoles(apply: boolean): Promise<{ lines: string[]; result: RoleSyncResult | null }> {
    const plan = planRoleSync(await this.ctx.roles.refresh(), this.ctx.config.roles);
    const lines = isEmptyPlan(plan)
      ? [this.t('roles_none')]
      : [
          ...plan.create.map((r) => `• ${this.t('roles_create', { name: r.name })}`),
          ...plan.updateColor.map((u) => `• ${this.t('roles_color', { name: u.name })}`),
        ];
    if (!apply) return { lines, result: null };
    const result = await this.ctx.roles.applySyncPlan(plan);
    const record: LastRoleSync = { at: this.ctx.clock.now().toISOString(), ...result };
    await this.ctx.kv.set(LAST_ROLE_SYNC_KEY, record);
    if (result.errors.length)
      lines.push(this.t('errors', { errors: result.errors.map((e) => `${e.key} (${e.error})`).join(', ') }));
    return { lines, result };
  }

  async hierarchyProblems(): Promise<HierarchyProblem[]> {
    return this.ctx.roles.checkHierarchy(this.ctx.roles.keysManagedBy('cerebro'));
  }

  hierarchyLine(problems: HierarchyProblem[]): string | null {
    return problems.length
      ? this.t('hierarchy_warning', { roles: problems.map((p) => p.name).join(', ') })
      : null;
  }

  async channels(apply: boolean): Promise<string[]> {
    const registered = await this.ctx.roles.resolve('registered');
    const { welcome, rules } = this.ctx.config.channels;
    const plan = planChannelVisibility({
      channels: await this.ctx.gateway.fetchChannels(),
      everyoneRoleId: this.ctx.guildId,
      registeredRoleId: registered?.id ?? 'registered-role-not-created-yet',
      botUserId: this.ctx.gateway.botUserId,
      welcomeId: welcome,
      rulesId: rules,
      excludeIds: this.ctx.botConfig.setup.excludeChannelIds,
    });
    if (plan.length === 0) return [this.t('channels_none')];
    const lines: string[] = [];
    const failed = new Set<string>();
    for (const c of plan) {
      if (c.kind !== 'keep_bot_access')
        lines.push(
          `• ${this.t(c.kind === 'hide_from_everyone' ? 'channel_hide' : 'channel_show', { channel: c.channelName })}`,
        );
      // Stop at the first failure in a channel: never deny @everyone after the earlier steps failed.
      if (!apply || !registered || failed.has(c.channelId)) continue;
      try {
        await this.ctx.gateway.setChannelPermissionOverwrite(c.channelId, c.overwrite);
      } catch (err) {
        failed.add(c.channelId);
        this.ctx.log.warn({ err, channelId: c.channelId }, 'could not set channel overwrite');
        lines.push(`  ⚠️ #${c.channelName}: ${(err as Error).message}`);
      }
    }
    return lines;
  }

  /** Posts or refreshes the persistent welcome message (id stored in core_kv). */
  async persistentWelcome(): Promise<string> {
    const channelId = this.ctx.config.channels.welcome;
    if (!channelId) return this.t('welcome_message', { status: this.t('welcome_missing_channel') });
    const msg = this.flow.ui.welcome(null);
    const stored = await this.ctx.kv.get<{ channelId: string; messageId: string }>(PERSISTENT_WELCOME_KEY);
    if (stored?.channelId === channelId) {
      try {
        await this.ctx.gateway.editMessage(channelId, stored.messageId, msg);
        return this.t('welcome_message', { status: this.t('welcome_refreshed') });
      } catch (err) {
        if (!(err instanceof GatewayError) || err.code !== 10008) throw err;
      }
    }
    const sent = await this.ctx.gateway.sendMessage(channelId, msg);
    await this.ctx.kv.set(PERSISTENT_WELCOME_KEY, { channelId, messageId: sent.messageId });
    return this.t('welcome_message', { status: this.t('welcome_posted') });
  }

  /** Registered members (in the DB) whose Discord roles are missing something. */
  async membersMissingRoles(limit = 200): Promise<string[]> {
    const rows = (await this.flow.repo.listRegistered()).slice(0, limit);
    const missing: string[] = [];
    for (const row of rows) {
      const member = await this.ctx.gateway.fetchMember(row.discordUserId);
      if (!member) continue;
      const view = toMemberView(row);
      const { add } = expectedRoles({
        onboardingStep: view.onboardingStep,
        factionRoleKey: this.flow.factionRoleKey(row.faction),
        rank: view.rank,
        optIns: view.optIns,
      });
      const ids = await this.ctx.roles.idsFor(add);
      if ([...ids.values()].some((id) => !member.roleIds.includes(id))) missing.push(row.id);
    }
    return missing;
  }

  async run(opts: { apply: boolean; channels: boolean }): Promise<string> {
    const out: string[] = [opts.apply ? this.t('applied') : this.t('dry_run')];
    out.push(...(await this.syncRoles(opts.apply)).lines);
    if (opts.channels) out.push(...(await this.channels(opts.apply)));
    if (opts.apply && this.ctx.botConfig.persistentWelcome) {
      out.push(
        await this.persistentWelcome().catch((err: Error) => {
          this.ctx.log.warn({ err }, 'could not post the persistent welcome message');
          return this.t('welcome_message', { status: `⚠️ ${err.message}` });
        }),
      );
    }
    if (opts.apply) {
      const missing = await this.membersMissingRoles();
      for (const memberId of missing) {
        const row = await this.flow.repo.memberById(memberId);
        if (row) await this.flow.applyExpectedRoles(row);
      }
      if (missing.length) out.push(this.t('reconciled', { count: missing.length }));
    }
    const warn = this.hierarchyLine(await this.hierarchyProblems());
    if (warn) out.push(warn);
    return truncate(out, (count) => this.t('truncated', { count }));
  }
}

function truncate(lines: string[], more: (n: number) => string): string {
  const kept = lines.slice(0, MAX_LINES);
  if (lines.length > MAX_LINES) kept.push(more(lines.length - MAX_LINES));
  let text = kept.join('\n');
  if (text.length > 1900) text = `${text.slice(0, 1900)}\n…`;
  return text;
}
