import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createPostgresStore } from '../store';
import { encryptSecret } from './service';
import type { ErrorEvent, HttpEvent } from '@health-guard/core';

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

      const http: HttpEvent = { ...event('http-context'), type: 'http', platform: 'uniapp-app', method: 'POST', url: 'https://api.example.com/v1/position?access_token=secret&source=app', status: 500, duration: 140, success: false, pageUrl: '/pages/trip/current', environment: 'test' };
      await restarted.ingestEvents([http]);
      const contextJob = (await store.notifications.listJobs('u1', 'demo')).find(job => job.text.includes('Event ID: http-context'))!;
      expect(contextJob.text).toContain('请求地址 / Request URL: https://api.example.com/v1/position?access_token=%5BFiltered%5D&source=app');
      expect(contextJob.text).toContain('App 页面路由 / App route: /pages/trip/current');
      expect(contextJob.text).not.toContain('=secret');

      await store.notifications.saveRule('demo', { ...await store.notifications.getRule('demo'), threshold: 0 });
      const local: HttpEvent = { ...http, eventId: 'local-h5', platform: 'uniapp-h5', method: 'GET', url: 'http://127.0.0.1:5173/', pageUrl: 'http://127.0.0.1:5173/#/pages/trip', status: undefined, errorMessage: 'Failed to fetch' };
      await restarted.ingestEvents([local]);
      const localIssue = (await store.listIssues({ appKey: 'demo' })).find(issue => issue.message.includes('Failed to fetch'))!;
      expect(localIssue.eventCount).toBe(1);
      expect((await pool.query('SELECT 1 FROM notification_cooldowns WHERE key = $1', [localIssue.id])).rows).toHaveLength(0);
      expect((await store.notifications.listJobs('u1', 'demo')).some(job => job.text.includes('Event ID: local-h5'))).toBe(false);
      const afterLocalRestart = await createPostgresStore({ pool });
      const deployed: HttpEvent = { ...local, eventId: 'deployed-h5', url: 'https://api.example.com/', pageUrl: 'https://test.example.com/#/pages/trip' };
      await Promise.all([afterLocalRestart.ingestEvents([deployed]), restarted.ingestEvents([{ ...deployed, eventId: 'deployed-h5-concurrent' }])]);
      let deployedJobs = (await store.notifications.listJobs('u1', 'demo')).filter(job => job.issueId === localIssue.id);
      expect(deployedJobs).toHaveLength(1);
      expect(deployedJobs[0].reason).toBe('new_issue');
      expect(deployedJobs[0].text).toContain('Event ID: deployed-h5');
      expect((await pool.query('SELECT 1 FROM notification_local_triggers WHERE issue_id = $1', [localIssue.id])).rows).toHaveLength(0);

      await pool.query('DELETE FROM notification_cooldowns WHERE key = $1', [localIssue.id]);
      await store.markIssueFixed(localIssue.id, 'v2.0.0'); await store.markIssueVerified(localIssue.id, 'v2.0.0');
      await restarted.ingestEvents([{ ...local, eventId: 'local-h5-regression', release: 'v2.0.0' }]);
      const afterRegressionRestart = await createPostgresStore({ pool });
      await afterRegressionRestart.ingestEvents([{ ...deployed, eventId: 'deployed-old-release', release: 'v1.0.0' }, { ...deployed, eventId: 'deployed-missing-release', release: undefined }]);
      expect((await store.notifications.listJobs('u1', 'demo')).filter(job => job.issueId === localIssue.id)).toHaveLength(1);
      expect((await pool.query('SELECT 1 FROM notification_local_triggers WHERE issue_id = $1', [localIssue.id])).rows).toHaveLength(1);
      await afterRegressionRestart.ingestEvents([{ ...deployed, eventId: 'deployed-h5-regression', release: 'v2.0.0' }]);
      deployedJobs = (await store.notifications.listJobs('u1', 'demo')).filter(job => job.issueId === localIssue.id);
      expect(deployedJobs).toHaveLength(2);
      expect(deployedJobs[0].reason).toBe('regression');

      await restarted.ingestEvents([{ ...event('local-app'), fingerprint: 'local-app', platform: 'uniapp-app', environment: 'development' }]);
      expect((await store.notifications.listJobs('u1', 'demo')).some(job => job.text.includes('Event ID: local-app'))).toBe(false);
      expect((await pool.query('SELECT 1 FROM notification_local_triggers WHERE issue_id = $1', ['demo:local-app'])).rows).toHaveLength(1);
      await store.notifications.saveRule('demo', { ...await store.notifications.getRule('demo'), enabled: false });
      expect((await pool.query('SELECT 1 FROM notification_local_triggers WHERE app_key = $1', ['demo'])).rows).toHaveLength(0);
    } finally {
      await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
    }
  }, 30_000);
});
