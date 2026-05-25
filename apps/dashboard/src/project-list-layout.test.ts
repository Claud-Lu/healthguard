import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('project list layout', () => {
  it('presents HealthGuard as a product before the project grid', () => {
    const page = readFileSync(new URL('./pages/ProjectListPage.ts', import.meta.url), 'utf8');
    const messages = readFileSync(new URL('./i18n.ts', import.meta.url), 'utf8');

    expect(messages).toContain('dashboardIntroTitle');
    expect(messages).toContain('Self-hosted monitoring');
    expect(messages).toContain('开源、自托管的应用健康监控');
    expect(page).toContain('dashboard-hero');
    expect(page).toContain('dashboardIntroTitle');
  });

  it('keeps the project grid anchored near the top of the dashboard', () => {
    const styles = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

    expect(styles).toContain('align-content: start;');
    expect(styles).toContain('.project-table');
    expect(styles).toContain('.project-table-row');
  });
});
