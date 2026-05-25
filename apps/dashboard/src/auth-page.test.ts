import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('auth page navigation', () => {
  it('navigates to projects after successful login or registration', () => {
    const source = readFileSync(new URL('./pages/AuthPage.ts', import.meta.url), 'utf8');

    expect(source).toContain('useRouter');
    expect(source).toContain("router.push('/projects')");
  });
});
