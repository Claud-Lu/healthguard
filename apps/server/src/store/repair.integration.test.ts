import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createPostgresStore } from './postgres';
import type { ErrorEvent } from '@health-guard/core';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('repair PostgreSQL persistence', () => {
  it('migrates an existing database, preserves notes across restarts and handles repair recurrence', async () => {
    const admin = new Pool({ connectionString: databaseUrl });
    const schema = `repair_test_${Date.now()}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    try {
      const store = await createPostgresStore({ pool });
      await pool.query('ALTER TABLE issues DROP COLUMN IF EXISTS repair_record');
      const migrated = await createPostgresStore({ pool });
      await migrated.createUser({ id: 'repair-owner', email: 'repair@example.com', passwordHash: '', createdAt: 1 });
      await migrated.createApp({ id: 'repair-project', appKey: 'repair-example', name: 'Repair', type: 'web', ownerUserId: 'repair-owner', createdAt: 1 });
      const event: ErrorEvent = { appKey: 'repair-example', eventId: 'repair-1', type: 'error', errorType: 'js', message: 'Example', fingerprint: 'repair', timestamp: Date.now(), platform: 'web', sessionId: 's', anonymousId: 'a', sdkVersion: 'test', breadcrumbs: [], release: '1.0.0' };
      await migrated.ingestEvents([event]);
      const id = 'repair-example:repair';
      await migrated.updateIssueRepair(id, { cause: 'Null value', summary: 'Add guard', commitSha: 'abcdef1' }, true, Date.now());
      await migrated.ingestEvents([{ ...event, eventId: 'repair-2', timestamp: Date.now() }]);
      expect((await migrated.getIssueDetail(id)).issue?.status).toBe('repairing');
      await migrated.markIssueFixed(id, '1.0.1');
      await migrated.updateIssueRepair(id, { deployment: 'Test 1.0.1', verification: 'Smoke passed' }, false, Date.now());
      const restarted = await createPostgresStore({ pool });
      expect((await restarted.getIssueDetail(id)).issue).toMatchObject({ status: 'fixed_pending_release', repair: { cause: 'Null value', summary: 'Add guard', deployment: 'Test 1.0.1', commitSha: 'abcdef1' } });
      await restarted.markIssueVerified(id, '1.0.1');
      await restarted.ingestEvents([{ ...event, eventId: 'repair-3', timestamp: Date.now(), release: '1.0.0' }]);
      expect((await restarted.getIssueDetail(id)).issue?.status).toBe('resolved');
      await restarted.ingestEvents([{ ...event, eventId: 'repair-4', timestamp: Date.now(), release: '1.0.1' }]);
      expect((await restarted.getIssueDetail(id)).issue?.status).toBe('open');
      await restarted.markIssueFixed(id, '1.0.2');
      expect((await restarted.getIssueDetail(id)).issue?.verifiedInRelease).toBeNull();
      await restarted.updateIssueRepair(id, {}, true, Date.now());
      expect((await store.getIssueDetail(id)).issue).toMatchObject({ status: 'repairing', fixedInRelease: null, verifiedInRelease: null });
    } finally { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  }, 30000);
});
