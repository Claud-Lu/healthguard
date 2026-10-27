import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createMemoryStore, createPostgresStore } from './index';
import { createServerApp } from '../app';
import { summarizeDevices } from './devices';
import { deviceContextLines, deviceShortCode, type ErrorEvent, type HealthGuardEvent } from '@health-guard/core';
import { issueAlertContent } from '../notifications/content';
const base: ErrorEvent = { eventId: 'a-old', appKey: 'demo', type: 'error', timestamp: 100, platform: 'flutter', sessionId: 'session', anonymousId: 'install-one', sdkVersion: '0.3.0-flutter', errorType: 'native', message: 'Failure', fingerprint: 'native:test', breadcrumbs: [], deviceInfo: { model: 'Same tablet', system: 'Android 12' }, release: '1.0.1' };
const identity = { deviceId: `hgd1_${'a'.repeat(64)}`, deviceIdStatus: 'available' as const, deviceIdSource: 'android_id' as const, deviceIdScope: 'android_user_signing_key_app' as const };
const appRecord = { id: 'p', appKey: 'demo', name: 'Test project', type: 'flutter' as const, ownerUserId: 'owner', createdAt: 1 };
for (const mode of ['memory', 'postgres']) describe(`${mode} device aggregation and API`, () => {
  async function fixture() {
    const db = mode === 'postgres' ? new PGlite() : null;
    const query = async (sql: string, params: unknown[] = []) => {
      if (!params.length) { const a = await db!.exec(sql); const r = a[a.length - 1]; return { rows: r?.rows ?? [], rowCount: r?.affectedRows ?? 0 }; }
      const r = await db!.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows };
    };
    const pool = { query, connect: async () => ({ query, release() {} }) };
    const make = () => db ? createPostgresStore({ pool: pool as never }) : Promise.resolve(createMemoryStore());
    const store = await make();
    for (const id of ['owner', 'other']) { await store.createUser({ id, email: `${id}@example.com`, passwordHash: '', createdAt: 1 }); await store.createSession(id, id); }
    await store.createApp(appRecord);
    return { store, make, db };
  }
  it('merges cross-version/reinstalled devices, separates identical models, preserves replay, latest report and unknown history', async () => {
    const f = await fixture();
    try {
      await f.store.ingestEvents([{ ...base, ...identity }], 1000);
      await f.store.ingestEvents([{ ...base, ...identity, eventId: 'a-new', timestamp: 200, anonymousId: 'reinstalled', sessionId: 'new-session', release: '1.0.2' }], 2000);
      await f.store.ingestEvents([{ ...base, ...identity, eventId: 'a-old', release: 'forged-replay' }], 3000);
      await f.store.ingestEvents([{ ...base, ...identity, deviceId: `hgd1_${'b'.repeat(64)}`, eventId: 'b', timestamp: 300 },
        { ...base, eventId: 'legacy', anonymousId: 'legacy-install' },
        { ...base, eventId: 'missing-1', anonymousId: 'unknown' }, { ...base, eventId: 'missing-2', anonymousId: 'unknown' },
        { ...base, eventId: 'unsupported', anonymousId: 'unsupported-install', deviceIdStatus: 'unavailable', deviceIdReason: 'timeout' },
        { ...base, ...identity, appKey: 'foreign', eventId: 'foreign' }], 4000);
      const store = f.db ? await f.make() : f.store;
      const result = await store.listDevices({ appKey: 'demo' });
      expect(result.totals).toEqual({ stableDevices: 2, installations: 2, unidentifiedEvents: 2 });
      expect(result.total).toBe(6);
      const device = result.devices.find(d => d.deviceId === identity.deviceId)!;
      expect(device).toMatchObject({ anomalyCount: 2, firstSeenAt: 100, lastSeenAt: 200, latestRelease: '1.0.2', shortCode: 'HG-AAAAAAAAAAAA', lastReportedAt: 2000 });
      expect((await store.listDevices({ appKey: 'demo', kind: 'stable', search: 'HG-AAAAAAAAAAAA' })).total).toBe(1);
      const history = await store.listDeviceEvents({ appKey: 'demo', key: device.key });
      expect(history.events.map(e => e.release)).toEqual(['1.0.2', '1.0.1']);
      expect(history.total).toBe(2);
      expect((await store.listDevices({ appKey: 'demo', startTime: 150, endTime: 250 })).totals).toEqual({ stableDevices: 1, installations: 0, unidentifiedEvents: 0 });
      expect((await store.listDevices({ appKey: 'demo', platform: 'web' })).total).toBe(0);
      expect((await store.listDevices({ appKey: 'demo', limit: 1, offset: 1 })).devices).toHaveLength(1);
      await store.archiveIssue('demo:native:test', 5000);
      expect((await store.listDevices({ appKey: 'demo' })).totals.stableDevices).toBe(2);
      const detail = await store.getIssueDetail('demo:native:test');
      const content = issueAlertContent(appRecord, detail.issue!, { ...base, ...identity }, 'new_issue');
      expect(content.subject).toContain(deviceShortCode(base) ?? 'HG-AAAAAAAAAAAA');
      expect(content.text).toContain('Event App release / SDK: 1.0.1 / 0.3.0-flutter');
      expect(deviceContextLines(history.events[0]).join('\n')).toContain('HG-AAAAAAAAAAAA');
    } finally { await f.db?.close(); }
  }, 30000);
  it('enforces owner access, validates filters, returns all failed request fields, and excludes successful requests', async () => {
    const f = await fixture(); const app = createServerApp(f.store, { notificationWorker: false });
    try {
      const http = { ...base, ...identity, eventId: 'http', type: 'http', method: 'GET', url: 'https://api.example.com/failure', duration: 12, success: false } as HealthGuardEvent;
      const accepted = await app.inject({ method: 'POST', url: '/api/events/batch', payload: { appKey: 'demo', events: [http, { ...http, eventId: 'ok', success: true }] } });
      expect(accepted.statusCode).toBe(202);
      const headers = { authorization: 'Bearer owner' };
      const list = await app.inject({ url: '/api/devices?appKey=demo', headers });
      expect(list.statusCode).toBe(200); expect(list.json().devices[0].anomalyCount).toBe(1);
      const key = encodeURIComponent(list.json().devices[0].key);
      const history = await app.inject({ url: `/api/devices/events?appKey=demo&key=${key}`, headers });
      expect(history.json().events[0]).toMatchObject({ ...identity, deviceInfo: base.deviceInfo, sdkVersion: base.sdkVersion, release: base.release });
      for (const path of ['/api/devices?appKey=demo', `/api/devices/events?appKey=demo&key=${key}`]) {
        expect((await app.inject({ url: path })).statusCode).toBe(401);
        expect((await app.inject({ url: path, headers: { authorization: 'Bearer other' } })).statusCode).toBe(404);
      }
      for (const q of ['appKey=demo&limit=101', 'appKey=demo&start=200&end=100', 'appKey=demo&kind=model', 'appKey=demo&offset=-1', 'appKey=demo&start=NaN']) {
        expect((await app.inject({ url: `/api/devices?${q}`, headers })).statusCode).toBe(400);
      }
      expect((await app.inject({ url: '/api/devices/events?appKey=demo', headers })).statusCode).toBe(400);
      expect((await app.inject({ url: '/api/devices?appKey=demo&search=%27%20OR%201%3D1--', headers })).json().total).toBe(0);
    } finally { await app.close(); await f.db?.close(); }
  }, 30000);
});

it('keeps missing historical receipt time unknown while selecting latest reported metadata', () => {
  const result = summarizeDevices([
    { ...base, ...identity, eventId: 'new-occurrence', timestamp: 200, receivedAt: 1000, release: '1.0.2' },
    { ...base, ...identity, eventId: 'late-old-occurrence', timestamp: 100, receivedAt: 2000, release: '1.0.1' },
    { ...base, eventId: 'historical', anonymousId: 'legacy', receivedAt: null },
  ], { appKey: 'demo' });
  expect(result.devices.find(d => d.kind === 'stable')).toMatchObject({ latestRelease: '1.0.1', lastReportedAt: 2000, firstSeenAt: 100, lastSeenAt: 200 });
  expect(result.devices.find(d => d.kind === 'installation')?.lastReportedAt).toBeNull();
});
