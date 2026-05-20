import { describe, expect, it } from 'vitest';
import { createIssueFingerprint, parseEventBatch, sanitizeUrl } from './index';

describe('event schema', () => {
  it('accepts a valid web error batch', () => {
    const parsed = parseEventBatch({
      appKey: 'demo-app',
      events: [
        {
          eventId: 'evt_1',
          appKey: 'demo-app',
          platform: 'web',
          type: 'error',
          timestamp: 1710000000000,
          sessionId: 'session-1',
          anonymousId: 'anon-1',
          sdkVersion: '0.1.0',
          errorType: 'js',
          message: 'boom',
          stack: 'Error: boom\n    at demo.js:1:1',
          fingerprint: 'manual-fingerprint',
          breadcrumbs: []
        }
      ]
    });

    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].type).toBe('error');
  });

  it('rejects events whose appKey does not match the batch appKey', () => {
    expect(() =>
      parseEventBatch({
        appKey: 'app-a',
        events: [
          {
            eventId: 'evt_1',
            appKey: 'app-b',
            platform: 'web',
            type: 'http',
            timestamp: 1710000000000,
            sessionId: 'session-1',
            anonymousId: 'anon-1',
            sdkVersion: '0.1.0',
            method: 'GET',
            url: 'https://example.com/api',
            status: 500,
            duration: 42,
            success: false
          }
        ]
      })
    ).toThrow(/appKey/);
  });
});

describe('privacy helpers', () => {
  it('filters sensitive query parameters', () => {
    const sanitized = sanitizeUrl('https://example.com/login?token=abc&name=codex&password=secret');

    expect(sanitized).toBe('https://example.com/login?token=%5BFiltered%5D&name=codex&password=%5BFiltered%5D');
  });

  it('builds stable issue fingerprints from error type and stack head', () => {
    const first = createIssueFingerprint({
      errorType: 'js',
      message: 'Cannot read properties of undefined',
      stack: 'TypeError: Cannot read properties of undefined\n    at submit (/src/App.ts:10:5)'
    });
    const second = createIssueFingerprint({
      errorType: 'js',
      message: 'Cannot read properties of undefined',
      stack: 'TypeError: Cannot read properties of undefined\n    at submit (/src/App.ts:10:5)'
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^js:/);
  });
});
