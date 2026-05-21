import { describe, expect, it } from 'vitest';
import { defaultLocaleFromTimeZone, getMessages, type Locale } from './i18n';

describe('dashboard i18n', () => {
  it('defaults to Chinese for China-area time zones and English elsewhere', () => {
    expect(defaultLocaleFromTimeZone('Asia/Shanghai')).toBe('zh-CN');
    expect(defaultLocaleFromTimeZone('Asia/Hong_Kong')).toBe('zh-CN');
    expect(defaultLocaleFromTimeZone('America/New_York')).toBe('en-US');
  });

  it('keeps required dashboard strings in both languages', () => {
    const keys = ['login', 'register', 'appType', 'currentAppKey', 'applicationHealth'] as const;

    for (const locale of ['en-US', 'zh-CN'] satisfies Locale[]) {
      const messages = getMessages(locale);

      for (const key of keys) {
        expect(messages[key]).toBeTruthy();
      }
    }
  });
});
