import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Locale } from '@legion/core';
import { and, eq, notInArray } from 'drizzle-orm';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import type { JarvisRepo } from './db/repo.js';
import { checkTriviaItems, type TriviaQuestion } from './domain/trivia.js';

export { checkTriviaItems, parseTriviaYaml, questionSchema, type TriviaQuestion } from './domain/trivia.js';

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
      const res = checkTriviaItems(raw, file, { categories, locale: fileLocale, seen });
      questions.push(...res.questions);
      errors.push(...res.errors);
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
  // Questions created in Discord are never touched by file reloads.
  const existing = new Map(
    (await repo.allQuestions()).filter((r) => r.origin === 'file').map((r) => [r.id, r]),
  );
  const staffIds = new Set((await repo.allQuestions()).filter((r) => r.origin !== 'file').map((r) => r.id));
  const result: SyncResult = { added: 0, updated: 0, deactivated: 0, unchanged: 0, errors: loaded.errors };
  const now = repo.now();
  await repo.db.transaction(async (tx) => {
    for (const item of loaded.questions) {
      if (staffIds.has(item.id)) {
        result.errors.push(`${item.id}: id já usado por uma pergunta criada pela staff; ignorada`);
        continue;
      }
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
      // Staff disabled it: content may update, but it stays out of play.
      if (prev?.review === 'disabled') row.active = 0;
      if (!prev) {
        await tx.insert(q).values({ id: item.id, ...row });
        result.added++;
      } else if (prev.contentHash !== hash || prev.active !== row.active) {
        await tx.update(q).set(row).where(eq(q.id, item.id));
        result.updated++;
      } else result.unchanged++;
    }
    // Only deactivate when every file and item was valid: a typo must never take questions out of play.
    if (loaded.questions.length && loaded.errors.length === 0) {
      const keep = loaded.questions.map((x) => x.id);
      const gone = [...existing.values()].filter((r) => r.active === 1 && !keep.includes(r.id));
      if (gone.length)
        await tx
          .update(q)
          .set({ active: 0, updatedAt: now })
          .where(and(eq(q.origin, 'file'), notInArray(q.id, keep)));
      result.deactivated = gone.length;
    }
  });
  return result;
}
