import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHealthGuardClient } from './sdk-web/src/index';
import { createMiniProgramClient } from './sdk-miniprogram/src/index';
import { createUniAppClient } from './sdk-uniapp/src/index';

afterEach(() => { vi.unstubAllGlobals(); });
describe('SDK network enrichment', () => {
  it('captures browser fetch failures with explicit unknown cause and preserves rejection', async () => {
    const failure = new TypeError('Failed to fetch');
    const target = { fetch: vi.fn().mockRejectedValue(failure), navigator: { onLine: true }, location: { href: 'https://app.example.com/' } };
    const transport = vi.fn().mockResolvedValue(undefined);
    const client = createHealthGuardClient({ appKey: 'demo', endpoint: 'https://collector.example.com/events', flushIntervalMs: 0, autoCapture: true, networkDiagnostics: true, target, transport } as any);
    await expect(target.fetch('https://api.example.com/v1')).rejects.toBe(failure);
    await client.flush();
    expect(transport.mock.calls[0][0].events[0]).toMatchObject({ success: false, networkDiagnostic: { category: 'unknown', network: { online: true } } });
  });
  it('mini-program errors use the portable module without pulling zod into the runtime', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const wx = { request: vi.fn((o) => o.fail?.({ errMsg: 'request:fail timeout' })), getNetworkType: (o: any) => o.success({ networkType: 'wifi' }) };
    const client = createMiniProgramClient({ appKey: 'demo', endpoint: 'https://collector.example.com/events', wx, autoCapture: true, networkDiagnostics: true, flushIntervalMs: 0, transport } as any);
    wx.request({ url: 'https://api.example.com/v1' });
    await client.flush();
    expect(transport.mock.calls[0][0].events[0]).toHaveProperty('networkDiagnostic.category', 'timeout');
  });
  it('uni-app failures have diagnostics and collector requests are excluded', async () => {
    const uni = { request: vi.fn((o) => o.fail?.({ errMsg: 'request:fail timeout' })), getNetworkType: (o: any) => o.success({ networkType: 'none' }) };
    vi.stubGlobal('uni', uni);
    const transport = vi.fn().mockResolvedValue(undefined);
    const client = createUniAppClient({ appKey: 'demo', endpoint: 'https://collector.example.com/events', autoCapture: true, networkDiagnostics: true, flushIntervalMs: 0, transport } as any);
    uni.request({ url: 'https://collector.example.com/events' });
    uni.request({ url: 'https://api.example.com/v1' });
    await client.flush();
    expect(transport.mock.calls[0][0].events).toHaveLength(1);
    expect(transport.mock.calls[0][0].events[0]).toHaveProperty('networkDiagnostic.category', 'offline');
  });
  it('persists failed diagnostic events and replays original identity after recreation', async () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) };
    const options = { appKey: 'demo', endpoint: 'https://collector.example.com/events', flushIntervalMs: 0, networkDiagnostics: { storage }, target: {} };
    const first = createHealthGuardClient({ ...options, transport: vi.fn().mockRejectedValue(new Error('offline')) } as any);
    first.captureHttp({ method: 'GET', url: 'https://api.example.com/v1', duration: 1, success: false });
    await first.flush();
    const saved = JSON.parse([...data.values()][0])[0];
    const transport = vi.fn().mockResolvedValue(undefined);
    const second = createHealthGuardClient({ ...options, transport } as any);
    await second.flush();
    expect(transport.mock.calls[0][0].events[0].eventId).toBe(saved.eventId);
    expect(transport.mock.calls[0][0].events[0].timestamp).toBe(saved.timestamp);
    expect(JSON.parse([...data.values()][0])).toEqual([]);
  });
});

describe('transport acknowledgement and enrichment boundaries', () => {
  it('does not delete persisted reports when a gateway replies with HTML 200', async () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('HTML'); } }));
    const client = createHealthGuardClient({ appKey: 'demo', endpoint: 'https://collector.example.com/events', flushIntervalMs: 0, networkDiagnostics: { storage } });
    client.captureHttp({ method: 'GET', url: 'https://api.example.com/v1', duration: 1, success: false });
    await client.flush();
    expect(JSON.parse([...data.values()][0])).toHaveLength(1);
    client.dispose();
  });
  it('does not suppress a different origin merely because its path equals the collector path', async () => {
    const target = { fetch: vi.fn().mockResolvedValue({ ok: false, status: 500 }) };
    const transport = vi.fn().mockResolvedValue(undefined);
    const client = createHealthGuardClient({ appKey: 'demo', endpoint: 'https://collector.example.com/events', flushIntervalMs: 0, target, autoCapture: true, networkDiagnostics: true, transport });
    await target.fetch('https://api.example.com/events'); await client.flush();
    expect(transport.mock.calls[0]?.[0].events).toHaveLength(1);
    client.dispose();
  });
  it('keeps in-flight reports persisted if another failure arrives before acknowledgement', async () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) };
    let release!: () => void;
    const transport = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const client = createHealthGuardClient({ appKey: 'demo', endpoint: 'https://collector.example.com/events', maxBatchSize: 1, flushIntervalMs: 0, networkDiagnostics: { storage, cooldownMs: 0 }, transport });
    client.captureHttp({ method: 'GET', url: 'https://api.example.com/v1', duration: 1, success: false });
    client.captureHttp({ method: 'GET', url: 'https://api.example.com/v2', duration: 1, success: false });
    expect(JSON.parse([...data.values()][0])).toHaveLength(2);
    release(); await Promise.resolve(); await Promise.resolve();
    client.dispose();
  });
});
