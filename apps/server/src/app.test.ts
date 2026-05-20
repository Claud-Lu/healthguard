import { describe, expect, it } from 'vitest';
import { createServerApp } from './app';

describe('collector api', () => {
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
});
