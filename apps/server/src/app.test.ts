import { describe, expect, it } from 'vitest';
import { createServerApp } from './app';

describe('collector api', () => {
  it('creates apps and lists app keys for SDK integration', async () => {
    const app = createServerApp();

    const create = await app.inject({
      method: 'POST',
      url: '/api/apps',
      payload: { name: 'Demo Web' }
    });
    const list = await app.inject({
      method: 'GET',
      url: '/api/apps'
    });

    expect(create.statusCode).toBe(201);
    expect(create.json().app).toMatchObject({
      name: 'Demo Web'
    });
    expect(create.json().app.appKey).toMatch(/^app_/);
    expect(list.json().apps).toMatchObject([
      {
        name: 'Demo Web',
        appKey: create.json().app.appKey
      }
    ]);

    await app.close();
  });

  it('stores a batch and aggregates repeated errors into one issue', async () => {
    const app = createServerApp();

    const payload = {
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
          fingerprint: 'js:boom',
          breadcrumbs: []
        },
        {
          eventId: 'evt_2',
          appKey: 'demo-app',
          platform: 'web',
          type: 'error',
          timestamp: 1710000000100,
          sessionId: 'session-2',
          anonymousId: 'anon-2',
          sdkVersion: '0.1.0',
          errorType: 'js',
          message: 'boom',
          fingerprint: 'js:boom',
          breadcrumbs: []
        }
      ]
    };

    const ingest = await app.inject({
      method: 'POST',
      url: '/api/events/batch',
      payload
    });
    const issues = await app.inject({
      method: 'GET',
      url: '/api/issues?appKey=demo-app'
    });

    expect(ingest.statusCode).toBe(202);
    expect(ingest.json()).toMatchObject({ accepted: 2 });
    expect(issues.statusCode).toBe(200);
    expect(issues.json().issues).toMatchObject([
      {
        appKey: 'demo-app',
        fingerprint: 'js:boom',
        eventCount: 2,
        message: 'boom'
      }
    ]);

    await app.close();
  });

  it('rejects malformed event batches', async () => {
    const app = createServerApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/events/batch',
      payload: { appKey: 'demo-app', events: [] }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('Invalid event batch');

    await app.close();
  });

  it('returns overview metrics and issue detail with recent events', async () => {
    const app = createServerApp();
    const payload = {
      appKey: 'demo-app',
      events: [
        {
          eventId: 'evt_error',
          appKey: 'demo-app',
          platform: 'web',
          type: 'error',
          timestamp: 1710000000000,
          sessionId: 'session-1',
          anonymousId: 'anon-1',
          sdkVersion: '0.1.0',
          errorType: 'js',
          message: 'boom',
          stack: 'Error: boom',
          fingerprint: 'js:boom',
          breadcrumbs: [{ type: 'manual', message: 'clicked save', timestamp: 1709999999990 }]
        },
        {
          eventId: 'evt_http',
          appKey: 'demo-app',
          platform: 'web',
          type: 'http',
          timestamp: 1710000001000,
          sessionId: 'session-1',
          anonymousId: 'anon-1',
          sdkVersion: '0.1.0',
          method: 'GET',
          url: 'https://api.example.com/fail',
          status: 500,
          duration: 120,
          success: false
        }
      ]
    };

    await app.inject({ method: 'POST', url: '/api/events/batch', payload });
    const overview = await app.inject({ method: 'GET', url: '/api/overview?appKey=demo-app' });
    const detail = await app.inject({ method: 'GET', url: '/api/issues/demo-app%3Ajs%3Aboom' });

    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      totals: {
        events: 2,
        errors: 1,
        failedRequests: 1,
        affectedUsers: 1,
        issues: 1
      }
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().issue).toMatchObject({
      id: 'demo-app:js:boom',
      message: 'boom'
    });
    expect(detail.json().events).toHaveLength(1);
    expect(detail.json().events[0]).toMatchObject({
      eventId: 'evt_error',
      stack: 'Error: boom'
    });

    await app.close();
  });
});
