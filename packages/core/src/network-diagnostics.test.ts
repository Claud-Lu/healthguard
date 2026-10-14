import { describe, expect, it, vi } from 'vitest';
import * as network from './network-diagnostics';
import { parseEventBatch } from './index';

describe('portable network diagnostics', () => {
  it.each([
    [{ success: false, status: 503 }, 'http'],
    [{ success: false, failureKind: 'dns' }, 'dns'],
    [{ success: false, errorMessage: 'request:fail timeout' }, 'timeout'],
    [{ success: false, errorMessage: 'Failed to fetch' }, 'unknown'],
    [{ success: false, failureKind: 'cancelled' }, 'cancelled'],
    [{ success: false, snapshot: { online: false } }, 'offline'],
  ])('classifies evidence without guessing CORS/DNS from generic errors', (input, expected) => {
    expect(network.createNetworkDiagnostic({ method: 'GET', url: 'https://api.example.com/items', duration: 5, success: false, ...input as Partial<network.DiagnosticRequest> }).category).toBe(expected);
  });
  it('keeps only permitted network fields and removes URL credentials, query, fragment and path identifiers', () => {
    const report = network.createNetworkDiagnostic({ method: 'GET', url: 'https://user:pass@api.example.com/users/123?token=private#secret', duration: 5, success: false,
      snapshot: { online: true, transport: 'wifi', ssid: 'private', ip: '10.0.0.1', token: 'private' } as any });
    expect(report.targetOrigin).toBe('https://api.example.com');
    expect(JSON.stringify(report)).not.toMatch(/private|123|10\.0|users/);
    expect(report.network).toEqual({ online: true, transport: 'wifi' });
    expect(report.timing.availability).toBe('unavailable');
  });
  it('accepts additive event diagnostics while rejecting malformed and oversized evidence', () => {
    const event = { eventId: 'e', appKey: 'demo', platform: 'web', type: 'http', timestamp: 1, sessionId: 's', anonymousId: 'a', sdkVersion: 'test', method: 'GET', url: '/v1', duration: 1, success: false,
      networkDiagnostic: network.createNetworkDiagnostic({ method: 'GET', url: '/v1', duration: 1, success: false }) };
    expect(parseEventBatch({ appKey: 'demo', events: [event] }).events[0]).toHaveProperty('networkDiagnostic');
    expect(() => parseEventBatch({ appKey: 'demo', events: [{ ...event, networkDiagnostic: { version: 1, category: 'fake' } }] })).toThrow();
  });
  it('limits enrichment per origin and disposes network listeners', () => {
    let listener: (() => void) | undefined;
    const remove = vi.fn();
    const target = { navigator: { onLine: true, connection: { effectiveType: '4g', addEventListener: (_: string, cb: () => void) => { listener = cb; }, removeEventListener: remove } } };
    const collector = network.createNetworkDiagnosticCollector({ cooldownMs: 1000 }, target);
    const input = { method: 'GET', url: 'https://api.example.com/v1', duration: 1, success: false };
    expect(collector.capture(input)).toHaveProperty('network.online', true);
    expect(collector.capture(input)).toBeUndefined();
    target.navigator.onLine = false; listener?.();
    collector.dispose();
    expect(remove).toHaveBeenCalled();
  });
  it('treats protected resource timings as unavailable, including zero values', () => {
    const collector = network.createNetworkDiagnosticCollector({ cooldownMs: 0 }, {
      performance: { getEntriesByName: () => [{ startTime: 1, domainLookupStart: 0, domainLookupEnd: 0, connectStart: 0, connectEnd: 0, requestStart: 0, responseStart: 0, responseEnd: 5 }] }
    });
    expect(collector.capture({ method: 'GET', url: 'https://api.example.com/v1', duration: 1, success: false })?.timing.availability).toBe('unavailable');
  });
  it('measures exposed phases and marks unsupported network state explicitly', () => {
    const collector = network.createNetworkDiagnosticCollector({ cooldownMs: 0 }, {
      performance: { timeOrigin: 1000, getEntriesByName: () => [{ startTime: 1, domainLookupStart: 1, domainLookupEnd: 3, connectStart: 3, connectEnd: 7, requestStart: 8, responseStart: 12, responseEnd: 15 }] }
    });
    const report = collector.capture({ method: 'GET', url: '/v1', requestStartedAt: 1001, duration: 14, success: false });
    expect(report?.timing).toMatchObject({ availability: 'available', dnsMs: 2, connectMs: 4, ttfbMs: 4 });
    expect(report?.networkAvailability).toBe('unavailable');
  });
});

describe('network evidence boundaries and lifecycle', () => {
  it('ignores successes, disabled collection and disposed collection', () => {
    const input = { method: 'GET', url: '/v1', duration: 1, success: false };
    expect(network.createNetworkDiagnosticCollector(false).capture(input)).toBeUndefined();
    const collector = network.createNetworkDiagnosticCollector(true);
    expect(collector.capture({ ...input, success: true })).toBeUndefined();
    collector.dispose(); expect(collector.capture(input)).toBeUndefined();
  });
  it.each(['cancelled', 'dns', 'connect', 'tls', 'timeout'])('preserves explicit native failure kind %s', (failureKind) => {
    expect(network.createNetworkDiagnostic({ method: 'GET', url: '/v1', duration: 1, success: false, failureKind: failureKind as network.NetworkCategory }).category).toBe(failureKind);
  });
  it.each([['ENOTFOUND','dns'],['connection refused','connect'],['SSLHandshakeException','tls']])('recognizes explicit platform errors %s', (errorMessage, category) => {
    expect(network.createNetworkDiagnostic({ method: 'GET', url: '/v1', duration: 1, success: false, errorMessage }).category).toBe(category);
  });
  it('rejects non-http target origins and non-finite timings', () => {
    expect(network.networkTargetOrigin('file:///secret')).toBeUndefined();
    expect(network.safeNetworkRequestUrl('javascript:secret')).toBe('[Unavailable]');
    expect(network.safeNetworkRequestUrl('https://[invalid')).toBe('[Unavailable]');
    const report = network.createNetworkDiagnostic({ method: 'GET', url: 'broken', duration: 1, success: false,
      snapshot: { transport: 'private', effectiveType: 'private' } as any,
      timing: { availability: 'available', dnsMs: -1, connectMs: Infinity, ttfbMs: 4000000 } });
    expect(report.networkAvailability).toBe('unavailable');
    expect(report.timing).toEqual({ availability: 'unavailable' });
  });
  it('handles unavailable APIs and full storage without interrupting business requests', () => {
    const fail = () => { throw new Error('unsupported'); };
    const collector = network.createNetworkDiagnosticCollector(true, { getNetworkType: fail, onNetworkStatusChange: fail, addEventListener: fail, offNetworkStatusChange: fail, removeEventListener: fail, performance: { getEntriesByName: fail } });
    expect(collector.capture({ method: 'GET', url: '/v1', duration: 1, success: false })?.networkAvailability).toBe('unavailable');
    expect(() => collector.dispose()).not.toThrow();
    const buffer = network.createDiagnosticBuffer(true, 'demo', '/events', { getItem: fail, setItem: fail });
    expect(buffer.restored).toEqual([]); expect(() => buffer.save([])).not.toThrow();
  });
  it('bounds cached origins and sanitizes persistence while retaining original IDs', () => {
    const collector = network.createNetworkDiagnosticCollector({ cooldownMs: 1 });
    for (let i=0;i<25;i++) expect(collector.capture({ method: 'GET', url: `https://h${i}.example.com/v1`, duration: 1, success: false })).toBeDefined();
    const values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) };
    const buffer = network.createDiagnosticBuffer<any>({ storage, maxPendingEvents: 1 }, 'demo', '/events');
    const event = { type: 'http', appKey: 'demo', eventId: 'original', timestamp: 1, url: 'https://u:pass@api.example.com/v1?token=secret', context: { token: 'secret' }, networkDiagnostic: network.createNetworkDiagnostic({ method: 'GET', url: '/v1', duration: 1, success: false }) };
    buffer.save([event,event]);
    const restored = network.createDiagnosticBuffer<any>({ storage }, 'demo', '/events').restored;
    expect(restored).toHaveLength(1); expect(restored[0].eventId).toBe('original');
    expect(JSON.stringify(restored)).not.toMatch(/secret|pass|context/);
  });
});

it('does not attach resource timings from a previous request to the same URL', () => {
  const collector = network.createNetworkDiagnosticCollector(true, {
    performance: { timeOrigin: 1000, getEntriesByName: () => [{ startTime: 1, domainLookupStart: 1, domainLookupEnd: 3, connectStart: 3, connectEnd: 7, requestStart: 8, responseStart: 12, responseEnd: 15 }] }
  });
  expect(collector.capture({ method: 'GET', url: 'https://api.example.com/v1', requestStartedAt: 2000, duration: 1, success: false } as any)?.timing.availability).toBe('unavailable');
});
