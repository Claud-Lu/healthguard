import { describe, expect, it } from 'vitest';
import { extractSearchKeywords, extractStringLiteral, searchSourceFiles, toApiBase } from './index';

const dummyIssue = {
  id: 'web_demo:js:abc',
  appKey: 'web_demo',
  fingerprint: 'js:abc',
  message: 'Failed to load nearby vehicles',
  errorType: 'promise',
  eventCount: 10,
  firstSeenAt: 0,
  lastSeenAt: 1,
  platformDistribution: { web: 10 },
  archived: false,
  archivedAt: null
};

const dummyDetail = {
  issue: dummyIssue,
  events: [
    {
      type: 'error' as const,
      appKey: 'web_demo',
      eventId: 'evt_1',
      message: 'Failed to load nearby vehicles',
      pageUrl: 'https://example.com/pages/vehicle/nearby',
      platform: 'web',
      errorType: 'promise',
      timestamp: 1,
      breadcrumbs: [
        { type: 'navigation', message: 'Page vehicleNearby loaded', timestamp: 0 },
        { type: 'http', message: 'GET /api/vehicles/nearby failed', timestamp: 0 }
      ]
    }
  ]
};

describe('repair-agent helpers', () => {
  it('converts collector endpoint to api base', () => {
    expect(toApiBase('https://hg.example.com/api/events/batch')).toBe('https://hg.example.com/api');
    expect(toApiBase('https://hg.example.com/api/events/batch/')).toBe('https://hg.example.com/api');
    expect(toApiBase('https://hg.example.com/api')).toBe('https://hg.example.com/api');
  });

  it('extracts string literals from source', () => {
    const source = `
      const client = createHealthGuardClient({
        appKey: 'demo-app',
        endpoint: "https://hg.example.com/api/events/batch",
      });
    `;

    expect(extractStringLiteral(source, 'appKey')).toBe('demo-app');
    expect(extractStringLiteral(source, 'endpoint')).toBe('https://hg.example.com/api/events/batch');
  });

  it('ignores template placeholders', () => {
    const source = `
      createHealthGuardClient({
        appKey: \`\${appKey.value}\`,
        endpoint: "https://hg.example.com/api/events/batch"
      });
    `;

    expect(extractStringLiteral(source, 'appKey')).toBeUndefined();
  });

  it('extracts search keywords from issue and events', () => {
    const keywords = extractSearchKeywords(dummyIssue, dummyDetail);

    expect(keywords.has('nearby')).toBe(true);
    expect(keywords.has('vehicles')).toBe(true);
    expect(keywords.has('vehicle')).toBe(true);
    expect(keywords.has('nearby')).toBe(true);
    expect(keywords.has('load')).toBe(true);
    expect(keywords.has('failed')).toBe(false);
  });

  it('searches local source files for relevant code', () => {
    const matches = searchSourceFiles(__dirname, dummyIssue, dummyDetail, { maxFiles: 5 });

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].score).toBeGreaterThan(0);
    expect(matches[0].file).toBeDefined();
  });
});
