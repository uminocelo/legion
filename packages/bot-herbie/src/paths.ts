import { fileURLToPath } from 'node:url';

export const HERBIE_MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));
export const HERBIE_LOCALES_DIR = fileURLToPath(new URL('../locales', import.meta.url));
export const HERBIE_CONTENT_DIR = fileURLToPath(new URL('../content', import.meta.url));
