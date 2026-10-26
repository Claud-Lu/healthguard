import { afterEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomBytes } from 'node:crypto';
import { createMemoryStore, createPostgresStore } from './index';
import { createServerApp } from '../app';
import { createNotificationWorker, encryptSecret } from '../notifications/service';
import type { ErrorEvent } from '@health-guard/core';
import type { NotificationJob } from '../notifications/types';

const occurred = Date.parse('2026-09-30T10:31:56Z');
const received = Date.parse('2026-10-26T02:31:49Z');
const event: ErrorEvent = { eventId: 'delayed-event', appKey: 'demo', type: 'error', timestamp: occurred, platform: 'flutter', sessionId: 's', anonymousId: 'a', sdkVersion: 'test', breadcrumbs: [], errorType: 'js', message: 'Old offline failure', fingerprint: 'js:delayed', release: '1.0.50' };
afterEach(() => { vi.restoreAllMocks(); });

for (const mode of ['memory', 'postgres']) describe(mode + ' server receipt and mail timeline', () => {
  async function fixture() {
    const db = mode === 'postgres' ? new PGlite() : null;
    const query = async (sql: string, params: unknown[] = []) => {
      if (!params.length) { const a = await db!.exec(sql); const r = a[a.length - 1]; return { rows: r?.rows ?? [], rowCount: r?.affectedRows ?? 0 }; }
      const r = await db!.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows };
    };
    const pool = { query, connect: async () => ({ query, release() {} }) };
    const makeStore = () => db ? createPostgresStore({ pool: pool as never }) : Promise.resolve(createMemoryStore());
    const store = await makeStore();
    await store.createUser({ id: 'u1', email: 'owner@example.com', passwordHash: '', createdAt: 1 });
    await store.createApp({ id: 'p1', appKey: 'demo', name: 'Example project', type: 'flutter', ownerUserId: 'u1', createdAt: 1 });
    return { db, store, makeStore, close: () => db?.close() };
  }

  it('records server time, ignores client-supplied receipt values and preserves first acceptance on replay', async () => {
    const f = await fixture();
    try {
      vi.spyOn(Date, 'now').mockReturnValue(received);
      const input = { ...event, receivedAt: 123 };
      await f.store.ingestEvents([input]);
      const first = (await f.store.getIssueDetail('demo:js:delayed')).events[0];
      expect(first).toMatchObject({ timestamp: occurred, receivedAt: received, release: '1.0.50' });
      expect(input.receivedAt).toBe(123);
      vi.spyOn(Date, 'now').mockReturnValue(received + 60_000);
      const store = f.db ? await f.makeStore() : f.store;
      await store.ingestEvents([input]);
      const detail = await store.getIssueDetail('demo:js:delayed');
      expect(detail.events).toHaveLength(1);
      expect(detail.events[0]).toMatchObject({ receivedAt: received, timestamp: occurred });
      expect(detail.issue?.eventCount).toBe(1);
    } finally { await f.close(); }
  }, 30000);

  it('captures receipt time at the API boundary and cannot replace it with a forged field', async () => {
    const f = await fixture();
    const app = createServerApp(f.store, { notificationWorker: false });
    try {
      vi.spyOn(Date, 'now').mockReturnValue(received);
      const original = f.store.ingestEvents.bind(f.store);
      vi.spyOn(f.store, 'ingestEvents').mockImplementation(async (...args) => {
        vi.spyOn(Date, 'now').mockReturnValue(received + 5000);
        await original(...args);
      });
      const response = await app.inject({ method: 'POST', url: '/api/events/batch', payload: { appKey: 'demo', events: [{ ...event, receivedAt: 123 }] } });
      expect(response.statusCode).toBe(202);
      expect((await f.store.getIssueDetail('demo:js:delayed')).events[0]).toMatchObject({ receivedAt: received, timestamp: occurred });
    } finally { await app.close(); await f.close(); }
  }, 30000);

  it('keeps occurrence, receipt, queue, send-start and SMTP-acceptance times distinct', async () => {
    const f = await fixture();
    try {
      const key = randomBytes(32);
      await f.store.notifications.saveSender('u1', { host: 'smtp.example.com', port: 465, secure: true, username: 'sender@example.com', fromEmail: 'sender@example.com', fromName: 'Example', passwordEncrypted: encryptSecret('placeholder', key, 'u1') });
      await f.store.notifications.saveRule('demo', { enabled: true, recipients: ['recipient@example.com'], onNewIssue: true, onRegression: true, threshold: 0, cooldownMinutes: 1 });
      vi.spyOn(Date, 'now').mockReturnValue(received);
      await f.store.ingestEvents([event]);
      const [queued] = await f.store.notifications.listJobs('u1', 'demo');
      expect(queued).toMatchObject({ eventTimestamp: occurred, receivedAt: received, createdAt: received });
      expect(queued.text).toContain('客户端发生时间 / Client event time (UTC): 2026-09-30T10:31:56.000Z');
      expect(queued.text).toContain('服务器接收时间 / Server received (UTC): 2026-10-26T02:31:49.000Z');
      expect(queued.text).toContain('邮件生成时间 / Notification created (UTC): 2026-10-26T02:31:49.000Z');
      expect(queued.text).toContain('设备时钟偏差');
      vi.spyOn(Date, 'now').mockReturnValue(received + 10_000);
      let transmitted: NotificationJob | undefined;
      const worker = createNotificationWorker(f.store, key, async (_sender, _password, job) => {
        transmitted = job;
        vi.spyOn(Date, 'now').mockReturnValue(received + 12_000);
      });
      await worker.run();
      expect(transmitted).toMatchObject({ sendingStartedAt: received + 10_000 });
      expect(transmitted?.text).toContain('开始发送时间 / Send started (UTC): 2026-10-26T02:31:59.000Z');
      const store = f.db ? await f.makeStore() : f.store;
      const [sent] = await store.notifications.listJobs('u1', 'demo');
      expect(sent).toMatchObject({ eventTimestamp: occurred, receivedAt: received, createdAt: received, sendingStartedAt: received + 10_000, sentAt: received + 12_000, status: 'sent' });
    } finally { await f.close(); }
  }, 30000);

  it('never marks failed or interrupted delivery as accepted by SMTP', async () => {
    const f = await fixture();
    try {
      const job = { id: 'legacy', ownerUserId: 'u1', appKey: 'demo', issueId: null, reason: 'test', subject: 'Legacy test', text: 'Legacy body', recipients: [], status: 'pending', error: null, createdAt: received, updatedAt: received } as NotificationJob;
      await f.store.notifications.enqueue(job, 0);
      await f.store.notifications.claimJob(received + 1000);
      await f.store.notifications.claimJob(received + 302_000);
      const [unknown] = await f.store.notifications.listJobs('u1', 'demo');
      expect(unknown).toMatchObject({ status: 'failed', error: 'DELIVERY_UNKNOWN', sendingStartedAt: received + 1000, sentAt: null });
      await f.store.notifications.finishJob(job.id, 'canceled', 'NOTIFICATIONS_DISABLED', received + 303_000);
      expect((await f.store.notifications.listJobs('u1', 'demo'))[0]).toMatchObject({ sentAt: null });
    } finally { await f.close(); }
  }, 30000);

  if (mode === 'postgres') it('adds a nullable receipt column without inventing receipt times for historical rows', async () => {
    const f = await fixture();
    try {
      await f.store.ingestEvents([event]);
      await f.db!.query('ALTER TABLE events DROP COLUMN received_at');
      await f.db!.query("UPDATE events SET payload = payload || '{\"receivedAt\":123}'::jsonb");
      const migrated = await f.makeStore();
      const detail = await migrated.getIssueDetail('demo:js:delayed');
      expect(detail.events[0]).toMatchObject({ timestamp: occurred, receivedAt: null });
    } finally { await f.close(); }
  }, 30000);
});
