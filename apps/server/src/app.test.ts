import { describe, expect, it } from 'vitest';
import { createServerApp } from './app';
import { createMemoryStore } from './store';

describe('collector api', () => {
  it('registers a local user, returns a session token, and exposes the profile', async () => {
    const app = createServerApp(createMemoryStore());

    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'owner@example.com', password: 'secret123' }
    });
    const token = register.json().token;
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(register.statusCode).toBe(201);
    expect(token).toMatch(/^session_/);
    expect(register.json().user).toMatchObject({
      email: 'owner@example.com'
    });
    expect(register.json().user.passwordHash).toBeUndefined();
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({
      email: 'owner@example.com'
    });

    await app.close();
  });

  it('requires login for app management and isolates app lists by user', async () => {
    const app = createServerApp(createMemoryStore());
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'first@example.com', password: 'secret123' }
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'second@example.com', password: 'secret123' }
    });

    const unauthorized = await app.inject({
      method: 'GET',
      url: '/api/apps'
    });
    const create = await app.inject({
      method: 'POST',
      url: '/api/apps',
      headers: { authorization: `Bearer ${first.json().token}` },
      payload: { name: 'Admin Console', type: 'web' }
    });
    const firstList = await app.inject({
      method: 'GET',
      url: '/api/apps',
      headers: { authorization: `Bearer ${first.json().token}` }
    });
    const secondList = await app.inject({
      method: 'GET',
      url: '/api/apps',
      headers: { authorization: `Bearer ${second.json().token}` }
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(create.statusCode).toBe(201);
    expect(create.json().app).toMatchObject({
      name: 'Admin Console',
      type: 'web'
    });
    expect(create.json().app.appKey).toMatch(/^web_/);
    expect(firstList.json().apps).toHaveLength(1);
    expect(firstList.json().apps[0]).toMatchObject({
      name: 'Admin Console',
      type: 'web'
    });
    expect(secondList.json().apps).toHaveLength(0);

    await app.close();
  });

  it('logs in with a registered account and rejects duplicate registrations', async () => {
    const app = createServerApp(createMemoryStore());

    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'owner@example.com', password: 'secret123' }
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'owner@example.com', password: 'secret123' }
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'owner@example.com', password: 'secret123' }
    });
    const badLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'owner@example.com', password: 'wrong-pass' }
    });

    expect(duplicate.statusCode).toBe(409);
    expect(login.statusCode).toBe(200);
    expect(login.json().token).toMatch(/^session_/);
    expect(badLogin.statusCode).toBe(401);

    await app.close();
  });

  it('returns stable auth error codes for friendly dashboard messages', async () => {
    const app = createServerApp(createMemoryStore());

    const invalidEmail = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'not-an-email', password: 'secret123' }
    });
    const shortPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'owner@example.com', password: '1234567' }
    });

    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'owner@example.com', password: 'secret123' }
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'owner@example.com', password: 'secret123' }
    });
    const badLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'owner@example.com', password: 'wrong-pass' }
    });

    expect(invalidEmail.statusCode).toBe(400);
    expect(invalidEmail.json()).toMatchObject({
      code: 'INVALID_EMAIL',
      message: 'Please enter a valid email address.'
    });
    expect(shortPassword.statusCode).toBe(400);
    expect(shortPassword.json()).toMatchObject({
      code: 'PASSWORD_TOO_SHORT',
      message: 'Password must be at least 8 characters.'
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(badLogin.statusCode).toBe(401);
    expect(badLogin.json().code).toBe('INVALID_CREDENTIALS');

    await app.close();
  });

  it('creates apps and lists app keys for SDK integration', async () => {
    const app = createServerApp(createMemoryStore());
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'demo@example.com', password: 'secret123' }
    });
    const headers = { authorization: `Bearer ${register.json().token}` };

    const create = await app.inject({
      method: 'POST',
      url: '/api/apps',
      headers,
      payload: { name: 'Demo Web', type: 'web' }
    });
    const list = await app.inject({
      method: 'GET',
      url: '/api/apps',
      headers
    });

    expect(create.statusCode).toBe(201);
    expect(create.json().app).toMatchObject({
      name: 'Demo Web',
      type: 'web'
    });
    expect(create.json().app.appKey).toMatch(/^web_/);
    expect(list.json().apps).toMatchObject([
      {
        name: 'Demo Web',
        type: 'web',
        appKey: create.json().app.appKey
      }
    ]);

    await app.close();
  });

  it('stores a batch and aggregates repeated errors into one issue', async () => {
    const app = createServerApp(createMemoryStore());

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
    const app = createServerApp(createMemoryStore());

    const response = await app.inject({
      method: 'POST',
      url: '/api/events/batch',
      payload: { appKey: 'demo-app', events: [] }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('Invalid event batch');

    await app.close();
  });

  it('returns overview metrics and issue detail with recent events', async () => {
    const app = createServerApp(createMemoryStore());
    const payload = {
      appKey: 'demo-app',
      events: [
        {
          eventId: 'evt_error',
          appKey: 'demo-app',
          platform: 'web',
          type: 'error',
          timestamp: 1710000000000,
          sessionId: 'session-1',
          anonymousId: 'anon-1',
          sdkVersion: '0.1.0',
          errorType: 'js',
          message: 'boom',
          stack: 'Error: boom',
          fingerprint: 'js:boom',
          breadcrumbs: [{ type: 'manual', message: 'clicked save', timestamp: 1709999999990 }]
        },
        {
          eventId: 'evt_http',
          appKey: 'demo-app',
          platform: 'web',
          type: 'http',
          timestamp: 1710000001000,
          sessionId: 'session-1',
          anonymousId: 'anon-1',
          sdkVersion: '0.1.0',
          method: 'GET',
          url: 'https://api.example.com/fail',
          status: 500,
          duration: 120,
          success: false
        }
      ]
    };

    await app.inject({ method: 'POST', url: '/api/events/batch', payload });
    const overview = await app.inject({ method: 'GET', url: '/api/overview?appKey=demo-app' });
    const detail = await app.inject({ method: 'GET', url: '/api/issues/demo-app%3Ajs%3Aboom' });

    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      totals: {
        events: 2,
        errors: 1,
        failedRequests: 1,
        affectedUsers: 1,
        issues: 1
      }
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().issue).toMatchObject({
      id: 'demo-app:js:boom',
      message: 'boom'
    });
    expect(detail.json().events).toHaveLength(1);
    expect(detail.json().events[0]).toMatchObject({
      eventId: 'evt_error',
      stack: 'Error: boom'
    });

    await app.close();
  });

  it('aggregates platform distribution and filters issues/events by platform', async () => {
    const app = createServerApp(createMemoryStore());

    const payload = {
      appKey: 'demo-app',
      events: [
        {
          eventId: 'evt_1',
          appKey: 'demo-app',
          platform: 'uniapp-h5',
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
          platform: 'uniapp-wechat',
          type: 'error',
          timestamp: 1710000000100,
          sessionId: 'session-2',
          anonymousId: 'anon-2',
          sdkVersion: '0.1.0',
          errorType: 'js',
          message: 'boom',
          fingerprint: 'js:boom',
          breadcrumbs: []
        },
        {
          eventId: 'evt_3',
          appKey: 'demo-app',
          platform: 'uniapp-wechat',
          type: 'error',
          timestamp: 1710000000200,
          sessionId: 'session-3',
          anonymousId: 'anon-3',
          sdkVersion: '0.1.0',
          errorType: 'js',
          message: 'boom',
          fingerprint: 'js:boom',
          breadcrumbs: []
        }
      ]
    };

    await app.inject({ method: 'POST', url: '/api/events/batch', payload });

    const issuesAll = await app.inject({ method: 'GET', url: '/api/issues?appKey=demo-app' });
    const issuesH5 = await app.inject({ method: 'GET', url: '/api/issues?appKey=demo-app&platform=uniapp-h5' });
    const issuesWechat = await app.inject({ method: 'GET', url: '/api/issues?appKey=demo-app&platform=uniapp-wechat' });
    const issuesUnknown = await app.inject({ method: 'GET', url: '/api/issues?appKey=demo-app&platform=unknown' });

    expect(issuesAll.json().issues).toHaveLength(1);
    expect(issuesAll.json().issues[0]).toMatchObject({
      eventCount: 3,
      platformDistribution: { 'uniapp-h5': 1, 'uniapp-wechat': 2 }
    });

    expect(issuesH5.json().issues).toHaveLength(1);
    expect(issuesWechat.json().issues).toHaveLength(1);
    expect(issuesUnknown.json().issues).toHaveLength(0);

    const overviewH5 = await app.inject({ method: 'GET', url: '/api/overview?appKey=demo-app&platform=uniapp-h5' });
    expect(overviewH5.json().totals).toMatchObject({ events: 1, errors: 1, issues: 1 });

    const overviewWechat = await app.inject({ method: 'GET', url: '/api/overview?appKey=demo-app&platform=uniapp-wechat' });
    expect(overviewWechat.json().totals).toMatchObject({ events: 2, errors: 2, issues: 1 });

    const detailH5 = await app.inject({ method: 'GET', url: '/api/issues/demo-app%3Ajs%3Aboom?platform=uniapp-h5' });
    expect(detailH5.json().events).toHaveLength(1);
    expect(detailH5.json().events[0].platform).toBe('uniapp-h5');

    const detailWechat = await app.inject({ method: 'GET', url: '/api/issues/demo-app%3Ajs%3Aboom?platform=uniapp-wechat' });
    expect(detailWechat.json().events).toHaveLength(2);

    await app.close();
  });
});
