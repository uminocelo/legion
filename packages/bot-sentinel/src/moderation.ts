import type {
  BotContext,
  IncomingInteraction,
  LegionEvent,
  Locale,
  OutgoingMessage,
  Responder,
} from '@legion/core';
import { customId, GatewayError } from '@legion/core';
import { V } from './combat.js';
import type { SentinelConfig } from './config.js';
import type { ReportRow, SafetyRepo } from './db/safety-repo.js';
import type { SafetyService } from './safety.js';

export const MOTIVOS = ['spam', 'assedio', 'conteudo', 'trapaca', 'outro'] as const;
export const modIds = {
  action: (reportId: string, action: string) => customId('sentinel', V, 'mod', reportId, action),
  reportMessage: (channelId: string, messageId: string, authorId: string) =>
    customId('sentinel', V, 'report-msg', channelId, messageId, authorId),
};
const SEVERITY_COLOR = { low: 0x5865f2, medium: 0xfee75c, high: 0xed4245 } as const;
const HOUR = 3_600_000;

/** Report intake, grouping, the staff queue and logged moderation actions. Nothing here is automatic. */
export class ModerationService {
  constructor(
    private readonly ctx: BotContext<SentinelConfig>,
    private readonly repo: SafetyRepo,
    private readonly safety: SafetyService,
  ) {}

  private t = (k: string, v: Record<string, string | number> = {}, l: Locale = this.ctx.config.locale) =>
    this.ctx.i18n.t(k, v, l);

  // ---------- intake ----------

  /** `sentinel.reports` on `report.flagged`: group with an open report from the last hour, or open a new one. */
  async onFlagged(e: LegionEvent<'report.flagged'>): Promise<void> {
    const p = e.payload;
    if (await this.repo.report(p.reportId)) return; // replayed
    const since = new Date(this.ctx.clock.now().getTime() - HOUR).toISOString();
    const group = await this.repo.openGroup(p.subjectDiscordUserId, p.reason, since);
    if (group) {
      const details = [group.details, p.details].filter(Boolean).join('\n').slice(-1500);
      const refs = { ...JSON.parse(group.refs), ...p.refs };
      await this.repo.updateReport(group.id, { count: group.count + 1, details, refs: JSON.stringify(refs) });
      await this.refreshQueue(group.id);
      return;
    }
    await this.repo.insertReport({
      id: p.reportId,
      subjectDiscordUserId: p.subjectDiscordUserId,
      reporter: p.reporter,
      reporterDiscordUserId: p.reporterDiscordUserId,
      reason: p.reason,
      severity: p.severity,
      details: p.details,
      refs: JSON.stringify(p.refs),
    });
    const channel = this.ctx.config.channels.modQueue;
    if (!channel) {
      this.ctx.log.warn(
        { reportId: p.reportId },
        'channels.modQueue is not set; report stored without a queue message',
      );
      return;
    }
    const row = await this.repo.report(p.reportId);
    if (!row) return;
    const sent = await this.ctx.gateway.sendMessage(channel, await this.queueMessage(row));
    await this.repo.updateReport(row.id, { queueMessageId: sent.messageId });
  }

  private async refreshQueue(reportId: string, lastAction?: string) {
    const row = await this.repo.report(reportId);
    const channel = this.ctx.config.channels.modQueue;
    if (!row?.queueMessageId || !channel) return;
    try {
      await this.ctx.gateway.editMessage(
        channel,
        row.queueMessageId,
        await this.queueMessage(row, lastAction),
      );
    } catch (err) {
      this.ctx.log.warn({ err, reportId }, 'could not edit the queue message');
    }
  }

  async queueMessage(r: ReportRow, lastAction?: string): Promise<OutgoingMessage> {
    const t = (k: string, v: Record<string, string | number> = {}) => this.t(k, v);
    const member = await this.ctx.gateway.fetchMember(r.subjectDiscordUserId).catch(() => null);
    const age = member
      ? Math.floor(
          (this.ctx.clock.now().getTime() - new Date(member.accountCreatedAt).getTime()) / 86_400_000,
        )
      : null;
    const refs = JSON.parse(r.refs) as Record<string, string>;
    const open = r.status === 'open';
    const timeouts = this.ctx.botConfig.moderation.timeoutOptionsMinutes;
    return {
      persona: 'sentinel',
      embeds: [
        {
          title: t('sentinel.mod.queue_title', { reason: t(`sentinel.reasons.${r.reason}`) }),
          color: open ? SEVERITY_COLOR[r.severity as keyof typeof SEVERITY_COLOR] : 0x99aab5,
          fields: [
            {
              name: t('sentinel.mod.subject'),
              value: `<@${r.subjectDiscordUserId}> (${r.subjectDiscordUserId})${age === null ? '' : `\n${t('sentinel.mod.account_age', { days: age })}`}`,
            },
            { name: t('sentinel.mod.severity'), value: t(`sentinel.severity.${r.severity}`), inline: true },
            { name: t('sentinel.mod.count'), value: String(r.count), inline: true },
            {
              name: t('sentinel.mod.source'),
              value: r.reporter === 'member' ? `<@${r.reporterDiscordUserId}>` : r.reporter,
              inline: true,
            },
            ...(r.details ? [{ name: t('sentinel.mod.details'), value: r.details.slice(0, 1024) }] : []),
            ...(Object.keys(refs).length
              ? [
                  {
                    name: t('sentinel.mod.links'),
                    value: Object.entries(refs)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join('\n')
                      .slice(0, 1024),
                  },
                ]
              : []),
            {
              name: t('sentinel.mod.status'),
              value: `${t(`sentinel.mod.status_${r.status}`)}${lastAction ? `\n${lastAction}` : ''}`,
            },
          ],
          footer: { text: r.id },
        },
      ],
      components: open
        ? [
            [
              {
                type: 'button',
                customId: modIds.action(r.id, 'resolve'),
                label: t('sentinel.mod.btn.resolve'),
                style: 'success',
              },
              {
                type: 'button',
                customId: modIds.action(r.id, 'ignore'),
                label: t('sentinel.mod.btn.ignore'),
                style: 'secondary',
              },
              {
                type: 'button',
                customId: modIds.action(r.id, 'warn'),
                label: t('sentinel.mod.btn.warn'),
                style: 'primary',
              },
            ],
            [
              ...timeouts.map((m, n) => ({
                type: 'button' as const,
                customId: modIds.action(r.id, `t${n}`),
                label: t('sentinel.mod.btn.timeout', { time: this.minutes(m) }),
                style: 'danger' as const,
              })),
              {
                type: 'button',
                customId: modIds.action(r.id, 'history'),
                label: t('sentinel.mod.btn.history'),
                style: 'secondary',
              },
            ],
          ]
        : [
            [
              {
                type: 'button',
                customId: modIds.action(r.id, 'history'),
                label: t('sentinel.mod.btn.history'),
                style: 'secondary',
              },
            ],
          ],
    };
  }

  private minutes(m: number) {
    return m % 60 === 0 ? `${m / 60} h` : `${m} min`;
  }

  // ---------- member reports ----------

  private async canReport(
    i: IncomingInteraction,
    r: Responder,
    subject: string,
    l: Locale,
  ): Promise<boolean> {
    const say = (k: string, v: Record<string, string | number> = {}) =>
      r.reply({ persona: 'sentinel', ephemeral: true, content: this.t(k, v, l) });
    if (subject === i.userId) return say('sentinel.errors.report_self').then(() => false);
    const m = await this.ctx.gateway.fetchMember(subject);
    if (!m) return say('sentinel.errors.report_unknown').then(() => false);
    if (m.isBot) return say('sentinel.errors.report_bot').then(() => false);
    const res = await this.safety.consume(
      `report:${i.userId}`,
      this.ctx.botConfig.rateLimits.reportsPerHour,
      HOUR,
    );
    if (!res.allowed)
      return say('sentinel.errors.report_limit', { minutes: Math.ceil(res.retryAfterMs / 60_000) }).then(
        () => false,
      );
    return true;
  }

  private async fileMemberReport(
    reporter: string,
    subject: string,
    motivo: string,
    details: string,
    refs: Record<string, string>,
  ) {
    await this.ctx.bus.emit(this.ctx.db.orm, 'report.flagged', {
      reportId: this.ctx.newId(),
      reporter: 'member',
      reporterDiscordUserId: reporter,
      subjectDiscordUserId: subject,
      reason: motivo === 'spam' ? 'spam' : 'user_report',
      severity: motivo === 'spam' ? 'low' : 'medium',
      details: `[${this.t(`sentinel.motivos.${motivo}`)}] ${details}`.trim().slice(0, 500),
      refs,
    });
  }

  /** /denunciar membro motivo [detalhes] */
  async denunciar(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const subject = String(i.options?.membro ?? '');
    const motivo = (MOTIVOS as readonly string[]).includes(String(i.options?.motivo))
      ? String(i.options?.motivo)
      : 'outro';
    if (!(await this.canReport(i, r, subject, l))) return;
    await this.fileMemberReport(i.userId, subject, motivo, String(i.options?.detalhes ?? ''), {});
    await r.reply({
      persona: 'sentinel',
      ephemeral: true,
      content: this.t('sentinel.mod.report_received', {}, l),
    });
  }

  /** Context menu "Denunciar mensagem": opens a modal for the reason. */
  async reportMessageMenu(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const target = i.target;
    if (!target)
      return r.reply({
        persona: 'sentinel',
        ephemeral: true,
        content: this.t('sentinel.errors.report_unknown', {}, l),
      });
    if (target.authorId === i.userId)
      return r.reply({
        persona: 'sentinel',
        ephemeral: true,
        content: this.t('sentinel.errors.report_self', {}, l),
      });
    await r.showModal({
      customId: modIds.reportMessage(target.channelId, target.messageId, target.authorId),
      title: this.t('sentinel.mod.modal_title', {}, l).slice(0, 45),
      inputs: [
        {
          customId: 'motivo',
          label: this.t('sentinel.mod.modal_reason', {}, l).slice(0, 45),
          style: 'paragraph',
          required: true,
          minLength: 3,
          maxLength: 400,
        },
      ],
    });
  }

  /** Modal submit of "Denunciar mensagem". */
  async reportMessageSubmit(
    i: IncomingInteraction,
    r: Responder,
    [channelId, messageId, authorId]: string[],
  ): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    if (!channelId || !messageId || !authorId)
      return r.reply({
        persona: 'sentinel',
        ephemeral: true,
        content: this.t('sentinel.errors.report_unknown', {}, l),
      });
    if (!(await this.canReport(i, r, authorId, l))) return;
    const link = `https://discord.com/channels/${this.ctx.guildId}/${channelId}/${messageId}`;
    await this.fileMemberReport(i.userId, authorId, 'outro', i.fields?.motivo ?? '', { message: link });
    await r.reply({
      persona: 'sentinel',
      ephemeral: true,
      content: this.t('sentinel.mod.report_received', {}, l),
    });
  }

  // ---------- staff buttons ----------

  async staffAction(i: IncomingInteraction, r: Responder, reportId: string, action: string): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const say = (k: string, v: Record<string, string | number> = {}) =>
      r.reply({ persona: 'sentinel', ephemeral: true, content: this.t(k, v, l) });
    if (i.inDm || !(await this.ctx.isStaff(i))) return say('sentinel.errors.not_staff');
    const report = await this.repo.report(reportId);
    if (!report) return say('sentinel.errors.report_not_found');
    if (action === 'history') return r.reply(await this.history(report.subjectDiscordUserId, l));
    if (report.status !== 'open')
      return say('sentinel.mod.already_closed', {
        status: this.t(`sentinel.mod.status_${report.status}`, {}, l),
      });
    const stamp = (what: string) =>
      this.t('sentinel.mod.last_action', { staff: `<@${i.userId}>`, action: what });
    if (action === 'resolve' || action === 'ignore') {
      const status = action === 'resolve' ? 'resolved' : 'ignored';
      await this.repo.updateReport(reportId, { status });
      await this.repo.logAction(reportId, i.userId, action, null);
      await this.refreshQueue(reportId, stamp(this.t(`sentinel.mod.status_${status}`)));
      return say('sentinel.mod.done', { status: this.t(`sentinel.mod.status_${status}`, {}, l) });
    }
    if (action === 'warn') {
      let note = 'dm';
      try {
        const sl = await this.ctx.i18n.localeFor(report.subjectDiscordUserId);
        await this.ctx.gateway.sendDm(report.subjectDiscordUserId, {
          persona: 'sentinel',
          embeds: [
            {
              title: this.t('sentinel.mod.warn_title', {}, sl),
              description: this.t(
                'sentinel.mod.warn_dm',
                { reason: this.t(`sentinel.reasons.${report.reason}`, {}, sl) },
                sl,
              ),
            },
          ],
        });
      } catch (err) {
        if (!(err instanceof GatewayError)) throw err;
        note = 'DM fechada';
      }
      await this.repo.logAction(reportId, i.userId, 'warn', note);
      await this.refreshQueue(
        reportId,
        stamp(note === 'dm' ? this.t('sentinel.mod.warned') : this.t('sentinel.mod.warn_closed')),
      );
      return say(note === 'dm' ? 'sentinel.mod.warned' : 'sentinel.mod.warn_closed');
    }
    const n = /^t(\d)$/.exec(action)?.[1];
    const minutes =
      n === undefined ? undefined : this.ctx.botConfig.moderation.timeoutOptionsMinutes[Number(n)];
    if (minutes === undefined) return say('sentinel.errors.report_not_found');
    try {
      await this.ctx.gateway.timeoutMember(
        report.subjectDiscordUserId,
        minutes * 60_000,
        `Sentinel: denúncia ${reportId} (por ${i.userId})`,
      );
    } catch (err) {
      this.ctx.log.warn({ err, reportId }, 'timeout failed');
      return say('sentinel.mod.timeout_failed');
    }
    await this.repo.logAction(reportId, i.userId, 'timeout', `${minutes} min`);
    await this.refreshQueue(
      reportId,
      stamp(this.t('sentinel.mod.timed_out', { time: this.minutes(minutes) })),
    );
    return say('sentinel.mod.timed_out', { time: this.minutes(minutes) });
  }

  // ---------- staff lists ----------

  async history(subject: string, l: Locale): Promise<OutgoingMessage> {
    const reports = await this.repo.reports({ subject, limit: 15 });
    const actions = await this.repo.actionsFor(reports.map((x) => x.id));
    const lines = reports.map((x) => {
      const acts = actions
        .filter((a) => a.reportId === x.id)
        .map((a) => `${a.action}${a.note ? ` (${a.note})` : ''} — <@${a.staffDiscordUserId}>`);
      return `**${this.t(`sentinel.reasons.${x.reason}`, {}, l)}** ×${x.count} · ${this.t(`sentinel.mod.status_${x.status}`, {}, l)} · ${x.createdAt.slice(0, 10)}${acts.length ? `\n  ${acts.join('\n  ')}` : ''}`;
    });
    return {
      persona: 'sentinel',
      ephemeral: true,
      embeds: [
        {
          title: this.t('sentinel.mod.history_title', {}, l),
          description: [
            `<@${subject}> (${subject})`,
            '',
            ...(lines.length ? lines : [this.t('sentinel.mod.history_empty', {}, l)]),
          ]
            .join('\n')
            .slice(0, 4000),
        },
      ],
    };
  }

  async list(status: string, l: Locale): Promise<OutgoingMessage> {
    const reports = await this.repo.reports({ status, limit: 20 });
    const lines = reports.map(
      (x) =>
        `\`${x.id.slice(-8)}\` <@${x.subjectDiscordUserId}> · ${this.t(`sentinel.reasons.${x.reason}`, {}, l)} ×${x.count} · ${this.t(`sentinel.severity.${x.severity}`, {}, l)} · ${x.updatedAt.slice(0, 16).replace('T', ' ')}`,
    );
    return {
      persona: 'sentinel',
      ephemeral: true,
      embeds: [
        {
          title: this.t(
            'sentinel.mod.list_title',
            { status: this.t(`sentinel.mod.status_${status}`, {}, l), n: reports.length },
            l,
          ),
          description: lines.join('\n') || this.t('sentinel.mod.list_empty', {}, l),
        },
      ],
    };
  }
}
