import { describe, expect, it } from 'vitest';
import { createHttpFingerprint, httpEventSummary, httpFailurePhase, httpTarget, evidenceText, networkDiagnosticLines, type HttpEvent } from './index';
const base: HttpEvent = { eventId: 'one', appKey: 'demo', platform: 'flutter', type: 'http', timestamp: 1, sessionId: 's', anonymousId: 'a', sdkVersion: 'test', method: 'GET', url: 'https://api.example.com/calls?token=secret', duration: 10003, success: false, release: '1.0.53', environment: 'production', context: { originalError: { dioType: 'connectionTimeout', message: 'connect timeout' }, networkDiagnostics: { requestId: 'req-one' } } };
describe('HTTP occurrence identity and evidence', () => {
  it('separates connection, send and response timeouts at one endpoint', () => {
    const ids = ['connectionTimeout', 'sendTimeout', 'receiveTimeout'].map(dioType => createHttpFingerprint({ ...base, context: { originalError: { dioType } } }));
    expect(new Set(ids).size).toBe(3);
  });
  it('separates targets and environments but ignores query, request IDs and durations', () => {
    expect(createHttpFingerprint(base)).not.toBe(createHttpFingerprint({ ...base, url: 'https://other.example.com/calls' }));
    expect(createHttpFingerprint(base)).not.toBe(createHttpFingerprint({ ...base, environment: 'test' }));
    expect(createHttpFingerprint(base)).toBe(createHttpFingerprint({ ...base, url: 'https://api.example.com/calls?token=other', duration: 999, context: { originalError: { dioType: 'connectionTimeout' }, networkDiagnostics: { requestId: 'different' } } }));
  });
  it('summarizes the actual occurrence without credentials or historical titles', () => {
    expect(httpEventSummary(base)).toContain('connection_timeout');
    expect(httpEventSummary(base)).toContain('/calls');
    expect(httpEventSummary(base)).not.toContain('secret');
    const lines = networkDiagnosticLines(base, 'zh').join('\n');
    expect(lines).toContain('connectionTimeout');
    expect(lines).toContain('req-one');
  });
});

it('handles old clients, malformed context and privacy boundaries conservatively', () => {
  expect(httpFailurePhase({ status: 502, context: { originalError: { dioType: 'connectionTimeout' } } })).toBe('http');
  expect(httpFailurePhase({ networkDiagnostic: { category: 'dns' } } as any)).toBe('dns');
  expect(httpFailurePhase({ context: { originalError: [] } })).toBe('unknown');
  expect(httpFailurePhase({ context: { originalError: { dioType: 'not-a-known-phase' } } })).toBe('unknown');
  expect(httpTarget({ url: 'https://[invalid?token=secret' })).not.toContain('secret');
  expect(httpTarget({ url: '/calls?token=secret' })).toBe('/calls');
  expect(evidenceText(1)).toBe('');
  expect(evidenceText('Bearer secret token=secret https://u:p@api.example.com/calls?secret=one')).not.toContain('secret');
  const context = { originalError: { dioType: 'connectionTimeout' }, requestTrace: { source: 'original_request', requestId: 'trace-1', connectionAcquisition: { outcome: 'connectionTimeout', durationMs: 10000 } }, networkDiagnostics: { probes: { cached: true, sampledAt: 100 } } };
  for (const language of ['zh', 'en'] as const) {
    const lines = networkDiagnosticLines({ context }, language).join('\n');
    expect(lines).toContain('trace-1'); expect(lines).toContain('10000 ms'); expect(lines).toContain('1970-01-01');
    expect(networkDiagnosticLines({ context: { requestTrace: { source: 'original_request', connectionAcquisition: {} } } }, language).join(' ')).toMatch(/不可用|Unavailable/);
  }
});
