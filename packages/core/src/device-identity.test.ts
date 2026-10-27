import { describe, expect, it } from 'vitest';
import { deviceContextLines, deviceGrouping, deviceShortCode, parseEventBatch, type ErrorEvent } from './index';
const event: ErrorEvent = { appKey: 'demo', eventId: 'one', platform: 'flutter', type: 'error', timestamp: 1, sessionId: 'session', anonymousId: 'install', sdkVersion: 'test', errorType: 'native', message: 'failure', fingerprint: 'native:test', breadcrumbs: [] };
const identity = { deviceId: `hgd1_${'a'.repeat(64)}`, deviceIdStatus: 'available' as const, deviceIdSource: 'android_id' as const, deviceIdScope: 'android_user_signing_key_app' as const };
describe('scoped device identity contract', () => {
  it('accepts pseudonyms and separates device, installation and session IDs', () => {
    const parsed = parseEventBatch({ appKey: 'demo', events: [{ ...event, ...identity }] }).events[0];
    expect(parsed).toMatchObject({ ...identity, anonymousId: 'install', sessionId: 'session' });
    expect(deviceShortCode(parsed)).toBe('HG-AAAAAAAAAAAA');
    expect(deviceGrouping(parsed).kind).toBe('stable');
  });
  it('rejects raw Android IDs, random IDs, missing scope and contradictory state', () => {
    for (const invalid of [{ ...identity, deviceId: '0123456789abcdef' }, { ...identity, deviceId: 'random-uuid' },
      { ...identity, deviceIdScope: undefined }, { ...identity, deviceIdStatus: 'unavailable' },
      { ...identity, deviceIdReason: 'timeout' }, { deviceId: identity.deviceId }]) {
      expect(() => parseEventBatch({ appKey: 'demo', events: [{ ...event, ...invalid }] })).toThrow();
    }
  });
  it('keeps unavailable and legacy identity unknown, using installation only as a separate category', () => {
    const unavailable = parseEventBatch({ appKey: 'demo', events: [{ ...event, deviceIdStatus: 'unavailable', deviceIdReason: 'timeout' }] }).events[0];
    expect(deviceShortCode(unavailable)).toBeNull();
    expect(deviceGrouping(unavailable)).toEqual({ key: 'installation:install', kind: 'installation' });
    expect(deviceGrouping({ ...event, anonymousId: 'unknown' })).toEqual({ key: 'unknown:one', kind: 'unknown' });
    expect(deviceGrouping({ ...event, anonymousId: 'unknown', eventId: 'two', deviceInfo: { model: 'same' } }).key).toBe('unknown:two');
  });
  it('shortcode collisions never combine distinct full identities or scopes', () => {
    const sameCode = { ...event, ...identity, deviceId: `hgd1_${'a'.repeat(12)}${'b'.repeat(52)}` };
    expect(deviceShortCode(sameCode)).toBe(deviceShortCode({ ...event, ...identity }));
    expect(deviceGrouping(sameCode).key).not.toBe(deviceGrouping({ ...event, ...identity }).key);
    expect(deviceGrouping({ ...event, ...identity, deviceIdScope: 'android_user_app_legacy' }).key).not.toBe(deviceGrouping({ ...event, ...identity }).key);
  });
  it('distinguishes unavailable from unknown legacy identity in both display languages', () => {
    const failed = { ...event, deviceIdStatus: 'unavailable', deviceIdReason: 'timeout' };
    expect(deviceContextLines(failed).join('\n')).toContain('设备短码: 未获取');
    expect(deviceContextLines(failed, 'en').join('\n')).toContain('Device code: Unavailable');
    expect(deviceContextLines(event).join('\n')).toContain('设备短码: 未知');
    expect(deviceContextLines({ eventId: 'old' }, 'en').join('\n')).toContain('Event App release / SDK: Unavailable / Unavailable');
  });

});
