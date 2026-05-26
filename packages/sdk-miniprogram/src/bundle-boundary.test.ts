import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve(__dirname, '..');

describe('sdk-miniprogram bundle boundary', () => {
  it('does not pull core runtime dependencies into mini-program bundles', () => {
    const source = readFileSync(resolve(packageRoot, 'src/index.ts'), 'utf8');
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      exports?: Record<string, { require?: string; import?: string; default?: string }>;
      main?: string;
      module?: string;
    };

    expect(source).not.toContain("from '@healthguard/core'");
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@healthguard/core');
    expect(manifest.main).toBe('dist/index.cjs');
    expect(manifest.exports?.['.']?.require).toBe('./dist/index.cjs');
    expect(manifest.exports?.['.']?.default).toBe('./dist/index.cjs');
    expect(manifest.exports?.['.']?.import).toBe('./dist/index.js');
  });
});
