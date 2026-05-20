import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts', 'examples/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@healthguard/core': '/packages/core/src/index.ts',
      '@healthguard/sdk-web': '/packages/sdk-web/src/index.ts',
      '@healthguard/server': '/apps/server/src/index.ts'
    }
  }
});
