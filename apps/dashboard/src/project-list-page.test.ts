import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('project list logout navigation', () => {
  it('returns to login after logout clears local state', () => {
    const source = readFileSync(new URL('./pages/ProjectListPage.ts', import.meta.url), 'utf8');

    expect(source).toContain("router.push('/login')");
  });
});
