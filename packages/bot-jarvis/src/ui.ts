import type { ActionRow, BotContext, Embed, Locale, OutgoingMessage } from '@legion/core';
import { customId } from '@legion/core';
import type { JarvisConfig } from './config.js';
import type { AttemptRow, QuestionRow } from './db/repo.js';
import { levelFor, progressBar } from './domain/xp.js';

export const V = 1;
export const ids = {
  answer: (attemptId: string, displayIndex: number) =>
    customId('jarvis', V, 'trivia', attemptId, displayIndex),
  next: () => customId('jarvis', V, 'trivia-next'),
};

export interface AnswerView {
  attempt: AttemptRow;
  question: QuestionRow;
  totalXp: number;
  streakBonus: number;
  streak: number;
  levelUp: number | null;
  capped: boolean;
  rawXp: number;
  /** Credits paid for this answer (v0.10). */
  credits?: number;
}

const LETTERS = ['🇦', '🇧', '🇨', '🇩'];

/** Message builders (persona J.A.R.V.I.S.). All text comes from the locales. */
export class JarvisUi {
  constructor(private readonly ctx: BotContext<JarvisConfig>) {}

  t = (key: string, vars: Record<string, string | number>, locale: Locale) =>
    this.ctx.i18n.t(key, vars, locale);

  text(content: string): OutgoingMessage {
    return { persona: 'jarvis', content, ephemeral: true };
  }

  category(cat: string, l: Locale): string {
    const key = `jarvis.trivia.category.${cat}`;
    const v = this.t(key, {}, l);
    return v === key ? cat : v;
  }

  choices(q: QuestionRow): string[] {
    return JSON.parse(q.choices) as string[];
  }

  question(a: AttemptRow, q: QuestionRow, l: Locale): OutgoingMessage {
    const choices = this.choices(q);
    const order = JSON.parse(a.choiceOrder) as number[];
    const row: ActionRow = order.map((orig, display) => ({
      type: 'button',
      customId: ids.answer(a.id, display),
      label: (choices[orig] ?? '?').slice(0, 80),
      emoji: LETTERS[display],
      style: 'secondary',
    }));
    const embed: Embed = {
      title: this.t('jarvis.trivia.title', { category: this.category(q.category, l) }, l),
      description: `**${q.question}**`,
      footer: {
        text: this.t(
          'jarvis.trivia.meta',
          {
            difficulty: this.t(`jarvis.trivia.difficulty.${q.difficulty}`, {}, l),
            seconds: this.ctx.botConfig.trivia.timeLimitSeconds,
          },
          l,
        ),
      },
    };
    return { persona: 'jarvis', embeds: [embed], components: [row], ephemeral: true };
  }

  result(v: AnswerView, l: Locale): OutgoingMessage {
    const { attempt: a, question: q } = v;
    const choices = this.choices(q);
    const order = JSON.parse(a.choiceOrder) as number[];
    const head =
      a.status === 'expired'
        ? this.t('jarvis.trivia.expired', {}, l)
        : a.correct
          ? this.t('jarvis.trivia.correct', {}, l)
          : this.t('jarvis.trivia.wrong', {}, l);
    const lines = [`**${q.question}**`, '', head];
    if (!a.correct)
      lines.push(this.t('jarvis.trivia.answer_was', { answer: choices[q.answerIndex] ?? '?' }, l));
    lines.push(`_${q.explanation}_`);
    if (a.correct) {
      if (v.capped && a.xpAwarded === 0)
        lines.push(this.t('jarvis.trivia.xp_capped', { cap: this.ctx.botConfig.trivia.dailyXpCap }, l));
      else if (v.capped) lines.push(this.t('jarvis.trivia.xp_partial', { xp: a.xpAwarded }, l));
      else lines.push(this.t('jarvis.trivia.xp_gained', { xp: a.xpAwarded }, l));
      if (v.credits) lines.push(this.t('jarvis.wallet.earned', { credits: v.credits }, l));
    }
    if (v.streakBonus > 0)
      lines.push(this.t('jarvis.trivia.streak_bonus', { streak: v.streak, bonus: v.streakBonus }, l));
    if (v.levelUp) lines.push(this.t('jarvis.trivia.level_up', { level: v.levelUp }, l));
    const lv = this.ctx.botConfig.levels;
    lines.push(
      '',
      this.t(
        'jarvis.trivia.progress',
        { level: levelFor(v.totalXp, lv), bar: progressBar(v.totalXp, lv), xp: v.totalXp },
        l,
      ),
    );
    // Buttons stay visible but disabled, marking the chosen and the right answer.
    const answered: ActionRow = order.map((orig, display) => ({
      type: 'button',
      customId: ids.answer(a.id, display),
      label: (choices[orig] ?? '?').slice(0, 80),
      emoji: LETTERS[display],
      style: orig === q.answerIndex ? 'success' : orig === a.chosenIndex ? 'danger' : 'secondary',
      disabled: true,
    }));
    const next: ActionRow = [
      {
        type: 'button',
        customId: ids.next(),
        label: this.t('jarvis.trivia.next', {}, l),
        style: 'primary',
        emoji: '➡️',
      },
    ];
    // A URL source becomes a link button; a reference ("Shang-Chi #4 (2021)") goes in the footer.
    const isUrl = /^https?:\/\//.test(q.source);
    if (isUrl)
      next.push({
        type: 'button',
        url: q.source,
        label: this.t('jarvis.trivia.source', {}, l),
        style: 'link',
      });
    return {
      persona: 'jarvis',
      embeds: [
        {
          title: this.t('jarvis.trivia.title', { category: this.category(q.category, l) }, l),
          description: lines.join('\n'),
          ...(isUrl ? {} : { footer: { text: `${this.t('jarvis.trivia.source', {}, l)}: ${q.source}` } }),
        },
      ],
      components: [answered, next],
      ephemeral: true,
    };
  }
}
