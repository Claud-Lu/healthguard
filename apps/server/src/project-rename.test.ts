import { afterEach, describe, expect, it } from 'vitest';
import { createServerApp } from './app';
import { createMemoryStore } from './store';

const servers: ReturnType<typeof createServerApp>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
async function fixture() {
  const store = createMemoryStore();
  const app = createServerApp(store);
  servers.push(app);
  const owner = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'owner@example.com', password: 'test-password' } });
  const other = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'other@example.com', password: 'test-password' } });
  const headers = { authorization: `Bearer ${owner.json().token}` };
  const created = await app.inject({ method: 'POST', url: '/api/apps', headers, payload: { name: 'generated_project', type: 'flutter' } });
  const project = created.json().app;
  return { app, store, headers, project, otherHeaders: { authorization: `Bearer ${other.json().token}` } };
}

describe('project rename API', () => {
  it('updates only the display name, retains history and accepts events with the original key', async () => {
    const { app, store, headers, project } = await fixture();
    const event = { eventId: 'rename-before', appKey: project.appKey, timestamp: Date.now(), type: 'error' as const, platform: 'web' as const, errorType: 'js', message: 'Example error', fingerprint: 'example', sessionId: 's', anonymousId: 'a', sdkVersion: 'test', breadcrumbs: [] };
    await store.ingestEvents([event]);
    await store.notifications.saveRule(project.appKey, { enabled: false, recipients: ['team@example.com'], onNewIssue: true, onRegression: true, threshold: 10, cooldownMinutes: 30 });
    const result = await app.inject({ method: 'PATCH', url: `/api/apps/${project.appKey}`, headers, payload: { name: '  示例司机端  ' } });
    expect(result.statusCode).toBe(200);
    expect(result.json().app).toEqual({ ...project, name: '示例司机端' });
    expect(result.json().app.ownerUserId).toBeUndefined();
    const list = await app.inject({ method: 'GET', url: '/api/apps', headers });
    expect(list.json().apps).toEqual([{ ...project, name: '示例司机端' }]);
    await store.ingestEvents([{ ...event, eventId: 'rename-after' }]);
    expect((await store.getOverview({ appKey: project.appKey })).events).toBe(2);
    expect((await store.listIssues({ appKey: project.appKey }))[0].eventCount).toBe(2);
    expect((await store.notifications.getRule(project.appKey)).recipients).toEqual(['team@example.com']);
  });

  it('requires login and project ownership, and hides other users projects', async () => {
    const { app, headers, otherHeaders, project } = await fixture();
    const rename = (auth: Record<string, string>, key = project.appKey) => app.inject({ method: 'PATCH', url: `/api/apps/${key}`, headers: auth, payload: { name: 'New name' } });
    expect((await rename({})).statusCode).toBe(401);
    expect((await rename(otherHeaders)).statusCode).toBe(404);
    expect((await rename(headers, 'missing-project')).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/apps', headers })).json().apps[0].name).toBe(project.name);
  });

  it.each([{}, { name: '' }, { name: '   ' }, { name: 12 }, { name: null }, { name: 'x'.repeat(101) }, { name: 'Valid', appKey: 'replacement' }])('rejects invalid names or unrelated fields: %j', async payload => {
    const { app, headers, project } = await fixture();
    const response = await app.inject({ method: 'PATCH', url: `/api/apps/${project.appKey}`, headers, payload });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('INVALID_APP_NAME');
  });

  it('allows 100 characters and repeated saves of the same name', async () => {
    const { app, headers, project } = await fixture();
    for (let i = 0; i < 2; i++) {
      const response = await app.inject({ method: 'PATCH', url: `/api/apps/${project.appKey}`, headers, payload: { name: '名'.repeat(100) } });
      expect(response.statusCode).toBe(200);
    }
  });
});
