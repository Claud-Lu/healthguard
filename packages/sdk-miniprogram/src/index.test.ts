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

  it('treats business error responses as failed requests', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const wx = {
      onError: vi.fn(),
      onUnhandledRejection: vi.fn(),
      request: vi.fn((options: any) => {
        options.success?.({
          statusCode: 200,
          data: {
            success: false,
            error: {
              code: 500,
              message: '服务器内部错误'
            },
            message: '操作失败'
          }
        });
      })
    };
    const client = createMiniProgramClient({
      appKey: 'mini-app',
      endpoint: '/api/events/batch',
      wx,
      transport,
      autoCapture: { request: true }
    });

    wx.request({ url: 'https://api.example.com/create-order', method: 'POST' });
    await client.flush();

    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      type: 'http',
      method: 'POST',
      url: 'https://api.example.com/create-order',
      status: 500,
      success: false,
      errorMessage: '服务器内部错误'
    });
  });

  it('captures Alipay-style response status fields', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const wx = {
      onError: vi.fn(),
      onUnhandledRejection: vi.fn(),
      request: vi.fn((options: any) => {
        options.success?.({ status: 500, data: { message: '服务器内部错误' } });
      })
    };
    const client = createMiniProgramClient({
      appKey: 'mini-app',
      endpoint: '/api/events/batch',
      wx,
      transport,
      autoCapture: { request: true }
    });

    wx.request({ url: 'https://api.example.com/alipay-status', method: 'GET' });
    await client.flush();

    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      type: 'http',
      status: 500,
      success: false,
      errorMessage: '服务器内部错误'
    });
  });

  it('captures request context from auto-captured mini-program requests', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const wx = {
      onError: vi.fn(),
      onUnhandledRejection: vi.fn(),
      request: vi.fn((options: any) => {
        options.fail?.({
          error: 19,
          errorMessage: 'http status error',
          status: 404,
          statusCode: 404
        });
      })
    };
    const client = createMiniProgramClient({
      appKey: 'mini-app',
      endpoint: '/api/events/batch',
      wx,
      transport,
      autoCapture: { request: true }
    });

    wx.request({
      url: 'https://sharebus.lemonbus.cn/sharebusapi/passenger/vehicles/nearby?latitude=30.49&longitude=114.18&token=secret',
      method: 'GET',
      data: { latitude: 30.49, longitude: 114.18, token: 'secret' },
      healthGuard: {
        page: 'pages/index/index',
        scene: 'home.loadNearbyVehicles'
      }
    });
    await client.flush();

    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      type: 'http',
      method: 'GET',
      url: 'https://sharebus.lemonbus.cn/sharebusapi/passenger/vehicles/nearby?latitude=30.49&longitude=114.18&token=%5BFiltered%5D',
      status: 404,
      success: false,
      errorMessage: 'http status error',
      page: 'pages/index/index',
      scene: 'home.loadNearbyVehicles',
      requestData: {
        latitude: 30.49,
        longitude: 114.18,
        token: '[Filtered]'
      },
      context: {
        originalError: {
          error: 19,
          statusCode: 404
        }
      }
    });
  });

  it('infers the current page for auto-captured requests when page is not provided', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const wx = {
      onError: vi.fn(),
      onUnhandledRejection: vi.fn(),
      request: vi.fn((options: any) => {
        options.fail?.({ errMsg: 'request:fail timeout' });
      }),
      getCurrentPages: vi.fn(() => [
        { route: 'pages/login/login' },
        { route: 'pages/index/index' }
      ])
    };
    const client = createMiniProgramClient({
      appKey: 'mini-app',
      endpoint: '/api/events/batch',
      wx,
      transport,
      autoCapture: { request: true }
    });

    wx.request({
      url: 'https://api.example.com/vehicles/nearby',
      method: 'GET'
    });
    await client.flush();

    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      type: 'http',
      page: 'pages/index/index',
      scene: undefined
    });
  });

  it('keeps structured mini-program promise rejection context', async () => {
    let rejectionHandler: ((event: { reason: unknown }) => void) | undefined;
    const transport = vi.fn().mockResolvedValue(undefined);
    const wx = {
      onError: vi.fn(),
      onUnhandledRejection: vi.fn((handler: (event: { reason: unknown }) => void) => {
        rejectionHandler = handler;
      }),
      request: vi.fn()
    };
    const client = createMiniProgramClient({
      appKey: 'mini-app',
      endpoint: '/api/events/batch',
      wx,
      transport,
      platform: 'alipay-miniprogram'
    });

    rejectionHandler?.({
      reason: {
        error: 12,
        errorMessage: '未能找到使用指定主机名的服务器或者没有网络连接。',
        status: -1003,
        statusCode: -1003,
        method: 'GET',
        url: 'https://bad.example.com/api?token=secret',
        page: 'pages/index/index',
        scene: 'home.loadNearbyVehicles',
        requestData: { token: 'secret', radius: 3000 }
      }
    });
    await client.flush();

    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      type: 'error',
      errorType: 'promise',
      platform: 'alipay-miniprogram',
      message: '未能找到使用指定主机名的服务器或者没有网络连接。',
      page: 'pages/index/index',
      scene: 'home.loadNearbyVehicles',
      context: {
        method: 'GET',
        url: 'https://bad.example.com/api?token=%5BFiltered%5D',
        statusCode: -1003,
        requestData: {
          token: '[Filtered]',
          radius: 3000
        }
      }
    });
  });

  it('uses the configured mini-program platform for captured events', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const wx = {
      onError: vi.fn(),
      onUnhandledRejection: vi.fn(),
      request: vi.fn()
    };
    const client = createMiniProgramClient({
      appKey: 'mini-app',
      endpoint: '/api/events/batch',
      wx,
      platform: 'alipay-miniprogram',
      transport
    });

    client.captureException(new Error('alipay boom'));
    await client.flush();

    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      platform: 'alipay-miniprogram',
      message: 'alipay boom'
    });
  });

  it('uses wx.request as the default transport and posts to the collector endpoint', async () => {
    const wx = {
      onError: vi.fn(),
      onUnhandledRejection: vi.fn(),
      request: vi.fn((options: any) => {
        options.success?.({ statusCode: 202 });
      })
    };
    const client = createMiniProgramClient({
      appKey: 'mini-app',
      endpoint: 'https://collector.example.com/events/batch',
      wx
    });

    client.captureException(new Error('native transport boom'));
    await client.flush();

    expect(wx.request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://collector.example.com/events/batch',
      method: 'POST',
      data: expect.objectContaining({
        appKey: 'mini-app'
      })
    }));
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

  it('keeps events queued when transport fails so they can be retried', async () => {
    const wx = {
      onError: vi.fn(),
      onUnhandledRejection: vi.fn(),
      request: vi.fn()
    };
    const transport = vi.fn().mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(undefined);
    const client = createMiniProgramClient({
      appKey: 'mini-app',
      endpoint: '/api/events/batch',
      wx,
      transport,
      flushIntervalMs: 0
    });

    client.captureException(new Error('retry me'));
    await client.flush();
    await client.flush();

    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][0].events[0]).toMatchObject({
      type: 'error',
      message: 'retry me'
    });
  });

  it('backs off automatic retries after transport failures', async () => {
    vi.useFakeTimers();

    try {
      const wx = {
        onError: vi.fn(),
        onUnhandledRejection: vi.fn(),
        request: vi.fn()
      };
      const transport = vi.fn().mockRejectedValue(new Error('collector down'));
      const client = createMiniProgramClient({
        appKey: 'mini-app',
        endpoint: '/api/events/batch',
        wx,
        transport,
        flushIntervalMs: 1000,
        transportFailureRetryDelayMs: 60000
      });

      client.captureException(new Error('retry later'));

      await vi.advanceTimersByTimeAsync(1000);
      expect(transport).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(transport).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(59000);
      expect(transport).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
