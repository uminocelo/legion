// `/carteira` (players) and `/jarvis creditos dar` (staff), v0.10 US-14.
import type { BotContext, IncomingInteraction, Locale, OutgoingMessage, Responder } from '@legion/core';
import type { JarvisConfig } from './config.js';
import type { JarvisServices } from './services.js';
import { InsufficientCredits, type WalletLedgerRow } from './wallet.js';

export const STAFF_CREDITS_MAX = 10_000;

export class JarvisWalletUi {
  constructor(
    private readonly ctx: BotContext<JarvisConfig>,
    private readonly s: JarvisServices,
  ) {}

  private t = (key: string, vars: Record<string, string | number>, l: Locale) =>
    this.ctx.i18n.t(`jarvis.wallet.${key}`, vars, l);

  private text(content: string): OutgoingMessage {
    return { persona: 'jarvis', content, ephemeral: true, allowedMentions: { parse: [] } };
  }

  private line(e: WalletLedgerRow, l: Locale): string {
    const sign = e.amount > 0 ? `+${e.amount}` : String(e.amount);
    const reason = this.t(`reason.${e.reason}`, {}, l);
    const when = `<t:${Math.floor(new Date(e.createdAt).getTime() / 1000)}:d>`;
    return `\`${sign.padStart(6)}\` ${reason}${e.note ? ` · ${e.note.slice(0, 80)}` : ''} · ${when}`;
  }

  /** `/carteira`: balance and the last 10 movements. */
  async command(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const member = await this.s.trivia.registered(i, r, l);
    if (!member) return;
    const balance = await this.s.wallet.balanceOf(member.id);
    const moves = await this.s.wallet.history(member.id, 10);
    await r.reply({
      persona: 'jarvis',
      ephemeral: true,
      allowedMentions: { parse: [] },
      embeds: [
        {
          title: this.t('title', {}, l),
          description: this.t('balance', { balance }, l),
          fields: [
            {
              name: this.t('history', {}, l),
              value: moves.length
                ? moves
                    .map((e) => this.line(e, l))
                    .join('\n')
                    .slice(0, 1024)
                : this.t('empty', {}, l),
            },
          ],
          ...(this.s.wallet.enabled ? {} : { footer: { text: this.t('disabled', {}, l) } }),
        },
      ],
    });
  }

  /** `/jarvis creditos dar membro quantidade motivo` (staff): −10000..10000, not 0 (D7). */
  async staffGive(i: IncomingInteraction, r: Responder, l: Locale): Promise<void> {
    const amount = Number(i.options?.quantidade);
    const reason = String(i.options?.motivo ?? '')
      .trim()
      .slice(0, 200);
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > STAFF_CREDITS_MAX || !reason)
      return r.reply(this.text(this.t('staff_invalid', { max: STAFF_CREDITS_MAX }, l)));
    const member = await this.ctx.read.members.getByDiscordId(String(i.options?.membro ?? ''));
    if (!member) return r.reply(this.text(this.ctx.i18n.t('jarvis.errors.unknown_member', {}, l)));
    const move = {
      memberId: member.id,
      amount: Math.abs(amount),
      reason: 'staff' as const,
      sourceKey: `staff:${i.id}`,
      note: reason,
      createdBy: i.userId,
    };
    const who = `<@${member.discordUserId}>`;
    try {
      const res = await this.ctx.db.transaction((tx) =>
        amount > 0 ? this.s.wallet.credit(tx, move) : this.s.wallet.debit(tx, move),
      );
      this.ctx.log.info({ staff: i.userId, memberId: member.id, amount, reason }, 'staff credits adjustment');
      return r.reply(
        this.text(
          this.t(
            'staff_done',
            { amount: amount > 0 ? `+${amount}` : String(amount), member: who, reason, balance: res.balance },
            l,
          ),
        ),
      );
    } catch (err) {
      if (err instanceof InsufficientCredits)
        return r.reply(this.text(this.t('staff_insufficient', { member: who, balance: err.balance }, l)));
      throw err;
    }
  }
}
