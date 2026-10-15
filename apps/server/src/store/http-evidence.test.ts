import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createMemoryStore, createPostgresStore } from './index';
import type { HttpEvent } from '@health-guard/core';
const base: HttpEvent = { eventId: 'latest', appKey: 'demo', platform: 'flutter', type: 'http', timestamp: 300, sessionId: 's', anonymousId: 'a', sdkVersion: 'test', method: 'GET', url: 'https://api.example.com/calls', duration: 10003, success: false, release: '1.0.53', errorMessage: 'latest connection error', context: { originalError: { dioType: 'connectionTimeout' } } };
for (const mode of ['memory', 'postgres']) describe(mode + ' HTTP evidence', () => {
  it('keeps phase groups independent and does not regress latest metadata on replay/restart', async () => {
    const db = mode === 'postgres' ? new PGlite() : null;
    const query = async (sql: string, params: unknown[] = []) => {
      if (!params.length) { const a = await db!.exec(sql); const r = a[a.length - 1]; return { rows: r?.rows ?? [], rowCount: r?.affectedRows ?? 0 }; }
      const r = await db!.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows };
    };
    const pool = { query, connect: async () => ({ query, release() {} }) };
    try {
      let store = db ? await createPostgresStore({ pool: pool as never }) : createMemoryStore();
      await store.ingestEvents([base, { ...base, eventId: 'older', timestamp: 100, release: '1.0.49', errorMessage: 'old connection error' }]);
      const [issue] = await store.listIssues({ appKey: 'demo' });
      expect(issue.lastSeenRelease).toBe('1.0.53');
      expect(issue.message).toContain('latest connection error');
      expect(issue.eventCount).toBe(2);
      if (db) { store = await createPostgresStore({ pool: pool as never }); expect((await store.listIssues({ appKey: 'demo' }))[0]).toMatchObject({ lastSeenRelease: '1.0.53', lastSeenAt: 300 }); }
      await store.ingestEvents([{ ...base, eventId: 'receive', timestamp: 400, context: { originalError: { dioType: 'receiveTimeout' } } }]);
      expect(await store.listIssues({ appKey: 'demo' })).toHaveLength(2);
    } finally { await db?.close(); }
  }, 30000);
});
