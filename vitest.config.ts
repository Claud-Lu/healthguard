import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts', 'examples/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@health-guard/core': '/packages/core/src/index.ts',
      '@health-guard/sdk-web': '/packages/sdk-web/src/index.ts',
      '@health-guard/sdk-uniapp': '/packages/sdk-uniapp/src/index.ts',
      '@healthguard/server': '/apps/server/src/index.ts'
    }
  }
});
