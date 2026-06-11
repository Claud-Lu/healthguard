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

    expect(source).not.toContain("from '@health-guard/core'");
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@health-guard/core');
    expect(manifest.main).toBe('dist/index.cjs');
    expect(manifest.exports?.['.']?.require).toBe('./dist/index.cjs');
    expect(manifest.exports?.['.']?.default).toBe('./dist/index.cjs');
    expect(manifest.exports?.['.']?.import).toBe('./dist/index.js');
  });

  it('emits JavaScript that mini-program builders can parse', () => {
    const cjs = readFileSync(resolve(packageRoot, 'dist/index.cjs'), 'utf8');
    const esm = readFileSync(resolve(packageRoot, 'dist/index.js'), 'utf8');

    for (const output of [cjs, esm]) {
      expect(output).not.toContain('??');
      expect(output).not.toContain('?.');
    }
  });
});
