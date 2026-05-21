import { describe, expect, it } from 'vitest';
import { defaultLocaleFromTimeZone, getMessages, messageForErrorCode, type Locale } from './i18n';

describe('dashboard i18n', () => {
  it('defaults to Chinese for China-area time zones and English elsewhere', () => {
    expect(defaultLocaleFromTimeZone('Asia/Shanghai')).toBe('zh-CN');
    expect(defaultLocaleFromTimeZone('Asia/Hong_Kong')).toBe('zh-CN');
    expect(defaultLocaleFromTimeZone('America/New_York')).toBe('en-US');
  });

  it('keeps required dashboard strings in both languages', () => {
    const keys = [
      'login',
      'register',
      'appType',
      'currentAppKey',
      'applicationHealth',
      'dashboardHomeSubtitle',
      'emptyProjects',
      'projectDetail',
      'selectProject',
      'invalidEmail',
      'passwordTooShort',
      'invalidCredentials',
      'emailAlreadyRegistered',
      'networkError'
    ] as const;

    for (const locale of ['en-US', 'zh-CN'] satisfies Locale[]) {
      const messages = getMessages(locale);

      for (const key of keys) {
        expect(messages[key]).toBeTruthy();
      }
    }
  });

  it('maps stable API error codes to localized messages', () => {
    expect(messageForErrorCode('INVALID_EMAIL', 'zh-CN')).toBe('请输入正确的邮箱地址。');
    expect(messageForErrorCode('PASSWORD_TOO_SHORT', 'zh-CN')).toBe('密码至少需要 8 位。');
    expect(messageForErrorCode('INVALID_CREDENTIALS', 'en-US')).toBe('Email or password is incorrect.');
    expect(messageForErrorCode('UNKNOWN_CODE', 'zh-CN')).toBe('请求失败，请稍后重试。');
  });
});
