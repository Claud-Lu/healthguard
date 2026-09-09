import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createPostgresStore } from '../store';
import { encryptSecret } from './service';
import type { ErrorEvent } from '@health-guard/core';

// Run against a disposable database: TEST_DATABASE_URL=... yarn test.
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('notification PostgreSQL persistence and concurrency', () => {
  it('persists encrypted settings, atomically deduplicates alerts, claims once and recovers interrupted delivery', async () => {
    const admin = new Pool({ connectionString: databaseUrl });
    const schema = `notification_test_${Date.now()}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    try {
      const store = await createPostgresStore({ pool });
      await store.createUser({ id: 'u1', email: 'owner@example.com', passwordHash: '', createdAt: 1 });
      await store.createApp({ id: 'p1', name: 'Demo', appKey: 'demo', type: 'web', ownerUserId: 'u1', createdAt: 1 });
      await store.notifications.saveSender('u1', { host: 'smtp.example.com', port: 465, secure: true, username: 'sender@example.com', fromEmail: 'sender@example.com', fromName: 'Demo', passwordEncrypted: encryptSecret('secret', randomBytes(32), 'u1') });
      await store.notifications.saveRule('demo', { enabled: true, recipients: ['team@example.com'], onNewIssue: true, onRegression: true, threshold: 2, cooldownMinutes: 1 });
      const event = (eventId: string): ErrorEvent => ({ eventId, appKey: 'demo', timestamp: Date.now(), platform: 'web', type: 'error', errorType: 'js', message: 'Example error', fingerprint: 'fp', sessionId: 's', anonymousId: 'a', sdkVersion: '0.3.0', breadcrumbs: [], release: 'v1.0.0' });
      await Promise.all(Array.from({ length: 6 }, (_, i) => store.ingestEvents([event(String(i))])));
      const [issue] = await store.listIssues({ appKey: 'demo' });
      expect(issue.eventCount).toBe(6);
      expect(await store.notifications.listJobs('u1', 'demo')).toHaveLength(1);
      expect(await store.notifications.listJobs('other', 'demo')).toHaveLength(0);
      const restarted = await createPostgresStore({ pool });
      expect((await restarted.notifications.getSender('u1'))?.host).toBe('smtp.example.com');
      expect((await restarted.notifications.getRule('demo')).recipients).toEqual(['team@example.com']);
      const claims = await Promise.all([store.notifications.claimJob(Date.now()), restarted.notifications.claimJob(Date.now())]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const job = claims.find(Boolean)!;
      await pool.query('UPDATE notification_jobs SET updated_at = $1 WHERE id = $2', [Date.now() - 360_000, job.id]);
      expect(await restarted.notifications.claimJob(Date.now())).toBeNull();
      expect((await restarted.notifications.listJobs('u1', 'demo'))[0]).toMatchObject({ status: 'failed', error: 'DELIVERY_UNKNOWN' });
      await pool.query('DELETE FROM notification_cooldowns');
      await store.markIssueFixed(issue.id, 'v2.0.0'); await store.markIssueVerified(issue.id, 'v2.0.0');
      await store.ingestEvents([{ ...event('regression'), release: 'v2.0.0' }]);
      expect((await store.notifications.listJobs('u1', 'demo'))[0].reason).toBe('regression');
      const next = await store.notifications.claimJob(Date.now());
      await store.notifications.finishJob(next!.id, 'sent', null, Date.now());
      expect((await store.notifications.listJobs('u1', 'demo'))[0].status).toBe('sent');
    } finally {
      await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
    }
  }, 30_000);
});
