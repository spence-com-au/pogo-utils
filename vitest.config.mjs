import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    dir: 'src',
    testTimeout: 60_000,
    coverage: {
      enabled: false,
      include: ['src/**/*.mts', 'src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text'],
    },
  },
});
