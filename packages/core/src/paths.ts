import { fileURLToPath } from 'node:url';

/** Folder of this package's files (data/, locales/, drizzle/), valid from src/ and dist/. */
export const CORE_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CORE_LOCALES_DIR = fileURLToPath(new URL('../locales', import.meta.url));
