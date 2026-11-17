import { fileURLToPath } from 'node:url';

export const ULTRON_MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));
export const ULTRON_LOCALES_DIR = fileURLToPath(new URL('../locales', import.meta.url));
export const ULTRON_CONTENT_DIR = fileURLToPath(new URL('../content', import.meta.url));
