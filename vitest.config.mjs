import { defineConfig } from 'vitest/config';

const shared = {
  dir: 'src',
  testTimeout: 60_000,
};

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
      include: ['src/**/*.mts', 'src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text'],
    },
    projects: [
      {
        test: {
          ...shared,
          name: 'default',
        },
      },
    ],
  },
});
