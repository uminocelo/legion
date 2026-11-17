import type { BotContext, IncomingInteraction, Locale, MemberView, Responder } from '@legion/core';
import { addDays, localDay } from '@legion/core';
import { and, eq } from 'drizzle-orm';
import type { Difficulty, JarvisConfig } from './config.js';
import { readTriviaContent, type SyncResult, syncTriviaContent } from './content.js';
import type { AttemptRow, QuestionRow } from './db/repo.js';
import { pickQuestion, shuffledOrder } from './domain/selection.js';
import { scoreTrivia } from './domain/xp.js';
import { JARVIS_CONTENT_DIR } from './paths.js';
import type { JarvisServices } from './services.js';
import { type AnswerView, JarvisUi } from './ui.js';

/** Content folders: the bundled pack plus optional server packs in ./data/content/trivia. */
export const contentDirs = () => [`${JARVIS_CONTENT_DIR}/trivia`, 'data/content/trivia'];

export class JarvisTrivia {
  readonly ui: JarvisUi;

  constructor(
    private readonly ctx: BotContext<JarvisConfig>,
    private readonly s: JarvisServices,
  ) {
    this.ui = new JarvisUi(ctx);
  }

  private get cfg() {
    return this.ctx.botConfig.trivia;
  }

  locale = (userId: string) => this.ctx.i18n.localeFor(userId);

  async reload(dirs = contentDirs()): Promise<SyncResult> {
    const loaded = readTriviaContent(dirs, this.cfg.categories, this.ctx.config.locale);
    const res = await syncTriviaContent(this.s.repo, loaded);
    if (res.errors.length) this.ctx.log.warn({ errors: res.errors }, 'trivia content has errors');
    return res;
  }

  /** The member behind an interaction, or a reply telling them to register. */
  async registered(i: IncomingInteraction, r: Responder, l: Locale): Promise<MemberView | null> {
    const m = await this.ctx.read.members.getByDiscordId(i.userId);
    if (m && m.onboardingStep === 'registered' && !m.leftAt) return m;
    const welcome = this.ctx.config.channels.welcome;
    await r.reply(
      this.ui.text(
        this.ui.t('jarvis.errors.not_registered', { welcome: welcome ? `<#${welcome}>` : '#boas-vindas' }, l),
      ),
    );
    return null;
  }

  /** `/trivia [categoria]` and the "Próxima pergunta" button. */
  async ask(i: IncomingInteraction, r: Responder, category: string | null): Promise<void> {
    const l = await this.locale(i.userId);
    const member = await this.registered(i, r, l);
    if (!member) return;
    const now = this.ctx.clock.now();
    const nowIso = now.toISOString();

    const open = await this.s.repo.openAttempt(member.id, nowIso);
    if (open) {
      const q = await this.s.repo.question(open.questionId);
      if (q) return r.reply(this.ui.question(open, q, l));
    }
    const last = await this.s.repo.lastAttempt(member.id);
    if (last) {
      const wait = new Date(last.createdAt).getTime() + this.cfg.cooldownSeconds * 1000 - now.getTime();
      if (wait > 0)
        return r.reply(
          this.ui.text(this.ui.t('jarvis.errors.cooldown', { seconds: Math.ceil(wait / 1000) }, l)),
        );
    }

    const cat = category && this.cfg.categories.includes(category) ? category : null;
    let pool = await this.s.repo.activeQuestions(l, cat);
    if (!pool.length && l !== this.ctx.config.locale)
      pool = await this.s.repo.activeQuestions(this.ctx.config.locale, cat);
    const rng = this.ctx.random.create(this.ctx.random.seed());
    const q = pickQuestion(pool, await this.s.repo.lastSeen(member.id), now, this.cfg.noRepeatDays, rng);
    if (!q) {
      this.ctx.log.warn({ category: cat, locale: l }, 'empty trivia pool');
      const label = cat ? ` (${this.ui.category(cat, l)})` : '';
      return r.reply(this.ui.text(this.ui.t('jarvis.errors.no_questions', { category: label }, l)));
    }
    const attempt: AttemptRow = {
      id: this.ctx.newId(),
      guildId: this.ctx.guildId,
      memberId: member.id,
      questionId: q.id,
      choiceOrder: JSON.stringify(shuffledOrder(this.ui.choices(q).length, rng)),
      status: 'open',
      chosenIndex: null,
      correct: null,
      msToAnswer: null,
      xpAwarded: 0,
      createdAt: nowIso,
      expiresAt: new Date(now.getTime() + this.cfg.timeLimitSeconds * 1000).toISOString(),
      answeredAt: null,
    };
    await this.ctx.db.orm.insert(this.s.repo.t.jarvisTriviaAttempts).values(attempt);
    await r.reply(this.ui.question(attempt, q, l));
  }

  /** A click on an answer button. Idempotent: a stored result is shown again. */
  async answer(i: IncomingInteraction, r: Responder, attemptId: string, displayIndex: number): Promise<void> {
    const l = await this.locale(i.userId);
    const attempt = await this.s.repo.attempt(attemptId);
    const q = attempt ? await this.s.repo.question(attempt.questionId) : null;
    if (!attempt || !q) return r.reply(this.ui.text(this.ui.t('jarvis.errors.unknown_attempt', {}, l)));
    const member = await this.ctx.read.members.getByDiscordId(i.userId);
    if (!member || member.id !== attempt.memberId)
      return r.reply(this.ui.text(this.ui.t('jarvis.errors.not_your_question', {}, l)));

    if (attempt.status !== 'open') return r.update(this.ui.result(await this.storedView(attempt, q), l));

    const now = this.ctx.clock.now();
    const a = this.s.repo.t.jarvisTriviaAttempts;
    if (now.toISOString() > attempt.expiresAt) {
      await this.ctx.db.orm
        .update(a)
        .set({ status: 'expired' })
        .where(and(eq(a.id, attempt.id), eq(a.status, 'open')));
      const fresh = (await this.s.repo.attempt(attempt.id)) ?? attempt;
      return r.update(this.ui.result(await this.storedView(fresh, q), l));
    }

    const order = JSON.parse(attempt.choiceOrder) as number[];
    const chosen = order[displayIndex] ?? -1;
    const correct = chosen === q.answerIndex;
    const msToAnswer = Math.max(0, now.getTime() - new Date(attempt.createdAt).getTime());
    const limitMs = this.cfg.timeLimitSeconds * 1000;

    const view = await this.ctx.bus.transaction(async (tx): Promise<AnswerView | null> => {
      // Claim the attempt: only the first click (or replay) wins.
      const claimed = await tx
        .update(a)
        .set({
          status: 'answered',
          chosenIndex: chosen,
          correct: correct ? 1 : 0,
          msToAnswer,
          answeredAt: now.toISOString(),
        })
        .where(and(eq(a.id, attempt.id), eq(a.status, 'open')))
        .returning({ id: a.id });
      if (!claimed.length) return null;
      await this.s.repo.ensureProgress(attempt.memberId, tx);
      const progress = await this.s.repo.progress(attempt.memberId, tx);
      const today = this.s.xp.today();
      const earnedToday = progress?.triviaXpDay === today ? progress.triviaXpToday : 0;
      const score = scoreTrivia(
        {
          correct,
          expired: false,
          difficulty: q.difficulty as Difficulty,
          remainingMs: limitMs - msToAnswer,
          limitMs,
          earnedToday,
        },
        this.cfg,
      );
      let totalXp = progress?.xp ?? 0;
      let streakBonus = 0;
      let streak = progress?.currentStreak ?? 0;
      let levelUp: number | null = null;
      // Correct answers write a ledger entry (0 XP when capped: still an active day for streaks).
      if (correct) {
        const res = await this.s.xp.award(tx, {
          memberId: attempt.memberId,
          amount: score.xp,
          reason: 'trivia',
          sourceKey: `trivia:${attempt.id}`,
          trivia: true,
        });
        totalXp = res.progress?.xp ?? totalXp;
        streakBonus = res.streakBonus;
        streak = res.progress?.currentStreak ?? streak;
        if (res.progress && res.progress.level > res.levelFrom) levelUp = res.progress.level;
        await tx.update(a).set({ xpAwarded: score.xp }).where(eq(a.id, attempt.id));
      }
      await this.ctx.bus.emit(tx, 'trivia.answered', {
        memberId: attempt.memberId,
        attemptId: attempt.id,
        questionId: q.id,
        correct,
        msToAnswer,
      });
      const stored = (await this.s.repo.attempt(attempt.id, tx)) ?? attempt;
      return {
        attempt: stored,
        question: q,
        totalXp,
        streakBonus,
        streak,
        levelUp,
        capped: score.capped,
        rawXp: score.raw,
      };
    });
    const fresh = (await this.s.repo.attempt(attempt.id)) ?? attempt;
    await r.update(this.ui.result(view ?? (await this.storedView(fresh, q)), l));
  }

  /** Rebuilds the result view of an already finished attempt (double click, restart, old message). */
  private async storedView(attempt: AttemptRow, q: QuestionRow): Promise<AnswerView> {
    const p = await this.s.repo.progress(attempt.memberId);
    const raw = attempt.correct
      ? scoreTrivia(
          {
            correct: true,
            expired: false,
            difficulty: q.difficulty as Difficulty,
            remainingMs: this.cfg.timeLimitSeconds * 1000 - (attempt.msToAnswer ?? 0),
            limitMs: this.cfg.timeLimitSeconds * 1000,
            earnedToday: 0,
          },
          this.cfg,
        ).raw
      : 0;
    return {
      attempt,
      question: q,
      totalXp: p?.xp ?? 0,
      streakBonus: 0,
      streak: p?.currentStreak ?? 0,
      levelUp: null,
      capped: attempt.correct === 1 && attempt.xpAwarded < raw,
      rawXp: raw,
    };
  }

  /** Attempts created today (local day), for staff stats. */
  async attemptsToday(): Promise<number> {
    const yesterday = addDays(this.s.xp.today(), -1);
    const rows = await this.s.repo.attemptsSince(`${yesterday}T00:00:00.000Z`);
    const tz = this.ctx.config.timezone;
    const today = this.s.xp.today();
    return rows.filter((r) => localDay(new Date(r.createdAt), tz) === today).length;
  }
}
