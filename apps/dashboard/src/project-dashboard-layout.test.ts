import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('project dashboard layout', () => {
  it('uses an operations table with health metrics on the project home', () => {
    const source = readFileSync(new URL('./pages/ProjectListPage.ts', import.meta.url), 'utf8');

    expect(source).toContain('project-table');
    expect(source).toContain('healthScore');
    expect(source).toContain('failedRequests');
    expect(source).toContain('openDetail');
  });

  it('keeps creation controls on the project home sidebar', () => {
    const source = readFileSync(new URL('./pages/ProjectListPage.ts', import.meta.url), 'utf8');

    expect(source).toContain('language-row');
    expect(source).toContain('create-box');
    expect(source).toContain('app-list');
  });

  it('moves SDK integration into the project detail sidebar', () => {
    const source = readFileSync(new URL('./pages/ProjectDetailPage.ts', import.meta.url), 'utf8');

    expect(source).toContain('sdk-sidebar');
    expect(source).not.toContain("class: 'panel guide'");
  });
});
