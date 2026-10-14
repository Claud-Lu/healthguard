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
    expect(network.createNetworkDiagnostic({ method: 'GET', url: 'https://api.example.com/items', duration: 5, ...input }).category).toBe(expected);
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
      performance: { getEntriesByName: () => [{ startTime: 1, domainLookupStart: 1, domainLookupEnd: 3, connectStart: 3, connectEnd: 7, requestStart: 8, responseStart: 12, responseEnd: 15 }] }
    });
    const report = collector.capture({ method: 'GET', url: '/v1', duration: 14, success: false });
    expect(report?.timing).toMatchObject({ availability: 'available', dnsMs: 2, connectMs: 4, ttfbMs: 4 });
    expect(report?.networkAvailability).toBe('unavailable');
  });
});
