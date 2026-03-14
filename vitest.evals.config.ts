import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/evals/**/*.test.ts'],
    testTimeout: 60_000,
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
});
