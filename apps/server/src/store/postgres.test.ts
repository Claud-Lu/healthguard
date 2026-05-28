import { describe, expect, it } from 'vitest';
import { createPostgresStore } from './postgres';

interface QueryResult {
  rows: unknown[];
  rowCount?: number;
}

interface StoredEvent {
  event_id: string;
  app_key: string;
  platform: string;
  timestamp: number;
  type: string;
  payload: Record<string, unknown>;
}

interface StoredIssue {
  id: string;
  app_key: string;
  fingerprint: string;
  message: string;
  error_type: string;
  event_count: number;
  first_seen_at: number;
  last_seen_at: number;
  platform_distribution: Record<string, number>;
}

function createFakePostgresPool(events: StoredEvent[]) {
  const issues = new Map<string, StoredIssue>();

  const fakePool = {
    issues,
    async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
      if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX') || sql.includes('DO $$') || sql.includes('ALTER TABLE')) {
        return { rows: [] };
      }

      if (sql.includes('SELECT event_id, app_key, platform, timestamp, payload') && sql.includes('FROM events')) {
        return {
          rows: events.filter((event) => event.type === 'http' && event.payload.success === false)
        };
      }

      if (sql.startsWith('UPDATE events SET payload = $1 WHERE event_id = $2')) {
        const event = events.find((item) => item.event_id === params[1]);
        if (event) {
          event.payload = typeof params[0] === 'string' ? JSON.parse(params[0]) as Record<string, unknown> : params[0] as Record<string, unknown>;
        }
        return { rows: [] };
      }

      if (sql.startsWith('SELECT event_count, last_seen_at, platform_distribution FROM issues WHERE id = $1')) {
        const issue = issues.get(String(params[0]));
        return { rows: issue ? [issue] : [] };
      }

      if (sql.startsWith('INSERT INTO issues')) {
        const [id, appKey, fingerprint, message, errorType, eventCount, firstSeenAt, lastSeenAt, platformDistribution] = params;
        issues.set(String(id), {
          id: String(id),
          app_key: String(appKey),
          fingerprint: String(fingerprint),
          message: String(message),
          error_type: String(errorType),
          event_count: Number(eventCount),
          first_seen_at: Number(firstSeenAt),
          last_seen_at: Number(lastSeenAt),
          platform_distribution: JSON.parse(String(platformDistribution)) as Record<string, number>
        });
        return { rows: [] };
      }

      if (sql.startsWith('UPDATE issues SET event_count = $1')) {
        const issue = issues.get(String(params[3]));
        if (issue) {
          issue.event_count = Number(params[0]);
          issue.last_seen_at = Number(params[1]);
          issue.platform_distribution = JSON.parse(String(params[2])) as Record<string, number>;
        }
        return { rows: [] };
      }

      if (sql.startsWith('SELECT * FROM issues WHERE id = $1')) {
        const issue = issues.get(String(params[0]));
        return { rows: issue ? [issue] : [] };
      }

      if (sql.startsWith('SELECT * FROM issues')) {
        return { rows: Array.from(issues.values()) };
      }

      if (sql.startsWith('SELECT payload FROM events')) {
        return {
          rows: events
            .filter((event) => event.type === params[0] && event.app_key === params[1] && event.payload.fingerprint === params[2])
            .map((event) => ({ payload: event.payload }))
        };
      }

      if (sql.startsWith('DELETE FROM')) {
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`Unhandled query: ${sql}`);
    },
    async connect() {
      return {
        query: fakePool.query,
        release() {}
      };
    }
  };

  return { issues, pool: fakePool };
}

describe('postgres store historical http issues', () => {
  it('backfills failed http events into queryable issues on startup', async () => {
    const { pool } = createFakePostgresPool([
      {
        event_id: 'evt_http_1',
        app_key: 'demo-app',
        platform: 'alipay-miniprogram',
        timestamp: 1710000000000,
        type: 'http',
        payload: {
          eventId: 'evt_http_1',
          appKey: 'demo-app',
          platform: 'alipay-miniprogram',
          type: 'http',
          timestamp: 1710000000000,
          sessionId: 'session-1',
          anonymousId: 'anon-1',
          sdkVersion: '0.1.0',
          method: 'GET',
          url: 'https://api.example.com/fail',
          status: 500,
          duration: 120,
          success: false
        }
      }
    ]);

    const store = await createPostgresStore({ pool: pool as never });

    const issues = await store.listIssues({ appKey: 'demo-app' });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      appKey: 'demo-app',
      message: 'GET /fail',
      errorType: 'http',
      eventCount: 1,
      platformDistribution: { 'alipay-miniprogram': 1 }
    });
  });

  it('reads jsonb payload objects when returning issue detail events', async () => {
    const { pool } = createFakePostgresPool([
      {
        event_id: 'evt_http_1',
        app_key: 'demo-app',
        platform: 'alipay-miniprogram',
        timestamp: 1710000000000,
        type: 'http',
        payload: {
          eventId: 'evt_http_1',
          appKey: 'demo-app',
          platform: 'alipay-miniprogram',
          type: 'http',
          timestamp: 1710000000000,
          sessionId: 'session-1',
          anonymousId: 'anon-1',
          sdkVersion: '0.1.0',
          method: 'GET',
          url: 'https://api.example.com/fail',
          status: 500,
          duration: 120,
          success: false
        }
      }
    ]);

    const store = await createPostgresStore({ pool: pool as never });
    const [issue] = await store.listIssues({ appKey: 'demo-app' });
    const detail = await store.getIssueDetail(issue.id);

    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]).toMatchObject({
      eventId: 'evt_http_1',
      type: 'http',
      status: 500
    });
  });
});
