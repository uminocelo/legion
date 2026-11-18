import type {
  BotContext,
  Embed,
  Executor,
  IncomingInteraction,
  Locale,
  Modal,
  OutgoingMessage,
  Responder,
} from '@legion/core';
import { contentIssues, customId, LOCALES } from '@legion/core';
import { and, desc, eq } from 'drizzle-orm';
import { stringify as toYaml } from 'yaml';
import type { JarvisConfig } from './config.js';
import { contentHash, questionSchema, type TriviaQuestion } from './content.js';
import type { QuestionRow } from './db/repo.js';
import type { JarvisServices } from './services.js';
import { V } from './ui.js';

export const staffTriviaIds = {
  create: (category: string, difficulty: string, locale: string) =>
    customId('jarvis', V, 'trivia-new', category, difficulty, locale),
  edit: (id: string) => customId('jarvis', V, 'trivia-edit', id),
  review: (id: string, action: 'approve' | 'reject') => customId('jarvis', V, 'trivia-review', id, action),
};

export const TRIVIA_STATUSES = ['ativa', 'pendente', 'desativada', 'todas'] as const;
const PAGE = 10;

/** What staff see for a question: live, waiting for review, rejected or turned off. */
export const statusOf = (q: Pick<QuestionRow, 'active' | 'review'>) =>
  q.active === 1
    ? 'ativa'
    : q.review === 'pending'
      ? 'pendente'
      : q.review === 'rejected'
        ? 'rejeitada'
        : 'desativada';

/** Trivia written, reviewed and managed by staff from Discord (no files, no restart). */
export class StaffTrivia {
  constructor(
    private readonly ctx: BotContext<JarvisConfig>,
    private readonly s: JarvisServices,
  ) {}

  private t = (key: string, vars: Record<string, string | number>, l: Locale) =>
    this.ctx.i18n.t(key, vars, l);
  private text = (content: string): OutgoingMessage => ({ persona: 'jarvis', content, ephemeral: true });
  private get q() {
    return this.s.repo.t.jarvisTriviaQuestions;
  }

  // ---------- create ----------

  /** `/jarvis trivia nova categoria dificuldade [idioma]`: opens the form. */
  async openCreate(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const category = String(i.options?.categoria ?? '');
    const difficulty = String(i.options?.dificuldade ?? 'normal');
    const locale = String(i.options?.idioma ?? this.ctx.config.locale);
    if (!this.ctx.botConfig.trivia.categories.includes(category))
      return r.reply(this.text(this.t('jarvis.staff_trivia.bad_category', { category }, l)));
    await r.showModal(this.form(staffTriviaIds.create(category, difficulty, locale), l));
  }

  private form(id: string, l: Locale, q?: QuestionRow): Modal {
    const choices = q ? (JSON.parse(q.choices) as string[]) : [];
    const v = (x: string | undefined) => (x === undefined ? {} : { value: x });
    return {
      customId: id,
      title: this.t(q ? 'jarvis.staff_trivia.form_edit' : 'jarvis.staff_trivia.form_new', {}, l).slice(0, 45),
      inputs: [
        {
          customId: 'question',
          label: this.t('jarvis.staff_trivia.f_question', {}, l),
          style: 'paragraph',
          minLength: 5,
          maxLength: 300,
          required: true,
          ...v(q?.question),
        },
        {
          customId: 'choices',
          label: this.t('jarvis.staff_trivia.f_choices', {}, l),
          style: 'paragraph',
          maxLength: 330,
          required: true,
          placeholder: 'A\nB\nC\nD',
          ...v(q ? choices.join('\n') : undefined),
        },
        {
          customId: 'answer',
          label: this.t('jarvis.staff_trivia.f_answer', {}, l),
          style: 'short',
          minLength: 1,
          maxLength: 1,
          required: true,
          ...v(q ? String(q.answerIndex + 1) : undefined),
        },
        {
          customId: 'explanation',
          label: this.t('jarvis.staff_trivia.f_explanation', {}, l),
          style: 'paragraph',
          maxLength: 300,
          required: true,
          ...v(q?.explanation),
        },
        {
          customId: 'source',
          label: this.t('jarvis.staff_trivia.f_source', {}, l),
          style: 'short',
          minLength: 3,
          maxLength: 200,
          required: true,
          placeholder: 'Shang-Chi #4 (2021) ou https://…',
          ...v(q?.source),
        },
      ],
    };
  }

  /** Validates the form with the same rules as content files. */
  private parse(
    fields: Record<string, string>,
    base: { id: string; category: string; difficulty: string; locale: string },
  ): { ok: TriviaQuestion } | { errors: string[] } {
    const choices = (fields.choices ?? '')
      .split('\n')
      .map((c) => c.trim())
      .filter(Boolean);
    const n = Number((fields.answer ?? '').trim());
    const res = questionSchema.safeParse({
      ...base,
      question: (fields.question ?? '').trim(),
      choices,
      answer: Number.isInteger(n) ? n - 1 : -1,
      explanation: (fields.explanation ?? '').trim(),
      source: (fields.source ?? '').trim(),
    });
    if (!res.success) return { errors: contentIssues(res.error.issues, 'pergunta') };
    return { ok: { ...res.data, locale: res.data.locale ?? 'pt-BR' } };
  }

  /** DB columns for a question's content (also used by `/jarvis trivia importar`). */
  row(q: TriviaQuestion, now: string) {
    return {
      locale: q.locale,
      category: q.category,
      difficulty: q.difficulty,
      question: q.question,
      choices: JSON.stringify(q.choices),
      answerIndex: q.answer,
      explanation: q.explanation,
      source: q.source,
      contentHash: contentHash(q),
      updatedAt: now,
    };
  }

  /** Modal submit of a new question: live at once, or a draft waiting for a second staff member. */
  async submitCreate(i: IncomingInteraction, r: Responder, [category, difficulty, locale]: string[]) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    if (!(await this.ctx.isStaff(i))) return r.reply(this.text(this.t('jarvis.errors.not_staff', {}, l)));
    const id = `staff-${this.ctx.newId().toLowerCase()}`;
    const parsed = this.parse(i.fields ?? {}, {
      id,
      category: category ?? '',
      difficulty: difficulty ?? '',
      locale: LOCALES.includes(locale as Locale) ? (locale as string) : this.ctx.config.locale,
    });
    if ('errors' in parsed)
      return r.reply(
        this.text(
          this.t('jarvis.staff_trivia.invalid', { errors: parsed.errors.map((e) => `• ${e}`).join('\n') }, l),
        ),
      );
    const review = this.ctx.botConfig.trivia.review === 'second_staff';
    const now = this.ctx.clock.now().toISOString();
    await this.ctx.db.transaction(async (tx) => {
      await tx.insert(this.q).values({
        id,
        ...this.row(parsed.ok, now),
        active: review ? 0 : 1,
        origin: 'staff',
        review: review ? 'pending' : 'approved',
        createdBy: i.userId,
        reviewedBy: null,
      });
      await this.history(tx, id, i.userId, 'create', null);
    });
    this.ctx.log.info({ staff: i.userId, questionId: id, review }, 'staff trivia question created');
    if (!review) return r.reply(this.text(this.t('jarvis.staff_trivia.created_live', { id }, l)));
    const q = await this.s.repo.question(id);
    const where = this.ctx.config.channels.modQueue ?? i.channelId;
    if (q)
      try {
        await this.ctx.gateway.sendMessage(where, this.reviewMessage(q, this.ctx.config.locale, true));
      } catch (err) {
        this.ctx.log.warn({ err, questionId: id }, 'could not post the trivia review');
      }
    await r.reply(
      this.text(this.t('jarvis.staff_trivia.created_pending', { id, channel: `<#${where}>` }, l)),
    );
  }

  /** The review post with Approve / Reject (also used by `/jarvis trivia importar`). */
  reviewMessage(q: QuestionRow, l: Locale, open: boolean, note?: string): OutgoingMessage {
    return {
      persona: 'jarvis',
      embeds: [this.preview(q, l, note)],
      components: open
        ? [
            [
              {
                type: 'button',
                customId: staffTriviaIds.review(q.id, 'approve'),
                label: this.t('jarvis.staff_trivia.approve', {}, l),
                style: 'success',
              },
              {
                type: 'button',
                customId: staffTriviaIds.review(q.id, 'reject'),
                label: this.t('jarvis.staff_trivia.reject', {}, l),
                style: 'danger',
              },
            ],
          ]
        : [],
    };
  }

  private preview(q: QuestionRow, l: Locale, note?: string): Embed {
    const choices = JSON.parse(q.choices) as string[];
    return {
      title: this.t('jarvis.staff_trivia.review_title', { id: q.id }, l),
      description: [
        `**${q.question}**`,
        ...choices.map((c, n) => `${n === q.answerIndex ? '✅' : '▫️'} ${c}`),
        '',
        `_${q.explanation}_`,
        `${this.t('jarvis.trivia.source', {}, l)}: ${q.source}`,
        `${q.category} · ${q.difficulty} · ${q.locale}${q.createdBy ? ` · <@${q.createdBy}>` : ''}`,
        ...(note ? ['', note] : []),
      ].join('\n'),
      color: 0x00b0f4,
    };
  }

  /** Approve / reject buttons. The author cannot approve their own question. */
  async review(i: IncomingInteraction, r: Responder, [id, action]: string[]) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    if (!(await this.ctx.isStaff(i))) return r.reply(this.text(this.t('jarvis.errors.not_staff', {}, l)));
    const q = await this.s.repo.question(id ?? '');
    if (!q) return r.reply(this.text(this.t('jarvis.staff_trivia.unknown', {}, l)));
    if (q.review !== 'pending')
      return r.reply(this.text(this.t('jarvis.staff_trivia.already_reviewed', {}, l)));
    if (q.createdBy === i.userId)
      return r.reply(this.text(this.t('jarvis.staff_trivia.own_question', {}, l)));
    const approve = action === 'approve';
    const done = await this.ctx.db.transaction(async (tx) => {
      const rows = await tx
        .update(this.q)
        .set({
          active: approve ? 1 : 0,
          review: approve ? 'approved' : 'rejected',
          reviewedBy: i.userId,
          updatedAt: this.ctx.clock.now().toISOString(),
        })
        .where(and(eq(this.q.id, q.id), eq(this.q.review, 'pending')))
        .returning({ id: this.q.id });
      if (rows.length) await this.history(tx, q.id, i.userId, approve ? 'approve' : 'reject', null);
      return rows.length > 0;
    });
    if (!done) return r.reply(this.text(this.t('jarvis.staff_trivia.already_reviewed', {}, l)));
    const fresh = (await this.s.repo.question(q.id)) ?? q;
    const note = this.t(
      approve ? 'jarvis.staff_trivia.approved_by' : 'jarvis.staff_trivia.rejected_by',
      { staff: `<@${i.userId}>` },
      l,
    );
    await r.update(this.reviewMessage(fresh, l, false, note));
  }

  // ---------- manage ----------

  /** `/jarvis trivia editar pergunta`: the same form, filled in. Only staff questions (files are edited as files). */
  async openEdit(i: IncomingInteraction, r: Responder) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const q = await this.s.repo.question(String(i.options?.pergunta ?? ''));
    if (!q) return r.reply(this.text(this.t('jarvis.staff_trivia.unknown', {}, l)));
    if (q.origin !== 'staff') return r.reply(this.text(this.t('jarvis.staff_trivia.file_question', {}, l)));
    await r.showModal(this.form(staffTriviaIds.edit(q.id), l, q));
  }

  async submitEdit(i: IncomingInteraction, r: Responder, [id]: string[]) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    if (!(await this.ctx.isStaff(i))) return r.reply(this.text(this.t('jarvis.errors.not_staff', {}, l)));
    const q = await this.s.repo.question(id ?? '');
    if (q?.origin !== 'staff') return r.reply(this.text(this.t('jarvis.staff_trivia.unknown', {}, l)));
    const parsed = this.parse(i.fields ?? {}, {
      id: q.id,
      category: q.category,
      difficulty: q.difficulty,
      locale: q.locale,
    });
    if ('errors' in parsed)
      return r.reply(
        this.text(
          this.t('jarvis.staff_trivia.invalid', { errors: parsed.errors.map((e) => `• ${e}`).join('\n') }, l),
        ),
      );
    await this.ctx.db.transaction(async (tx) => {
      await tx
        .update(this.q)
        .set(this.row(parsed.ok, this.ctx.clock.now().toISOString()))
        .where(eq(this.q.id, q.id));
      await this.history(tx, q.id, i.userId, 'edit', q);
    });
    await r.reply(this.text(this.t('jarvis.staff_trivia.edited', { id: q.id }, l)));
  }

  /** `/jarvis trivia desativar | ativar`. Takes effect at once, and survives file reloads. */
  async setActive(i: IncomingInteraction, r: Responder, active: boolean) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const q = await this.s.repo.question(String(i.options?.pergunta ?? ''));
    if (!q) return r.reply(this.text(this.t('jarvis.staff_trivia.unknown', {}, l)));
    if (active && (q.review === 'pending' || q.review === 'rejected'))
      return r.reply(this.text(this.t('jarvis.staff_trivia.not_approved', {}, l)));
    const review = active ? (q.origin === 'staff' ? 'approved' : null) : 'disabled';
    await this.ctx.db.transaction(async (tx) => {
      await tx
        .update(this.q)
        .set({ active: active ? 1 : 0, review, updatedAt: this.ctx.clock.now().toISOString() })
        .where(eq(this.q.id, q.id));
      await this.history(tx, q.id, i.userId, active ? 'enable' : 'disable', null);
    });
    await r.reply(
      this.text(
        this.t(active ? 'jarvis.staff_trivia.enabled' : 'jarvis.staff_trivia.disabled', { id: q.id }, l),
      ),
    );
  }

  /** `/jarvis trivia lista [status] [categoria] [autor] [pagina]`. */
  async list(i: IncomingInteraction, r: Responder) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const status = String(i.options?.status ?? 'todas');
    const category = i.options?.categoria ? String(i.options.categoria) : null;
    const author = i.options?.autor ? String(i.options.autor) : null;
    const page = Math.max(1, Number(i.options?.pagina ?? 1));
    const all = (
      await this.ctx.db.orm.select().from(this.q).orderBy(desc(this.q.updatedAt), this.q.id)
    ).filter(
      (q) =>
        (status === 'todas' || statusOf(q) === status) &&
        (!category || q.category === category) &&
        (!author || q.createdBy === author),
    );
    const pages = Math.max(1, Math.ceil(all.length / PAGE));
    const slice = all.slice((page - 1) * PAGE, page * PAGE);
    const lines = slice.map((q) => {
      const who =
        q.origin === 'staff' && q.createdBy
          ? ` · <@${q.createdBy}>`
          : ` · ${this.t('jarvis.staff_trivia.from_file', {}, l)}`;
      return `\`${q.id}\` · ${statusOf(q)} · ${q.category} · ${q.difficulty}${who}\n${q.question.slice(0, 90)}`;
    });
    await r.reply({
      persona: 'jarvis',
      ephemeral: true,
      allowedMentions: { users: [] },
      embeds: [
        {
          title: this.t('jarvis.staff_trivia.list_title', { total: all.length }, l),
          description: lines.join('\n\n') || this.t('jarvis.staff_trivia.list_empty', {}, l),
          footer: { text: this.t('jarvis.staff_trivia.page', { page: Math.min(page, pages), pages }, l) },
        },
      ],
    });
  }

  /** `/jarvis trivia exportar`: the staff questions as a YAML file (same format as content packs). */
  async export(i: IncomingInteraction, r: Responder) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const rows = await this.ctx.db.orm
      .select()
      .from(this.q)
      .where(eq(this.q.origin, 'staff'))
      .orderBy(this.q.id);
    const items = rows
      .filter((q) => q.review !== 'pending' && q.review !== 'rejected')
      .map((q) => ({
        id: q.id,
        locale: q.locale,
        category: q.category,
        difficulty: q.difficulty,
        question: q.question,
        choices: JSON.parse(q.choices) as string[],
        answer: q.answerIndex,
        explanation: q.explanation,
        source: q.source,
      }));
    const header = `# ${this.t('jarvis.staff_trivia.export_header', { date: this.ctx.clock.now().toISOString().slice(0, 10) }, l)}\n`;
    await r.reply({
      persona: 'jarvis',
      ephemeral: true,
      content: this.t('jarvis.staff_trivia.exported', { count: items.length }, l),
      files: [{ name: 'trivia-staff.yaml', content: header + toYaml(items) }],
    });
  }

  /** Autocomplete for `pergunta`: id or text. */
  async autocomplete(i: IncomingInteraction, r: Responder) {
    const term = (i.focused?.value ?? '').toLowerCase();
    const rows = await this.ctx.db.orm.select().from(this.q).orderBy(desc(this.q.updatedAt));
    const hits = rows
      .filter((q) => !term || q.id.includes(term) || q.question.toLowerCase().includes(term))
      .slice(0, 25)
      .map((q) => ({ name: `${statusOf(q)} · ${q.question}`.slice(0, 100), value: q.id }));
    await r.autocomplete(hits);
  }

  /** Records a staff change in the question's history (also used by `/jarvis trivia importar`). */
  async history(
    tx: Executor,
    questionId: string,
    staffId: string,
    action: string,
    before: QuestionRow | null,
  ) {
    await tx.insert(this.s.repo.t.jarvisTriviaEdits).values({
      id: this.ctx.newId(),
      questionId,
      staffId,
      action,
      before: before ? JSON.stringify(before) : null,
      createdAt: this.ctx.clock.now().toISOString(),
    });
  }
}
