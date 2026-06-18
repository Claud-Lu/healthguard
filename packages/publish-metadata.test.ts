import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  files?: string[];
  publishConfig?: {
    access?: string;
  };
  license?: string;
  repository?: {
    type?: string;
    url?: string;
    directory?: string;
  };
  exports?: unknown;
};

const packages = [
  ['packages/core/package.json', '@health-guard/core'],
  ['packages/sdk-web/package.json', '@health-guard/sdk-web'],
  ['packages/sdk-miniprogram/package.json', '@health-guard/sdk-miniprogram'],
  ['packages/sdk-uniapp/package.json', '@health-guard/sdk-uniapp'],
  ['packages/repair-agent/package.json', '@health-guard/repair-agent']
] as const;

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as PackageJson;
}

describe('publish package metadata', () => {
  it.each(packages)('%s is configured for public npm publishing', (path, packageName) => {
    const manifest = readPackageJson(path);

    expect(manifest.name).toBe(packageName);
    expect(manifest.private).not.toBe(true);
    expect(manifest.license).toBe('MIT');
    expect(manifest.repository?.url).toBe('git+https://github.com/Claud-Lu/healthguard.git');
    expect(manifest.publishConfig?.access).toBe('public');
    expect(manifest.files).toEqual(['dist', 'README.md', 'package.json']);
    expect(manifest.exports).toBeDefined();
  });
});
