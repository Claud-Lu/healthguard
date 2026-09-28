import { describe, expect, it } from 'vitest';
import { createMemoryStore } from './store';
import { createServerApp } from './app';

async function fixture() {
  const store = createMemoryStore();
  await store.createUser({ id: 'owner', email: 'owner@example.com', passwordHash: '', createdAt: 1 });
  await store.createUser({ id: 'other', email: 'other@example.com', passwordHash: '', createdAt: 1 });
  await store.createSession('owner-session', 'owner');
  await store.createSession('other-session', 'other');
  await store.createApp({ id: 'project', appKey: 'example-app', name: 'Example', type: 'web', ownerUserId: 'owner', createdAt: 1 });
  const event = { eventId: 'event-one', sessionId: 'session', anonymousId: 'anonymous', sdkVersion: 'test', breadcrumbs: [], appKey: 'example-app', type: 'error' as const, errorType: 'js' as const, platform: 'web' as const, timestamp: 1, message: 'boom', fingerprint: 'js:boom', release: '1.0.0' };
  await store.ingestEvents([event]);
  const app = createServerApp(store);
  const url = '/api/issues/example-app%3Ajs%3Aboom/repair';
  const headers = { authorization: 'Bearer owner-session' };
  return { app, store, event, url, headers };
}

describe('direct repair progress', () => {
  it('persists notes without requiring a PR and keeps repair running during new events', async () => {
    const { app, store, event, url, headers } = await fixture();
    const response = await app.inject({ method: 'PATCH', url, headers, payload: { action: 'start', cause: 'Null result', summary: 'Guard empty result', commitSha: 'abc1234', deployment: '', verification: '' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().issue).toMatchObject({ status: 'repairing', fixPrUrl: null, repair: { cause: 'Null result', summary: 'Guard empty result', commitSha: 'abc1234' } });
    await store.ingestEvents([{ ...event, eventId: 'event-two', timestamp: 2 }]);
    expect((await store.getIssueDetail('example-app:js:boom')).issue?.status).toBe('repairing');
    await store.markIssueFixed('example-app:js:boom', '1.0.1');
    const save = await app.inject({ method: 'PATCH', url, headers, payload: { summary: 'Guard empty result', deployment: 'Test environment 1.0.1', verification: 'Smoke check passed', cause: 'Null result', commitSha: 'abc1234' } });
    expect(save.json().issue.status).toBe('fixed_pending_release');
    expect((await store.getIssueDetail('example-app:js:boom')).issue?.repair?.deployment).toBe('Test environment 1.0.1');
    await store.markIssueVerified('example-app:js:boom', '1.0.1');
    await store.markIssueFixed('example-app:js:boom', '1.0.2');
    expect((await store.getIssueDetail('example-app:js:boom')).issue?.verifiedInRelease).toBeNull();
    await app.close();
  });

  it('rejects anonymous, cross-owner, invalid and empty updates', async () => {
    const { app, url, headers } = await fixture();
    expect((await app.inject({ method: 'PATCH', url, payload: { action: 'start' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PATCH', url, headers: { authorization: 'Bearer other-session' }, payload: { action: 'start' } })).statusCode).toBe(404);
    for (const payload of [{}, { action: 'resolved' }, { summary: 42 }, { cause: 'a'.repeat(4001) }, { commitSha: 'not a commit' }]) {
      expect((await app.inject({ method: 'PATCH', url, headers, payload })).statusCode).toBe(400);
    }
    await app.close();
  });

  it('starts a new repair round without carrying previous verification forward', async () => {
    const { app, store, url, headers } = await fixture();
    await store.markIssueFixed('example-app:js:boom', '1.0.1');
    await store.markIssueVerified('example-app:js:boom', '1.0.1');
    const response = await app.inject({ method: 'PATCH', url, headers, payload: { action: 'start' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().issue).toMatchObject({ status: 'repairing', fixedInRelease: null, verifiedInRelease: null });
    await app.close();
  });
});
