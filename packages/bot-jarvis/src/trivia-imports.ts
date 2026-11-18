import type { BotContext, IncomingInteraction, Locale, OutgoingMessage, Responder } from '@legion/core';
import { customId, readTextAttachment } from '@legion/core';
import { eq } from 'drizzle-orm';
import type { JarvisConfig } from './config.js';
import { contentHash } from './content.js';
import type { QuestionRow } from './db/repo.js';
import { parseTriviaYaml, type TriviaQuestion } from './domain/trivia.js';
import { IMPORT_MAX_BYTES } from './mission-imports.js';
import type { JarvisServices } from './services.js';
import { V } from './ui.js';

/** Questions per file: keeps the preview readable and the review queue short. */
export const TRIVIA_IMPORT_MAX = 50;

export const triviaImportIds = {
  decide: (stageId: string, action: 'publish' | 'cancel') =>
    customId('jarvis', V, 'trivia-import', stageId, action),
};

const stageKey = (id: string) => `jarvis.trivia-import.${id}`;
interface Staged {
  text: string;
  name: string;
  staffId: string;
}

type Change = 'new' | 'changed' | 'same';
interface Plan {
  items: { q: TriviaQuestion; change: Change; prev: QuestionRow | null }[];
  errors: string[];
}

/**
 * `/jarvis trivia importar`: a YAML list of questions (the format of `/jarvis trivia exportar`, the
 * content files and the website editor) → preview → publish. All or nothing: any error and nothing
 * changes. Same `id` as a staff question updates it; the `review` rule of `/jarvis trivia nova` applies.
 */
export class TriviaImports {
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

  /** Validates the file and compares it with what is in the database. */
  private async plan(text: string, name: string): Promise<Plan> {
    const cfg = this.ctx.botConfig.trivia;
    const parsed = parseTriviaYaml(text, name, {
      categories: cfg.categories,
      locale: this.ctx.config.locale,
    });
    const errors = [...parsed.errors];
    if (parsed.questions.length > TRIVIA_IMPORT_MAX)
      errors.push(
        `${name}: ${parsed.questions.length} perguntas; o máximo por arquivo é ${TRIVIA_IMPORT_MAX}`,
      );
    if (!parsed.questions.length && !errors.length) errors.push(`${name}: nenhuma pergunta no arquivo`);
    const items: Plan['items'] = [];
    for (const q of parsed.questions) {
      const prev = await this.s.repo.question(q.id);
      if (prev && prev.origin !== 'staff') {
        errors.push(`${name} → ${q.id}: id de uma pergunta dos arquivos de conteúdo; use outro id`);
        continue;
      }
      const change: Change = !prev ? 'new' : prev.contentHash === contentHash(q) ? 'same' : 'changed';
      items.push({ q, change, prev });
    }
    return { items, errors };
  }

  private errors(errors: string[], l: Locale) {
    const shown = errors.slice(0, 15).map((e) => `• ${e}`);
    if (errors.length > 15) shown.push(`… +${errors.length - 15}`);
    return this.t('jarvis.imports.invalid', { errors: shown.join('\n') }, l).slice(0, 1900);
  }

  private counts(p: Plan) {
    const n = (c: Change) => p.items.filter((x) => x.change === c).length;
    return { added: n('new'), changed: n('changed'), same: n('same') };
  }

  /** `/jarvis trivia importar arquivo` (staff checked by the command). */
  async import(i: IncomingInteraction, r: Responder) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const file = i.attachments?.arquivo;
    const got = await readTextAttachment(this.ctx.gateway, file, {
      maxBytes: IMPORT_MAX_BYTES,
      extensions: ['.yaml', '.yml'],
    });
    if ('problem' in got)
      return r.reply(
        this.text(this.t(`jarvis.imports.problem.${got.problem}`, { kb: IMPORT_MAX_BYTES / 1024 }, l)),
      );
    const name = file?.name ?? 'arquivo.yaml';
    const p = await this.plan(got.text, name);
    if (p.errors.length) return r.reply(this.text(this.errors(p.errors, l)));
    const stageId = this.ctx.newId();
    await this.ctx.kv.set(stageKey(stageId), { text: got.text, name, staffId: i.userId } satisfies Staged);
    const review = this.ctx.botConfig.trivia.review === 'second_staff';
    const mark: Record<Change, string> = { new: '🆕', changed: '✏️', same: '＝' };
    const list = p.items
      .slice(0, 10)
      .map((x) => `${mark[x.change]} \`${x.q.id}\` · ${x.q.question}`.slice(0, 150));
    if (p.items.length > 10) list.push(`… +${p.items.length - 10}`);
    await r.reply({
      persona: 'jarvis',
      ephemeral: true,
      embeds: [
        {
          title: `${this.t('jarvis.imports.preview', {}, l)}: ${name}`,
          description: [
            this.t('jarvis.trivia_imports.summary', this.counts(p), l),
            ...(review ? [this.t('jarvis.trivia_imports.review_note', {}, l)] : []),
            '',
            ...list,
          ]
            .join('\n')
            .slice(0, 4000),
          color: 0x00b0f4,
        },
      ],
      components: [
        [
          {
            type: 'button',
            customId: triviaImportIds.decide(stageId, 'publish'),
            label: this.t('jarvis.imports.publish', {}, l),
            style: 'success',
          },
          {
            type: 'button',
            customId: triviaImportIds.decide(stageId, 'cancel'),
            label: this.t('jarvis.imports.cancel', {}, l),
            style: 'secondary',
          },
        ],
      ],
    });
  }

  /** Publicar / Cancelar on the preview. */
  async decide(i: IncomingInteraction, r: Responder, [stageId, action]: string[]) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    if (!(await this.ctx.isStaff(i))) return r.reply(this.text(this.t('jarvis.errors.not_staff', {}, l)));
    const key = stageKey(stageId ?? '');
    const staged = await this.ctx.kv.get<Staged | null>(key);
    const done = (content: string) => r.update({ ...this.text(content), embeds: [], components: [] });
    if (!staged) return done(this.t('jarvis.imports.expired', {}, l));
    await this.ctx.kv.set(key, null);
    if (action !== 'publish') return done(this.t('jarvis.imports.cancelled', {}, l));
    // Checked again: the database may have changed since the preview.
    const p = await this.plan(staged.text, staged.name);
    if (p.errors.length) return done(this.errors(p.errors, l));
    const review = this.ctx.botConfig.trivia.review === 'second_staff';
    const now = this.ctx.clock.now().toISOString();
    const toReview: string[] = [];
    await this.ctx.db.transaction(async (tx) => {
      for (const { q, change, prev } of p.items) {
        if (change === 'same') continue;
        const content = this.s.staffTrivia.row(q, now);
        if (change === 'new') {
          await tx.insert(this.q).values({
            id: q.id,
            ...content,
            active: review ? 0 : 1,
            origin: 'staff',
            review: review ? 'pending' : 'approved',
            createdBy: i.userId,
            reviewedBy: null,
          });
          await this.s.staffTrivia.history(tx, q.id, i.userId, 'import', null);
        } else {
          // A changed question goes back to review; otherwise it keeps its on/off state.
          const state = review ? { active: 0, review: 'pending', reviewedBy: null } : {};
          await tx
            .update(this.q)
            .set({ ...content, ...state })
            .where(eq(this.q.id, q.id));
          await this.s.staffTrivia.history(tx, q.id, i.userId, 'import', prev);
        }
        if (review) toReview.push(q.id);
      }
    });
    this.ctx.log.info({ staff: i.userId, ...this.counts(p), review }, 'trivia imported');
    if (review) {
      const where = this.ctx.config.channels.modQueue ?? i.channelId;
      for (const id of toReview) {
        const row = await this.s.repo.question(id);
        if (!row) continue;
        try {
          await this.ctx.gateway.sendMessage(
            where,
            this.s.staffTrivia.reviewMessage(row, this.ctx.config.locale, true),
          );
        } catch (err) {
          this.ctx.log.warn({ err, questionId: id }, 'could not post the trivia review');
        }
      }
    }
    await done(
      this.t(
        review ? 'jarvis.trivia_imports.published_review' : 'jarvis.trivia_imports.published',
        this.counts(p),
        l,
      ),
    );
  }
}
