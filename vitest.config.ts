import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@legion/core': src('./packages/core/src/index.ts'),
      '@legion/bot-cerebro': src('./packages/bot-cerebro/src/index.ts'),
      '@legion/runner': fileURLToPath(new URL('./apps/runner/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
    ],
    testTimeout: 20000,
  },
});
