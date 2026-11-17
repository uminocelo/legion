import { fileURLToPath } from 'node:url';

export const JARVIS_MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));
export const JARVIS_LOCALES_DIR = fileURLToPath(new URL('../locales', import.meta.url));
export const JARVIS_CONTENT_DIR = fileURLToPath(new URL('../content', import.meta.url));
