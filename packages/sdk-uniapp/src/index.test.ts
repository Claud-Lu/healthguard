import { describe, expect, it, vi } from 'vitest';
import { createUniAppClient } from './index';

describe('sdk-uniapp client', () => {
  it('queues captured exceptions and flushes them through the configured transport', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const client = createUniAppClient({
      appKey: 'demo-app',
      endpoint: 'https://collector.example.com/api/events/batch',
      transport,
      flushIntervalMs: 0
    });

    client.captureException(new Error('boom'));
    await client.flush();

    expect(transport).toHaveBeenCalledTimes(1);
    const event = transport.mock.calls[0][0].events[0];
    expect(event).toMatchObject({
      appKey: 'demo-app',
      type: 'error',
      errorType: 'js',
      message: 'boom'
    });
    // platform should be one of the uni-app variants (depends on test env)
    expect(event.platform).toMatch(/^uniapp/);
  });

  it('sanitizes request urls before enqueueing http events', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const client = createUniAppClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
      transport,
      flushIntervalMs: 0
    });

    client.captureHttp({
      method: 'POST',
      url: 'https://api.example.com/pay?token=abc&orderId=1',
      status: 500,
      duration: 30,
      success: false
    });
    await client.flush();

    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      type: 'http',
      url: 'https://api.example.com/pay?token=%5BFiltered%5D&orderId=1'
    });
  });

  it('captures manual performance metrics', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const client = createUniAppClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
      transport,
      flushIntervalMs: 0
    });

    client.capturePerformance({ name: 'LCP', value: 1200, rating: 'good' });
    await client.flush();

    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      type: 'performance',
      name: 'LCP',
      value: 1200,
      rating: 'good'
    });
  });

  it('keeps events queued when transport fails so they can be retried', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(undefined);
    const client = createUniAppClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
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
      const transport = vi.fn().mockRejectedValue(new Error('collector down'));
      const client = createUniAppClient({
        appKey: 'demo-app',
        endpoint: '/api/events/batch',
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

  it('adds breadcrumbs and includes them in error events', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const client = createUniAppClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
      transport,
      flushIntervalMs: 0
    });

    client.addBreadcrumb({ type: 'navigation', message: 'page changed' });
    client.captureException(new Error('with breadcrumb'));
    await client.flush();

    const event = transport.mock.calls[0][0].events[0];
    expect(event.breadcrumbs).toHaveLength(1);
    expect(event.breadcrumbs[0]).toMatchObject({
      type: 'navigation',
      message: 'page changed'
    });
  });

  it('limits breadcrumbs to 30 items', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const client = createUniAppClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
      transport,
      flushIntervalMs: 0
    });

    for (let i = 0; i < 35; i += 1) {
      client.addBreadcrumb({ type: 'manual', message: `crumb ${i}` });
    }

    client.captureException(new Error('too many crumbs'));
    await client.flush();

    const event = transport.mock.calls[0][0].events[0];
    expect(event.breadcrumbs).toHaveLength(30);
    expect(event.breadcrumbs[0].message).toBe('crumb 5');
  });
});

describe('sdk-uniapp H5 auto capture', () => {
  it('captures window error events when auto capture is enabled', async () => {
    const listeners = new Map<string, EventListener>();
    const transport = vi.fn().mockResolvedValue(undefined);
    const target = {
      location: { href: 'https://demo.example.com/' },
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn(),
      fetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      XMLHttpRequest: vi.fn()
    };

    // Mock window-like environment so isH5() returns true
    const originalWindow = globalThis.window;
    // @ts-expect-error mock window
    globalThis.window = target;
    // @ts-expect-error mock document
    globalThis.document = {};

    const client = createUniAppClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
      transport,
      flushIntervalMs: 0,
      autoCapture: true
    });

    listeners.get('error')?.({
      message: 'auto boom',
      error: new Error('auto boom'),
      filename: 'demo.js',
      lineno: 10,
      colno: 2
    } as unknown as Event);
    await client.flush();

    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      type: 'error',
      errorType: 'js',
      message: 'auto boom',
      filename: 'demo.js',
      lineno: 10,
      colno: 2,
      pageUrl: 'https://demo.example.com/'
    });

    // restore
    globalThis.window = originalWindow;
    // @ts-expect-error cleanup
    delete globalThis.document;
  });

  it('captures failed fetch requests on H5 when fetch monitoring is enabled', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const target = {
      location: { href: 'https://demo.example.com/' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 503
      })
    };

    const originalWindow = globalThis.window;
    // @ts-expect-error mock window
    globalThis.window = target;
    // @ts-expect-error mock document
    globalThis.document = {};

    const client = createUniAppClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
      transport,
      flushIntervalMs: 0,
      autoCapture: { fetch: true }
    });

    await target.fetch('https://api.example.com/orders?token=abc', { method: 'POST' });
    await client.flush();

    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      type: 'http',
      method: 'POST',
      url: 'https://api.example.com/orders?token=%5BFiltered%5D',
      status: 503,
      success: false
    });

    globalThis.window = originalWindow;
    // @ts-expect-error cleanup
    delete globalThis.document;
  });

  it('captures uni.request on mini-program runtime', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);

    // Mock uni object
    const uniMock = {
      request: vi.fn((options: { success?: (res: { statusCode?: number }) => void; fail?: (err: { errMsg?: string }) => void }) => {
        options.success?.({ statusCode: 500 });
      }),
      getStorageSync: vi.fn(),
      setStorageSync: vi.fn(),
      getSystemInfoSync: vi.fn(() => ({ uniPlatform: 'mp-weixin' })),
      onError: vi.fn(),
      onUnhandledRejection: vi.fn(),
      getCurrentPages: vi.fn(() => [{ route: 'pages/index/index' }])
    };

    // @ts-expect-error mock uni
    globalThis.uni = uniMock;

    const client = createUniAppClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
      transport,
      flushIntervalMs: 0,
      autoCapture: { request: true }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (uniMock.request as any)({ url: 'https://api.example.com/data' });
    await client.flush();

    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      type: 'http',
      url: 'https://api.example.com/data',
      status: 500,
      success: false
    });

    // cleanup
    // @ts-expect-error cleanup
    delete globalThis.uni;
  });

  it('does not capture SDK transport requests as HTTP events', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const target = {
      location: { href: 'https://demo.example.com/' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        status: 202
      })
    };

    const originalWindow = globalThis.window;
    // @ts-expect-error mock window
    globalThis.window = target;
    // @ts-expect-error mock document
    globalThis.document = {};

    const client = createUniAppClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
      transport,
      flushIntervalMs: 0,
      autoCapture: { fetch: true }
    });

    await target.fetch('/api/events/batch', { method: 'POST' });
    await client.flush();

    expect(transport).not.toHaveBeenCalled();

    globalThis.window = originalWindow;
    // @ts-expect-error cleanup
    delete globalThis.document;
  });
});
