import { isCanonName } from '@legion/core';

export type CodenameError = 'length' | 'chars' | 'canon';
export type CodenameResult =
  | { ok: true; codename: string; normalized: string }
  | { ok: false; error: CodenameError; codename: string };

const ALLOWED = /^[\p{L}\p{N} '-]+$/u;

/** Trims and collapses inner whitespace: "  Fênix   Azul " → "Fênix Azul". */
export const tidyCodename = (raw: string) => raw.trim().replace(/\s+/g, ' ');

/** Uniqueness key: case- and accent-insensitive ("Fênix Azul" = "fenix azul"). */
export const normalizeCodename = (raw: string) =>
  tidyCodename(raw).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function validateCodename(raw: string, limits: { min: number; max: number }): CodenameResult {
  const codename = tidyCodename(raw);
  if ([...codename].length < limits.min || [...codename].length > limits.max)
    return { ok: false, error: 'length', codename };
  if (!ALLOWED.test(codename)) return { ok: false, error: 'chars', codename };
  if (isCanonName(codename)) return { ok: false, error: 'canon', codename };
  return { ok: true, codename, normalized: normalizeCodename(codename) };
}
