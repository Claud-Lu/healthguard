import { describe, expect, it } from 'vitest';
import { notificationAddress } from './content';

describe('notification addresses', () => {
  it('retains full URLs and masks credentials in queries and hash routes', () => {
    expect(notificationAddress('https://user:pass@api.example.com:8443/v1/order?id=42&access_token=secret#/detail?tab=info&API_KEY=secret'))
      .toBe('https://api.example.com:8443/v1/order?id=42&access_token=%5BFiltered%5D#/detail?tab=info&API_KEY=%5BFiltered%5D');
    expect(notificationAddress('/pages/home?token=one&token=two&sort=new')).toBe('/pages/home?token=%5BFiltered%5D&sort=new');
    expect(notificationAddress('https://example.com/#access_token=secret&state=ready')).toBe('https://example.com/#access_token=%5BFiltered%5D&state=ready');
  });

  it('preserves safe paths and fragments and handles malformed or unsupported addresses without exposing them', () => {
    expect(notificationAddress('https://example.com/app?lang=zh#/pages/home?id=42')).toBe('https://example.com/app?lang=zh#/pages/home?id=42');
    expect(notificationAddress('pages/home')).toBe('pages/home');
    expect(notificationAddress('//api.example.com/v1')).toBe('//api.example.com/v1');
    expect(notificationAddress('https:api.example.com/v1')).toBe('https://api.example.com/v1');
    expect(notificationAddress('https://[invalid]?token=secret')).toBe('地址无法解析 / Invalid URL');
    expect(notificationAddress('javascript:secret')).toBe('地址格式不支持 / Unsupported URL');
  });
});

import { issueAlertContent } from './content';
import type { HealthGuardEvent } from '@health-guard/core';
it('includes evidence from the triggering event in alert summaries', () => {
  const event = { eventId: 'e', platform: 'flutter', type: 'http', timestamp: 1, method: 'GET', url: 'https://api.example.com/v1', duration: 10, success: false,
    networkDiagnostic: { version: 1, category: 'timeout', networkAvailability: 'available', network: { online: true, transport: 'wifi', validated: false }, timing: { availability: 'unavailable' }, recentChanges: [] } } as unknown as HealthGuardEvent;
  const content = issueAlertContent({ name: 'Demo' } as any, { id: 'i', message: 'Timeout', errorType: 'http', eventCount: 1, lastSeenAt: 1 } as any, event, 'new_issue');
  expect(content.text).toContain('超时');
  expect(content.text).toContain('wifi');
  expect(content.text).toContain('不可用');
});

it('uses the triggering HTTP failure rather than a stale aggregate title', () => {
  const event = { eventId: 'new', type: 'http', platform: 'flutter', timestamp: 100, method: 'GET', url: 'https://api.example.com/calls', duration: 10003, success: false, release: '1.0.53', context: { originalError: { dioType: 'connectionTimeout', message: 'connect timed out' }, networkDiagnostics: { requestId: 'req-42' } } } as unknown as HealthGuardEvent;
  const result = issueAlertContent({ name: 'Demo' } as any, { id: 'i', message: 'receive timeout 15 seconds', errorType: 'http', eventCount: 10, lastSeenAt: 100 } as any, event, 'threshold');
  expect(result.text).toContain('本次异常 / Current occurrence: GET');
  expect(result.text).toContain('connection_timeout');
  expect(result.text).toContain('req-42');
  expect(result.text).toContain('历史聚合摘要 / Historical issue summary: receive timeout 15 seconds');
});
