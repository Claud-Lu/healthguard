import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('dashboard root component', () => {
  it('does not rely on runtime template compilation for RouterView', () => {
    const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

    expect(source).not.toContain("template: '<router-view />'");
    expect(source).toContain('RouterView');
  });
});
