import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createMemoryStore, createPostgresStore } from './index';
import type { HttpEvent } from '@health-guard/core';

const event: HttpEvent = { eventId: 'original-failure', appKey: 'demo', platform: 'flutter', type: 'http', timestamp: 1, sessionId: 's', anonymousId: 'a', sdkVersion: 'test', release: '1.2.3', method: 'GET', url: 'https://api.example.com/v1', duration: 1, success: false,
  networkDiagnostic: { version: 1, category: 'unknown', targetOrigin: 'https://api.example.com', networkAvailability: 'unavailable', network: {}, timing: { availability: 'unavailable' }, recentChanges: [] } };

describe('collector idempotent network replay', () => {
  it('memory mode preserves one occurrence when acknowledgement is lost', async () => {
    const store = createMemoryStore();
    await store.ingestEvents([event,event]);
    await store.ingestEvents([event]);
    expect((await store.listIssues({ appKey: 'demo' }))[0].eventCount).toBe(1);
    expect((await store.getOverview({ appKey: 'demo' })).events).toBe(1);
  });
  it('PostgreSQL SQL is replay-safe and persists diagnostic payloads without changing their identity', async () => {
    // Runs the real PostgreSQL engine compiled to WASM; no service credentials.
    // It validates SQL semantics, not multi-process advisory-lock concurrency.
    const db = new PGlite();
    const query = async (sql: string, params: unknown[] = []) => {
      if (!params.length) {
        const results = await db.exec(sql); const result = results[results.length - 1];
        return { rows: result?.rows ?? [], rowCount: result?.affectedRows ?? 0 };
      }
      const result = await db.query(sql, params); return { rows: result.rows, rowCount: result.affectedRows };
    };
    const pool = { query, connect: async () => ({ query, release() {} }) };
    try {
      const store = await createPostgresStore({ pool: pool as never });
      await store.ingestEvents([event,event]);
      await store.ingestEvents([event]);
      const [issue] = await store.listIssues({ appKey: 'demo' });
      expect(issue.eventCount).toBe(1);
      const detail = await store.getIssueDetail(issue.id);
      expect(detail.events).toHaveLength(1);
      expect(detail.events[0]).toMatchObject({ eventId: event.eventId, timestamp: 1, release: '1.2.3', networkDiagnostic: event.networkDiagnostic });
      await store.ingestEvents([{ ...event, eventId: 'second-failure' }, event]);
      expect((await store.listIssues({ appKey: 'demo' }))[0].eventCount).toBe(2);
    } finally { await db.close(); }
  }, 30000);
});
