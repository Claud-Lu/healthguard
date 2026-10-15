import { describe, expect, it } from 'vitest';
import { createHttpFingerprint, httpEventSummary, networkDiagnosticLines, type HttpEvent } from './index';
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
