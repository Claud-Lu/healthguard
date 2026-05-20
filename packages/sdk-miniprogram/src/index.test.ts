import { describe, expect, it, vi } from 'vitest';
import { createMiniProgramClient } from './index';

describe('sdk-miniprogram client', () => {
  it('captures wx runtime errors and promise rejections', async () => {
    let errorHandler: ((message: string) => void) | undefined;
    let rejectionHandler: ((event: { reason: unknown }) => void) | undefined;
    const transport = vi.fn().mockResolvedValue(undefined);
    const wx = {
      onError: vi.fn((handler: (message: string) => void) => {
        errorHandler = handler;
      }),
      onUnhandledRejection: vi.fn((handler: (event: { reason: unknown }) => void) => {
        rejectionHandler = handler;
      }),
      request: vi.fn()
    };
    const client = createMiniProgramClient({
      appKey: 'mini-app',
      endpoint: 'https://collector.example.com/api/events/batch',
      wx,
      transport
    });

    errorHandler?.('MiniProgramError: boom\n at pages/index');
    rejectionHandler?.({ reason: new Error('promise boom') });
    await client.flush();

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0].events).toMatchObject([
      {
        platform: 'wechat-miniprogram',
        type: 'error',
        errorType: 'js',
        message: 'MiniProgramError: boom'
      },
      {
        platform: 'wechat-miniprogram',
        type: 'error',
        errorType: 'promise',
        message: 'promise boom'
      }
    ]);
  });

  it('wraps wx.request and captures failed requests with sanitized URLs', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const wx = {
      onError: vi.fn(),
      onUnhandledRejection: vi.fn(),
      request: vi.fn((options: any) => {
        options.fail?.({ errMsg: 'request:fail timeout' });
      })
    };
    const client = createMiniProgramClient({
      appKey: 'mini-app',
      endpoint: '/api/events/batch',
      wx,
      transport,
      autoCapture: { request: true }
    });

    wx.request({ url: 'https://api.example.com/user?token=abc', method: 'POST' });
    await client.flush();

    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      type: 'http',
      platform: 'wechat-miniprogram',
      method: 'POST',
      url: 'https://api.example.com/user?token=%5BFiltered%5D',
      success: false,
      errorMessage: 'request:fail timeout'
    });
  });

  it('records page lifecycle breadcrumbs', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const pageDefinition = {
      onLoad() {}
    };
    const wx = {
      onError: vi.fn(),
      onUnhandledRejection: vi.fn(),
      request: vi.fn()
    };
    const client = createMiniProgramClient({
      appKey: 'mini-app',
      endpoint: '/api/events/batch',
      wx,
      transport
    });

    const wrapped = client.wrapPage('pages/index/index', pageDefinition);
    wrapped.onLoad?.call({});
    client.captureException(new Error('after page load'));
    await client.flush();

    expect(transport.mock.calls[0][0].events[0].breadcrumbs).toMatchObject([
      {
        type: 'navigation',
        message: 'Page onLoad: pages/index/index'
      }
    ]);
  });
});
