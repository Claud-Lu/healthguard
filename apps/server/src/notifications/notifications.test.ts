import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServerApp } from '../app';
import { createMemoryStore } from '../store';
import { createNotificationWorker, decryptSecret, encryptSecret } from './service';
import type { ErrorEvent, HttpEvent } from '@health-guard/core';

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

  it.each([
    'http://127.0.0.1:5173/#/trip',
    'http://localhost:5173/#/trip',
    'http://app.localhost:8080/',
    'http://LOCALHOST.:5173/',
    'http://127.1:5173/',
    'http://[::1]:5173/',
    'http://[::ffff:127.0.0.1]:5173/',
    'http://0.0.0.0:5173/',
    '//localhost:5173/trip'
  ])('retains local H5 failures from %s without queueing email or consuming the cooldown', async pageUrl => {
    const { request, root, store } = await fixture();
    await request('PUT', '/api/notifications/sender', sender);
    await request('PUT', root, { ...defaultRule, threshold: 0 });
    const local: HttpEvent = { ...event('local'), type: 'http', platform: 'uniapp-h5', environment: 'test', method: 'GET', url: 'https://api.example.com/trips', pageUrl, duration: 4, success: false, errorMessage: 'Failed to fetch' };
    expect((await request('POST', '/api/events/batch', { appKey: 'app-one', events: [local] })).statusCode).toBe(202);
    expect((await store.listIssues({ appKey: 'app-one' }))[0].eventCount).toBe(1);
    expect(await store.notifications.listJobs('u1', 'app-one')).toHaveLength(0);
    await store.ingestEvents([{ ...local, eventId: 'deployed', pageUrl: 'https://test.example.com/trip' }]);
    const jobs = await store.notifications.listJobs('u1', 'app-one');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].reason).toBe('new_issue');
    expect(jobs[0].text).toContain('Event ID: deployed');
    const send = vi.fn().mockResolvedValue(undefined);
    await createNotificationWorker(store, key, send).run();
    expect(send).toHaveBeenCalledOnce();
  });

  it('keeps development environment errors out of all automatic alerts', async () => {
    const { request, root, store } = await fixture();
    await request('PUT', '/api/notifications/sender', sender);
    await request('PUT', root, { ...defaultRule, threshold: 1 });
    const local: ErrorEvent = { ...event('local'), platform: 'uniapp-app', environment: 'development' };
    expect((await request('POST', '/api/events/batch', { appKey: 'app-one', events: [local] })).statusCode).toBe(202);
    await store.markIssueFixed('app-one:js:boom', 'v2.0.0');
    await store.markIssueVerified('app-one:js:boom', 'v2.0.0');
    await store.ingestEvents([{ ...local, eventId: 'local-regression', release: 'v2.0.0' }]);
    expect((await store.listIssues({ appKey: 'app-one' }))[0].eventCount).toBe(2);
    const send = vi.fn().mockResolvedValue(undefined);
    await createNotificationWorker(store, key, send).run();
    expect(send).not.toHaveBeenCalled();
    expect(await store.notifications.listJobs('u1', 'app-one')).toHaveLength(0);
  });

  it('preserves a local regression for the next deployed event when thresholds are disabled', async () => {
    const { request, root, store } = await fixture();
    await request('PUT', '/api/notifications/sender', sender);
    await request('PUT', root, { ...defaultRule, threshold: 0 });
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    await store.ingestEvents([event('first')]);
    await store.markIssueFixed('app-one:js:boom', 'v2.0.0');
    await store.markIssueVerified('app-one:js:boom', 'v2.0.0');
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_061_000);
    await store.ingestEvents([{ ...event('local-regression', 'js:boom', 'v2.0.0'), pageUrl: 'http://localhost:5173/' }]);
    expect(await store.notifications.listJobs('u1', 'app-one')).toHaveLength(1);
    await store.ingestEvents([event('old-release'), { ...event('unknown-release'), release: undefined }]);
    expect(await store.notifications.listJobs('u1', 'app-one')).toHaveLength(1);
    await store.ingestEvents([event('deployed-regression', 'js:boom', 'v2.0.0')]);
    expect((await store.notifications.listJobs('u1', 'app-one'))[0]).toMatchObject({ reason: 'regression' });
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_122_000);
    await store.ingestEvents([event('again', 'js:boom', 'v2.0.0')]);
    expect(await store.notifications.listJobs('u1', 'app-one')).toHaveLength(2);
  });

  it('discards deferred local triggers when their notification rule is disabled', async () => {
    const { request, root, store } = await fixture();
    await request('PUT', '/api/notifications/sender', sender);
    await request('PUT', root, { ...defaultRule, threshold: 0 });
    await store.ingestEvents([{ ...event('local'), pageUrl: 'http://localhost:5173/' }]);
    await request('PUT', root, { ...defaultRule, enabled: false, threshold: 0 });
    await request('PUT', root, { ...defaultRule, threshold: 0 });
    await store.ingestEvents([event('deployed')]);
    expect(await store.notifications.listJobs('u1', 'app-one')).toHaveLength(0);
  });

  it('uses legacy page context to identify local browser errors', async () => {
    const { request, root, store } = await fixture();
    await request('PUT', '/api/notifications/sender', sender); await request('PUT', root, defaultRule);
    await store.ingestEvents([
      { ...event('page', 'page'), page: 'http://localhost:5173/' },
      { ...event('context', 'context'), context: { pageUrl: 'http://127.0.0.1:5173/' } }
    ]);
    expect(await store.notifications.listJobs('u1', 'app-one')).toHaveLength(0);
  });

  it.each([
    { environment: 'test' as const, pageUrl: 'https://test.example.com/' },
    { environment: 'test' as const, pageUrl: 'http://192.168.10.21:5173/' },
    { environment: 'production' as const, pageUrl: 'http://10.0.0.2/' },
    { pageUrl: 'https://localhost.example.com/' },
    { pageUrl: 'https://127.0.0.1.example.com/' },
    { pageUrl: 'https://example.com/?next=http://localhost:5173' },
    { pageUrl: 'not a URL' },
    { platform: 'uniapp-app' as const, pageUrl: 'http://localhost/' },
    { platform: 'uniapp-app' as const, page: '/pages/trip/current' },
    {}
  ])('preserves deployed and ambiguous errors: %j', async context => {
    const { request, root, store } = await fixture();
    await request('PUT', '/api/notifications/sender', sender); await request('PUT', root, defaultRule);
    await store.ingestEvents([{ ...event('deployed'), ...context }]);
    expect(await store.notifications.listJobs('u1', 'app-one')).toHaveLength(1);
  });

  it('still alerts when a deployed browser incorrectly requests a loopback API', async () => {
    const { request, root, store } = await fixture();
    await request('PUT', '/api/notifications/sender', sender); await request('PUT', root, defaultRule);
    const http: HttpEvent = { ...event('misconfigured'), type: 'http', method: 'GET', url: 'http://127.0.0.1:5173/', pageUrl: 'https://test.example.com/', duration: 4, success: false };
    await store.ingestEvents([http]);
    expect(await store.notifications.listJobs('u1', 'app-one')).toHaveLength(1);
  });

  it('snapshots the triggering HTTP request and H5 page, including the host and hash route', async () => {
    const { request, root, store } = await fixture();
    await request('PUT', '/api/notifications/sender', sender);
    await request('PUT', root, { ...defaultRule, onNewIssue: false, threshold: 2 });
    const first: HttpEvent = { ...event('first'), type: 'http', method: 'POST', url: 'https://old.example.com/api/orders', status: 503, duration: 120, success: false, pageUrl: 'https://shop.example.com/old', release: 'newer-release', timestamp: Date.now() + 10_000 };
    // Same fingerprint on a different host/page. The triggering event can arrive out of order.
    const trigger: HttpEvent = { ...first, eventId: 'trigger', timestamp: Date.now(), release: 'trigger-release', environment: 'test', url: 'https://api.example.com/api/orders?token=request-secret&order=42', pageUrl: 'https://shop.example.com/app?lang=zh#/orders/detail?id=42&token=page-secret', errorMessage: 'Unavailable' };
    await store.ingestEvents([first, trigger]);
    const [job] = await store.notifications.listJobs('u1', 'app-one');
    expect(job.reason).toBe('threshold');
    expect(job.text).toContain('请求地址 / Request URL: https://api.example.com/api/orders?token=%5BFiltered%5D&order=42');
    expect(job.text).toContain('页面完整地址 / Page URL: https://shop.example.com/app?lang=zh#/orders/detail?id=42&token=%5BFiltered%5D');
    expect(job.text).toContain('本次版本 / Event release: trigger-release');
    expect(job.text).toContain(`本次发生 / Event time (UTC): ${new Date(trigger.timestamp).toISOString()}`);
    expect(job.text).toContain('状态码 / Status: 503');
    expect(job.text).toContain('请求耗时 / Duration: 120 ms');
    expect(job.text).toContain('环境 / Environment: test');
    expect(job.text).toContain('Event ID: trigger');
    for (const value of ['request-secret', 'page-secret', 'old.example.com', '/old', 'newer-release']) expect(job.text).not.toContain(value);
  });

  it('includes native routes for HTTP and error alerts, and handles older events without page data', async () => {
    const { request, root, store } = await fixture();
    await request('PUT', '/api/notifications/sender', sender); await request('PUT', root, defaultRule);
    await store.ingestEvents([
      { ...event('native-error', 'native'), platform: 'uniapp-app', page: '/pages/trip/current' },
      { ...event('native-http'), type: 'http', platform: 'uniapp-app', method: 'POST', url: 'https://api.example.com/position', duration: 50, success: false, pageUrl: '/pages/home/index' },
      { ...event('old', 'old'), platform: 'uniapp-app' }
    ]);
    const jobs = await store.notifications.listJobs('u1', 'app-one');
    expect(jobs.find(job => job.text.includes('Event ID: native-error'))?.text).toContain('App 页面路由 / App route: /pages/trip/current');
    expect(jobs.find(job => job.text.includes('Event ID: native-http'))?.text).toContain('App 页面路由 / App route: /pages/home/index');
    expect(jobs.find(job => job.text.includes('Event ID: old'))?.text).toContain('App 页面路由 / App route: 未上报 / Not reported');
  });

  it('resolves relative browser requests against the page and never invents a native request host', async () => {
    const { request, root, store } = await fixture();
    await request('PUT', '/api/notifications/sender', sender); await request('PUT', root, defaultRule);
    const http: HttpEvent = { ...event('h5'), type: 'http', method: 'GET', url: '../api/orders', duration: 1, success: false, pageUrl: 'https://shop.example.com/app/index.html#/home' };
    await store.ingestEvents([http, { ...http, eventId: 'app', platform: 'uniapp-app', url: '/api/profile', pageUrl: '/pages/profile/index' }]);
    const jobs = await store.notifications.listJobs('u1', 'app-one');
    expect(jobs.find(job => job.text.includes('Event ID: h5'))?.text).toContain('请求地址 / Request URL: https://shop.example.com/api/orders');
    const native = jobs.find(job => job.text.includes('Event ID: app'))!.text;
    expect(native).toContain('请求地址 / Request URL: /api/profile');
    expect(native).toContain('完整请求地址未上报');
    expect(native).not.toContain('healthguard.invalid');
  });
});
