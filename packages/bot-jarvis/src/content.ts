import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Locale } from '@legion/core';
import { eq, notInArray } from 'drizzle-orm';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';
import { DIFFICULTIES } from './config.js';
import type { JarvisRepo } from './db/repo.js';

export const questionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/, 'use letters, digits, - or _ (2-64 chars)'),
    category: z.string().min(1),
    difficulty: z.enum(DIFFICULTIES),
    question: z.string().min(5).max(300),
    choices: z.array(z.string().min(1).max(80)).min(2).max(4),
    answer: z.number().int().min(0),
    explanation: z.string().min(1).max(300),
    source: z.url(),
    locale: z.enum(['pt-BR', 'en']).optional(),
  })
  .refine((q) => q.answer < q.choices.length, { path: ['answer'], message: 'answer must index into choices' })
  .refine((q) => new Set(q.choices).size === q.choices.length, {
    path: ['choices'],
    message: 'choices must be different',
  });

export type TriviaQuestion = z.infer<typeof questionSchema> & { locale: Locale };

export interface ContentLoadResult {
  questions: TriviaQuestion[];
  errors: string[];
}

/** Reads every *.yaml in the given folders. The locale comes from the field or the file name (pt-BR.yaml). */
export function readTriviaContent(
  dirs: string[],
  categories: string[],
  fallbackLocale: Locale,
): ContentLoadResult {
  const questions: TriviaQuestion[] = [];
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()) {
      const path = join(dir, file);
      const name = basename(file).replace(/\.ya?ml$/, '');
      const fileLocale: Locale = name === 'en' ? 'en' : name === 'pt-BR' ? 'pt-BR' : fallbackLocale;
      let raw: unknown;
      try {
        raw = parseYaml(readFileSync(path, 'utf8'));
      } catch (err) {
        const pos = err instanceof YAMLParseError ? ` (linha ${err.linePos?.[0]?.line ?? 0})` : '';
        errors.push(`${file}${pos}: YAML inválido: ${(err as Error).message.split('\n')[0]}`);
        continue;
      }
      if (!Array.isArray(raw)) {
        errors.push(`${file}: o arquivo deve ser uma lista de perguntas`);
        continue;
      }
      raw.forEach((item, i) => {
        const res = questionSchema.safeParse(item);
        const label = `${file} → item ${i + 1}${(item as { id?: string })?.id ? ` (${(item as { id: string }).id})` : ''}`;
        if (!res.success) {
          for (const issue of res.error.issues)
            errors.push(`${label} → ${issue.path.join('.') || 'item'}: ${issue.message}`);
          return;
        }
        const q = res.data;
        if (!categories.includes(q.category)) {
          errors.push(
            `${label} → category: "${q.category}" não está em jarvis.trivia.categories (${categories.join(', ')})`,
          );
          return;
        }
        const dup = seen.get(q.id);
        if (dup) {
          errors.push(`${label} → id: "${q.id}" repetido (já existe em ${dup})`);
          return;
        }
        seen.set(q.id, file);
        questions.push({ ...q, locale: q.locale ?? fileLocale });
      });
    }
  }
  return { questions, errors };
}

export const contentHash = (q: TriviaQuestion) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        q.locale,
        q.category,
        q.difficulty,
        q.question,
        q.choices,
        q.answer,
        q.explanation,
        q.source,
      ]),
    )
    .digest('hex')
    .slice(0, 16);

export interface SyncResult {
  added: number;
  updated: number;
  deactivated: number;
  unchanged: number;
  errors: string[];
}

/** Upserts questions by id; questions no longer in the files become inactive (never deleted). */
export async function syncTriviaContent(repo: JarvisRepo, loaded: ContentLoadResult): Promise<SyncResult> {
  const q = repo.t.jarvisTriviaQuestions;
  const existing = new Map((await repo.allQuestions()).map((r) => [r.id, r]));
  const result: SyncResult = { added: 0, updated: 0, deactivated: 0, unchanged: 0, errors: loaded.errors };
  const now = repo.now();
  await repo.db.transaction(async (tx) => {
    for (const item of loaded.questions) {
      const hash = contentHash(item);
      const row = {
        locale: item.locale,
        category: item.category,
        difficulty: item.difficulty,
        question: item.question,
        choices: JSON.stringify(item.choices),
        answerIndex: item.answer,
        explanation: item.explanation,
        source: item.source,
        contentHash: hash,
        active: 1,
        updatedAt: now,
      };
      const prev = existing.get(item.id);
      if (!prev) {
        await tx.insert(q).values({ id: item.id, ...row });
        result.added++;
      } else if (prev.contentHash !== hash || prev.active !== 1) {
        await tx.update(q).set(row).where(eq(q.id, item.id));
        result.updated++;
      } else result.unchanged++;
    }
    // Only deactivate when every file and item was valid: a typo must never take questions out of play.
    if (loaded.questions.length && loaded.errors.length === 0) {
      const keep = loaded.questions.map((x) => x.id);
      const gone = [...existing.values()].filter((r) => r.active === 1 && !keep.includes(r.id));
      if (gone.length) await tx.update(q).set({ active: 0, updatedAt: now }).where(notInArray(q.id, keep));
      result.deactivated = gone.length;
    }
  });
  return result;
}
