import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('project detail mini-program context rendering', () => {
  const source = readFileSync(new URL('./pages/ProjectDetailPage.ts', import.meta.url), 'utf8');

  it('reads request fields from event context when promise errors keep them nested', () => {
    expect(source).toContain('function getEventContext');
    expect(source).toContain("context.url");
    expect(source).toContain("context.method");
    expect(source).toContain("context.statusCode");
    expect(source).toContain("context.requestData");
  });

  it('includes nested context fields in AI handoff reports', () => {
    expect(source).toContain('const context = getEventContext(evt)');
    expect(source).toContain('const requestData = getEventRequestData(evt, context)');
    expect(source).toContain('- **接口:**');
    expect(source).toContain('- **页面:**');
    expect(source).toContain('- **场景:**');
  });

  it('loads issue status and time range filters from the server and exposes archive actions', () => {
    expect(source).toContain("type IssueStatus = 'open' | 'archived'");
    expect(source).toContain("issueStatus = ref<IssueStatus>('open')");
    expect(source).toContain('function buildIssueQuery');
    expect(source).toContain("status=${encodeURIComponent(issueStatus.value)}");
    expect(source).toContain("type TimePreset = 'all' | '1d' | '7d' | '30d' | 'custom'");
    expect(source).toContain("timePreset = ref<TimePreset>('all')");
    expect(source).toContain("`/issues/${encodeURIComponent(issue.id)}/archive`");
    expect(source).toContain("`/issues/${encodeURIComponent(issue.id)}/reopen`");
  });
});
