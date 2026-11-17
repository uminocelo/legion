import { fileURLToPath } from 'node:url';

export const SENTINEL_MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));
export const SENTINEL_LOCALES_DIR = fileURLToPath(new URL('../locales', import.meta.url));
