import { it, expect } from 'vitest';
import { createServerApp } from './app';
import { createMemoryStore } from './store';

it('round-trips original request evidence through real collector HTTP without merging phases', async () => {
  const app = createServerApp(createMemoryStore(), { notificationWorker: false });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  async function request(path: string, body?: unknown, token?: string) {
    const response = await fetch(address + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect(response.ok).toBe(true); return response.json();
  }
  try {
    const { token } = await request('/api/auth/register', { email: 'fixture@example.com', password: 'fixture-password' });
    const { app: project } = await request('/api/apps', { name: 'Fixture', type: 'flutter' }, token);
    const events = ['connectionTimeout', 'receiveTimeout'].map((dioType, index) => ({ eventId: `fixture-${index}`, appKey: project.appKey, platform: 'flutter', type: 'http', timestamp: index + 1, sessionId: 'fixture', anonymousId: 'fixture', release: '1.2.3', sdkVersion: '0.2.1-flutter', environment: 'test', method: 'GET', url: 'https://api.example.com/calls', duration: 10000, success: false, context: { originalError: { dioType }, requestTrace: { source: 'original_request', requestId: `request-${index}`, connectionAcquisition: { outcome: index ? 'ready' : 'connectionTimeout', durationMs: 10000 }, dns: { availability: 'unavailable' } } } }));
    expect(await request('/api/events/batch', { appKey: project.appKey, events })).toMatchObject({ accepted: 2 });
    const { issues } = await request('/api/issues?appKey=' + project.appKey, undefined, token);
    expect(issues).toHaveLength(2);
    const detail = await request('/api/issues/' + encodeURIComponent(issues[0].id), undefined, token);
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0].context.requestTrace).toMatchObject({ source: 'original_request', dns: { availability: 'unavailable' } });
    expect(issues.map((v: { message: string }) => v.message).join(' ')).toContain('connection_timeout');
    expect(issues.map((v: { message: string }) => v.message).join(' ')).toContain('response_timeout');
  } finally { await app.close(); }
});
