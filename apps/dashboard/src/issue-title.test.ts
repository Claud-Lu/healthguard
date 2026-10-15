import { describe, expect, it } from 'vitest';
import { issueDisplayTitle } from './issue-title';

const issue = { errorType: 'http', message: 'GET /v1/calls - Full original timeout message' };
const event = (url: unknown, extra = {}) => ({ type: 'http', method: 'GET', url, timestamp: 10, ...extra });
describe('HTTP issue display titles', () => {
  it('shows the recorded absolute request URL and retains the complete error', () => {
    expect(issueDisplayTitle(issue, [event('https://api.example.com/v1/calls?page=2')])).toBe('GET https://api.example.com/v1/calls?page=2 - Full original timeout message');
  });
  it('uses the newest matching request rather than response array order', () => {
    expect(issueDisplayTitle(issue, [event('https://old.example.com/v1/calls'), event('https://new.example.com/v1/calls', { timestamp: 20 })])).toContain('https://new.example.com/v1/calls');
  });
  it('does not substitute a different method or path from a historical group', () => {
    expect(issueDisplayTitle(issue, [event('https://api.example.com/v1/other'), event('https://api.example.com/v1/calls', { method: 'POST' })])).toBe(issue.message);
  });
  it('keeps an already absolute title intact even when an event has another host', () => {
    const title = 'GET https://recorded.example.com/v1/calls [timeout] - original';
    expect(issueDisplayTitle({ ...issue, message: title }, [event('https://other.example.com/v1/calls')])).toBe(title);
  });
  it.each([[], [event('/v1/calls')], [event('invalid')], [event('javascript:alert(1)')], [event(undefined)], [event('https://api.example.com/v1/calls', { type: 'error' })]].map(events => ({ events })))('never invents a missing host from unavailable evidence: $events', ({ events }) => {
    expect(issueDisplayTitle(issue, events)).toBe(issue.message);
  });
  it('leaves native errors and non-request titles alone', () => {
    expect(issueDisplayTitle({ ...issue, errorType: 'native' }, [event('https://api.example.com/v1/calls')])).toBe(issue.message);
    expect(issueDisplayTitle({ ...issue, message: 'A request failed' }, [event('https://api.example.com/v1/calls')])).toBe('A request failed');
  });
  it('masks authentication parameters and URL credentials in the inserted target', () => {
    const title = issueDisplayTitle(issue, [event('https://user:private@api.example.com/v1/calls?token=private&page=2#secret')]);
    expect(title).toContain('https://api.example.com/v1/calls?token=%5BFiltered%5D&page=2');
    expect(title).not.toContain('private');
    expect(title).not.toContain('#secret');
  });
});
