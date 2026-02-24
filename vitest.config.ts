import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/common/tests/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
  },
});
