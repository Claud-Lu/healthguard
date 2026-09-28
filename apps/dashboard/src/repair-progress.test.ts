import { describe, expect, it } from 'vitest';
import { repairStage, matchesIssueFilters } from './repair-progress';
import type { IssueSummary } from './globalStore';
const issue = { message: 'GET /vehicles', errorType: 'http', status: 'open', fixedInRelease: '1.0.1', verifiedInRelease: '1.0.1' } as IssueSummary;
describe('repair progress presentation', () => {
  it('uses lifecycle rather than stale verification metadata after recurrence', () => {
    expect(repairStage(issue)).toBe('pending');
    expect(repairStage({ ...issue, status: 'repairing' })).toBe('repairing');
    expect(repairStage({ ...issue, status: 'fixed_pending_release' })).toBe('verification');
    expect(repairStage({ ...issue, status: 'resolved' })).toBe('resolved');
  });
  it('combines search, metric and progress filters instead of returning early', () => {
    expect(matchesIssueFilters(issue, 'vehicles', 'http', 'repairing')).toBe(false);
    expect(matchesIssueFilters(issue, 'vehicles', 'http', 'pending')).toBe(true);
    expect(matchesIssueFilters(issue, 'missing', 'http', 'pending')).toBe(false);
    expect(matchesIssueFilters(issue, '', 'error', 'all')).toBe(false);
  });
});
