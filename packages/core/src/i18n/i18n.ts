import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locale } from '../config/schema.js';
import { LOCALES } from '../config/schema.js';

export type Dict = Record<string, string>;
export type Vars = Record<string, string | number>;

/** Resolves a member's preferred locale (provided by H.E.R.B.I.E. later). */
export type LocaleResolver = (discordUserId: string) => Promise<Locale | null>;

interface WarnLogger {
  warn(obj: object, msg?: string): void;
}

/** Flattens nested JSON into dotted keys: { core: { a: "x" } } → { "core.a": "x" }. */
export function flatten(obj: unknown, prefix = '', out: Dict = {}): Dict {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (typeof obj === 'string') {
    out[prefix] = obj;
  }
  return out;
}

export function interpolate(tpl: string, vars: Vars = {}): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])));
}

export function readLocaleDir(dir: string): Partial<Record<Locale, Dict>> {
  const out: Partial<Record<Locale, Dict>> = {};
  for (const locale of LOCALES) {
    const file = join(dir, `${locale}.json`);
    if (existsSync(file)) out[locale] = flatten(JSON.parse(readFileSync(file, 'utf8')));
  }
  return out;
}

export class I18n {
  private readonly dicts: Record<Locale, Dict> = { 'pt-BR': {}, en: {} };
  private resolver: LocaleResolver | null = null;
  private readonly warned = new Set<string>();

  constructor(
    readonly defaultLocale: Locale = 'pt-BR',
    private readonly log?: WarnLogger,
  ) {}

  /** Adds keys; later calls override earlier ones (so owner overrides go last). */
  add(locale: Locale, dict: Dict): void {
    Object.assign(this.dicts[locale], dict);
  }

  addDir(dir: string): void {
    for (const [locale, dict] of Object.entries(readLocaleDir(dir))) this.add(locale as Locale, dict);
  }

  dict(locale: Locale): Readonly<Dict> {
    return this.dicts[locale];
  }

  setResolver(resolver: LocaleResolver | null): void {
    this.resolver = resolver;
  }

  async localeFor(discordUserId: string | null | undefined): Promise<Locale> {
    if (!discordUserId || !this.resolver) return this.defaultLocale;
    try {
      return (await this.resolver(discordUserId)) ?? this.defaultLocale;
    } catch {
      return this.defaultLocale;
    }
  }

  has(key: string, locale: Locale = this.defaultLocale): boolean {
    return this.lookup(key, locale, undefined) !== undefined;
  }

  t(key: string, vars: Vars = {}, locale: Locale = this.defaultLocale): string {
    const tpl = this.lookup(key, locale, vars.count);
    if (tpl === undefined) {
      if (!this.warned.has(key)) {
        this.warned.add(key);
        this.log?.warn({ key, locale }, 'missing i18n key');
      }
      return key;
    }
    return interpolate(tpl, vars);
  }

  private lookup(key: string, locale: Locale, count: unknown): string | undefined {
    const chain = [...new Set<Locale>([locale, this.defaultLocale, 'pt-BR'])];
    for (const l of chain) {
      const d = this.dicts[l];
      if (typeof count === 'number') {
        const cat = new Intl.PluralRules(l).select(count);
        const plural = d[`${key}_${cat}`] ?? d[`${key}_other`];
        if (plural !== undefined) return plural;
      }
      if (d[key] !== undefined) return d[key];
    }
    return undefined;
  }
}

const placeholders = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

export interface ParityReport {
  missing: string[];
  extra: string[];
  placeholderMismatch: string[];
}

/** Compares a translation against the base (pt-BR): missing keys and placeholder differences. */
export function checkParity(base: Dict, other: Dict): ParityReport {
  const missing: string[] = [];
  const placeholderMismatch: string[] = [];
  for (const [key, value] of Object.entries(base)) {
    const o = other[key];
    if (o === undefined) missing.push(key);
    else if (placeholders(value).join(',') !== placeholders(o).join(',')) placeholderMismatch.push(key);
  }
  const extra = Object.keys(other).filter((k) => base[k] === undefined);
  return { missing, extra, placeholderMismatch };
}
