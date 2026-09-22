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

  it('exposes fix PR link tracking instead of the experimental repair task queue', () => {
    expect(source).toContain("type FixPrFilter = 'all' | 'linked' | 'missing'");
    expect(source).toContain("fixPrFilter = ref<FixPrFilter>('all')");
    expect(source).toContain('function setIssueFixPr');
    expect(source).toContain('`/issues/${encodeURIComponent(issue.id)}/fix-pr`');
    expect(source).toContain('function renderFixPrPanel');
    expect(source).toContain('function renderFixPrEditor');
    expect(source).toContain('issue.fixPrUrl');
    expect(source).toContain("fixPrFilter.value === 'linked' && !issue.fixPrUrl");
    expect(source).not.toContain('createRepairTask');
    expect(source).not.toContain('renderRepairTaskCreator');
    expect(source).not.toContain('renderRepairTaskList');
  });

  it('exposes issue release workflow actions and status messaging', () => {
    expect(source).toContain('fixedReleaseInput = ref');
    expect(source).toContain('verifiedReleaseInput = ref');
    expect(source).toContain('function markIssueFixed');
    expect(source).toContain('function markIssueVerified');
    expect(source).toContain("`/issues/${encodeURIComponent(issue.id)}/fixed`");
    expect(source).toContain("`/issues/${encodeURIComponent(issue.id)}/verified`");
    expect(source).toContain('renderIssueReleaseWorkflow');
    expect(source).toContain('Issue status');
    expect(source).toContain('Old releases are still reporting');
  });
});
