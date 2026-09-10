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
