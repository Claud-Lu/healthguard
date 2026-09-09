import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServerApp } from '../app';
import { createMemoryStore } from '../store';
import { createNotificationWorker, decryptSecret, encryptSecret } from './service';
import type { ErrorEvent } from '@health-guard/core';

const secret = 'test-mailbox-authorization-code';
const key = randomBytes(32);
const sender = { host: 'smtp.example.com', port: 465, secure: true, username: 'alerts@example.com', fromEmail: 'alerts@example.com', fromName: 'HealthGuard', password: secret };
const defaultRule = { enabled: true, recipients: ['team@example.com'], onNewIssue: true, onRegression: true, threshold: 3, cooldownMinutes: 1 };
const apps: ReturnType<typeof createServerApp>[] = [];
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all(apps.splice(0).map(app => app.close())); });

async function fixture() {
  const store = createMemoryStore();
  const app = createServerApp(store, { encryptionKey: key.toString('base64'), notificationWorker: false });
  apps.push(app);
  const user = { id: 'u1', email: 'owner@example.com', passwordHash: '', createdAt: 1 };
  await store.createUser(user); await store.createSession('token', user.id);
  await store.createUser({ ...user, id: 'u2', email: 'other@example.com' }); await store.createSession('other', 'u2');
  await store.createApp({ id: 'p1', appKey: 'app-one', name: 'Example project', type: 'web', ownerUserId: 'u1', createdAt: 1 });
  const request = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: any, token = 'token') => app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const root = '/api/apps/app-one/notifications';
  return { app, store, request, root };
}
function event(id: string, fingerprint = 'js:boom', release = 'v1.0.0'): ErrorEvent {
  return { eventId: id, appKey: 'app-one', type: 'error', timestamp: Date.now(), platform: 'web', sessionId: 's', anonymousId: 'anon', sdkVersion: '0.3.0', breadcrumbs: [], errorType: 'js', message: 'Example error', fingerprint, release };
}

describe('email notification API and delivery', () => {
  it('requires login, isolates settings/history/test per project and hides credentials', async () => {
    const { request, store, root } = await fixture();
    expect((await request('GET', '/api/notifications/sender', undefined, '')).statusCode).toBe(401);
    expect((await request('GET', root, undefined, 'other')).statusCode).toBe(404);
    expect((await request('PUT', root, defaultRule, 'other')).statusCode).toBe(404);
    expect((await request('GET', `${root}/history`, undefined, 'other')).statusCode).toBe(404);
    expect((await request('POST', `${root}/test`, {}, 'other')).statusCode).toBe(404);
    const saved = await request('PUT', '/api/notifications/sender', sender);
    expect(saved.statusCode).toBe(200); expect(saved.body).not.toContain(secret); expect(saved.body).not.toContain('passwordEncrypted');
    const persisted = await store.notifications.getSender('u1');
    expect(JSON.stringify(persisted)).not.toContain(secret);
    expect(decryptSecret(persisted!.passwordEncrypted, key, 'u1')).toBe(secret);
    expect((await request('GET', '/api/notifications/sender', undefined, 'other')).json().sender).toBeNull();
    expect((await request('GET', '/api/notifications/sender')).body).not.toContain(secret);
    expect((await request('PUT', '/api/notifications/sender', { ...sender, password: '', fromName: 'Updated' })).statusCode).toBe(200);
    expect((await store.notifications.getSender('u1'))?.passwordEncrypted).toBe(persisted!.passwordEncrypted);
    expect((await request('PUT', '/api/notifications/sender', { ...sender, host: 'smtp.other.example', password: '' })).statusCode).toBe(400);
    expect((await request('PUT', '/api/notifications/sender', { ...sender, port: 80 })).statusCode).toBe(400);
    expect((await request('PUT', root, { ...defaultRule, recipients: ['bad-email'] })).statusCode).toBe(400);
  });

  it('keeps new installations disabled and does not allow enabling without a sender', async () => {
    const { request, root, store } = await fixture();
    expect((await request('GET', root)).json().rule.enabled).toBe(false);
    expect((await request('PUT', root, defaultRule)).json().code).toBe('SMTP_NOT_CONFIGURED');
    await store.ingestEvents([event('1')]);
    expect(await store.notifications.listJobs('u1', 'app-one')).toHaveLength(0);
    const app = createServerApp(createMemoryStore(), { encryptionKey: 'invalid', notificationWorker: false });
    apps.push(app);
    expect(() => decryptSecret(encryptSecret(secret, key, 'u1'), key, 'u2')).toThrow();
  });

  it('queues tests with alerts disabled, rate limits tests, and records delivery failures without secrets', async () => {
    const { request, root, store } = await fixture();
    await request('PUT', '/api/notifications/sender', sender);
    await request('PUT', root, { ...defaultRule, enabled: false });
    expect((await request('POST', `${root}/test`, {})).statusCode).toBe(202);
    expect((await request('POST', `${root}/test`, {})).statusCode).toBe(429);
    const send = vi.fn().mockRejectedValue(Object.assign(new Error(secret), { code: 'EAUTH' }));
    await createNotificationWorker(store, key, send).run();
    expect(send).toHaveBeenCalledOnce();
    const history = await request('GET', `${root}/history`);
    expect(history.json().jobs[0]).toMatchObject({ status: 'failed', error: 'SMTP_AUTH_FAILED' });
    expect(history.body).not.toContain(secret);
  });

  it('triggers new issues, respects per-issue cooldown, and sends threshold and regression alerts', async () => {
    const { request, root, store } = await fixture();
    await request('PUT', '/api/notifications/sender', sender); await request('PUT', root, defaultRule);
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    await store.ingestEvents([event('1'), event('2'), event('3')]);
    expect(await store.notifications.listJobs('u1', 'app-one')).toHaveLength(1);
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_061_000);
    await store.ingestEvents([event('4')]);
    let jobs = await store.notifications.listJobs('u1', 'app-one');
    expect(jobs.map(j => j.reason)).toEqual(['threshold', 'new_issue']);
    await store.markIssueFixed('app-one:js:boom', 'v2.0.0');
    await store.markIssueVerified('app-one:js:boom', 'v2.0.0');
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_122_000);
    await store.ingestEvents([event('5', 'js:boom', 'v2.0.0')]);
    jobs = await store.notifications.listJobs('u1', 'app-one');
    expect(jobs[0].reason).toBe('regression');
    const send = vi.fn().mockResolvedValue(undefined);
    const worker = createNotificationWorker(store, key, send);
    await Promise.all([worker.run(), worker.run()]);
    expect(send).toHaveBeenCalledOnce();
    expect((await store.notifications.listJobs('u1', 'app-one')).filter(j => j.status === 'sent')).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('ingests events successfully when SMTP fails and cancels queued alerts after disabling', async () => {
    const { request, root, store } = await fixture();
    await request('PUT', '/api/notifications/sender', sender); await request('PUT', root, defaultRule);
    const response = await request('POST', '/api/events/batch', { appKey: 'app-one', events: [event('1')] });
    expect(response.statusCode).toBe(202);
    const send = vi.fn().mockRejectedValue(new Error('unavailable'));
    await createNotificationWorker(store, key, send).run();
    expect((await store.listIssues({ appKey: 'app-one' }))[0].eventCount).toBe(1);
    expect((await store.notifications.listJobs('u1', 'app-one'))[0].status).toBe('failed');
    await store.ingestEvents([event('2', 'js:other')]);
    await request('PUT', root, { ...defaultRule, enabled: false });
    await createNotificationWorker(store, key, send).run();
    expect(send).toHaveBeenCalledOnce();
    expect((await store.notifications.listJobs('u1', 'app-one'))[0].status).toBe('canceled');
  });

  it('supports failed HTTP alerts and does not send mail for performance or successful requests', async () => {
    const { request, root, store } = await fixture();
    await request('PUT', '/api/notifications/sender', sender); await request('PUT', root, defaultRule);
    const base = event('http');
    await store.ingestEvents([{ ...base, type: 'http', method: 'GET', url: 'https://example.com/api', status: 500, duration: 10, success: false }]);
    expect((await store.notifications.listJobs('u1', 'app-one'))[0].reason).toBe('new_issue');
    await request('DELETE', '/api/notifications/sender');
    expect((await store.notifications.getRule('app-one')).enabled).toBe(false);
  });
});
