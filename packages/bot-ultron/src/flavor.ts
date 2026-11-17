import { type BotContext, type I18n, isCanonName, type Locale, mulberry32 } from '@legion/core';
import type { UltronConfig } from './config.js';
import type { UltronRepo } from './db/repo.js';

export type FlavorKind = 'enemy_taunt' | 'event_announcement' | 'event_victory' | 'event_defeat';
export const AI_PROVIDER = 'openai-compatible';

export interface AiEnv {
  AI_BASE_URL?: string | undefined;
  AI_MODEL?: string | undefined;
  AI_API_KEY?: string | undefined;
}

/** Strips mentions, links and newlines; trims to 200 chars; null when empty or a canon name shows up. */
export function filterFlavor(raw: string): string | null {
  const text = raw
    .replace(/<(@[!&]?|#)\d+>/g, '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/@(everyone|here)\b/gi, '')
    .replace(/@/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^["'“”\s]+|["'“”\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200)
    .trim();
  if (!text || isCanonName(text)) return null;
  return text;
}

const SYSTEM_PROMPT: Record<Locale, string> = {
  'pt-BR':
    'Você é ULTRON, uma IA vilã original de um jogo de fãs no Discord. Escreva UMA frase curta em português do Brasil, em tom ameaçador e teatral. Nunca cite personagens reais da Marvel, pessoas reais, links ou menções. Nada de violência além do nível de desenho animado. Responda só com a frase.',
  en: 'You are ULTRON, an original villain AI in a Discord fan game. Write ONE short sentence in English, menacing and theatrical. Never name real Marvel characters, real people, links or mentions. No violence beyond cartoon level. Reply with the sentence only.',
};

const INSTRUCTION: Record<FlavorKind, string> = {
  enemy_taunt: 'A taunt from these enemies as the fight begins',
  event_announcement: 'An announcement that this world event is coming',
  event_victory: 'A bitter line after the players won this world event',
  event_defeat: 'A gloating line after the players lost this world event',
};

/**
 * Flavor text only: callers decide every number and outcome first, then ask for words. With
 * `ai.provider: none` (default) no network call is ever made.
 */
export class FlavorText {
  private lastWarn = 0;

  constructor(
    private readonly o: {
      i18n: I18n;
      locale: () => Locale;
      cfg: () => UltronConfig['ai'];
      repo: UltronRepo;
      clock: { now(): Date };
      log: BotContext['log'];
      env?: AiEnv;
      fetch?: typeof fetch;
    },
  ) {}

  get provider() {
    return this.o.cfg().provider;
  }

  staticLine(
    kind: FlavorKind,
    vars: Record<string, string | number>,
    seed: number,
    keys: string[] = [],
  ): string {
    const fallback: Record<FlavorKind, string[]> = {
      enemy_taunt: ['ultron.taunt.generic.1', 'ultron.taunt.generic.2', 'ultron.taunt.generic.3'],
      event_announcement: ['ultron.flavor.announce.1', 'ultron.flavor.announce.2'],
      event_victory: ['ultron.flavor.victory.1', 'ultron.flavor.victory.2'],
      event_defeat: ['ultron.flavor.defeat.1', 'ultron.flavor.defeat.2'],
    };
    const pool = keys.length ? keys : fallback[kind];
    const key = pool[mulberry32(seed).d(pool.length) - 1] ?? pool[0] ?? '';
    return this.o.i18n.t(key, vars, this.o.locale());
  }

  async text(
    kind: FlavorKind,
    vars: Record<string, string | number>,
    seed: number,
    keys: string[] = [],
  ): Promise<string> {
    const fallback = this.staticLine(kind, vars, seed, keys);
    if (this.provider !== AI_PROVIDER) return fallback;
    const ai = await this.generate(kind, vars);
    return ai ? `🤖 ULTRON: ${ai}` : fallback;
  }

  /** One AI call within the budget and timeout; null on any problem (the caller uses the static line). */
  async generate(kind: FlavorKind, facts: Record<string, string | number>): Promise<string | null> {
    const cfg = this.o.cfg();
    const env = this.o.env ?? process.env;
    if (!env.AI_BASE_URL || !env.AI_MODEL) return this.warn('AI_BASE_URL or AI_MODEL is empty');
    const hourAgo = new Date(this.o.clock.now().getTime() - 3_600_000).toISOString();
    if ((await this.o.repo.flavorCallsSince(hourAgo, AI_PROVIDER)) >= cfg.maxCallsPerHour)
      return this.warn('AI budget for this hour is used up');
    const locale = this.o.locale();
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    let ok = false;
    try {
      const res = await (this.o.fetch ?? fetch)(`${env.AI_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          ...(env.AI_API_KEY ? { authorization: `Bearer ${env.AI_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: env.AI_MODEL,
          max_tokens: 80,
          temperature: 0.9,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT[locale] },
            { role: 'user', content: `${INSTRUCTION[kind]}. Facts: ${JSON.stringify(facts)}` },
          ],
        }),
      });
      if (!res.ok) return this.warn(`AI answered HTTP ${res.status}`);
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = filterFlavor(body.choices?.[0]?.message?.content ?? '');
      ok = text !== null;
      return text ?? this.warn('AI text was empty or filtered');
    } catch (err) {
      return this.warn(
        ctrl.signal.aborted
          ? `AI timed out after ${cfg.timeoutMs} ms`
          : `AI call failed: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
      await this.o.repo
        .logFlavor({ kind, provider: AI_PROVIDER, ok, latencyMs: Date.now() - started })
        .catch(() => undefined);
    }
  }

  /** Logs at warn at most once per minute; always returns null. */
  private warn(msg: string): null {
    const now = this.o.clock.now().getTime();
    if (now - this.lastWarn >= 60_000) {
      this.lastWarn = now;
      this.o.log.warn({ provider: AI_PROVIDER }, `flavor text fallback: ${msg}`);
    }
    return null;
  }
}
