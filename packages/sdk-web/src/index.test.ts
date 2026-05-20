import { describe, expect, it, vi } from 'vitest';
import { createHealthGuardClient } from './index';

describe('sdk-web client', () => {
  it('queues captured exceptions and flushes them through the configured transport', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const client = createHealthGuardClient({
      appKey: 'demo-app',
      endpoint: 'https://collector.example.com/api/events/batch',
      transport,
      flushIntervalMs: 0
    });

    client.captureException(new Error('boom'));
    await client.flush();

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      appKey: 'demo-app',
      platform: 'web',
      type: 'error',
      errorType: 'js',
      message: 'boom'
    });
  });

  it('sanitizes request urls before enqueueing http events', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const client = createHealthGuardClient({
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

  it('captures window error events when auto capture is enabled', async () => {
    const listeners = new Map<string, EventListener>();
    const transport = vi.fn().mockResolvedValue(undefined);
    const target = {
      location: { href: 'https://demo.example.com/' },
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn()
    };
    const client = createHealthGuardClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
      transport,
      flushIntervalMs: 0,
      autoCapture: true,
      target
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
  });

  it('captures unhandled promise rejections when auto capture is enabled', async () => {
    const listeners = new Map<string, EventListener>();
    const transport = vi.fn().mockResolvedValue(undefined);
    const target = {
      location: { href: 'https://demo.example.com/' },
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn()
    };
    const client = createHealthGuardClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
      transport,
      flushIntervalMs: 0,
      autoCapture: true,
      target
    });

    listeners.get('unhandledrejection')?.({
      reason: new Error('promise boom')
    } as unknown as Event);
    await client.flush();

    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      type: 'error',
      errorType: 'promise',
      message: 'promise boom'
    });
  });

  it('captures failed fetch requests when fetch monitoring is enabled', async () => {
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
    const client = createHealthGuardClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
      transport,
      flushIntervalMs: 0,
      autoCapture: { fetch: true },
      target
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
    const client = createHealthGuardClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
      transport,
      flushIntervalMs: 0,
      autoCapture: { fetch: true },
      target
    });

    await target.fetch('/api/events/batch', { method: 'POST' });
    await client.flush();

    expect(transport).not.toHaveBeenCalled();
  });

  it('captures resource load failures separately from JavaScript errors', async () => {
    const listeners = new Map<string, EventListener>();
    const transport = vi.fn().mockResolvedValue(undefined);
    const target = {
      location: { href: 'https://demo.example.com/' },
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn()
    };
    const client = createHealthGuardClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
      transport,
      flushIntervalMs: 0,
      autoCapture: { errors: true },
      target
    });

    listeners.get('error')?.({
      target: {
        tagName: 'IMG',
        src: 'https://cdn.example.com/avatar.png?token=abc'
      }
    } as unknown as Event);
    await client.flush();

    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      type: 'error',
      errorType: 'resource',
      message: 'Resource load failed: IMG https://cdn.example.com/avatar.png?token=%5BFiltered%5D',
      filename: 'https://cdn.example.com/avatar.png?token=%5BFiltered%5D'
    });
  });

  it('captures XMLHttpRequest failures when XHR monitoring is enabled', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    class FakeXMLHttpRequest {
      static instances: FakeXMLHttpRequest[] = [];
      method = 'GET';
      url = '';
      status = 0;
      onloadend: (() => void) | null = null;

      constructor() {
        FakeXMLHttpRequest.instances.push(this);
      }

      open(method: string, url: string): void {
        this.method = method;
        this.url = url;
      }

      send(): void {}
    }
    const target = {
      location: { href: 'https://demo.example.com/' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      XMLHttpRequest: FakeXMLHttpRequest
    };
    const client = createHealthGuardClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
      transport,
      flushIntervalMs: 0,
      autoCapture: { xhr: true },
      target
    });

    const xhr = new target.XMLHttpRequest();
    xhr.open('POST', 'https://api.example.com/legacy?password=secret');
    xhr.status = 500;
    xhr.send();
    xhr.onloadend?.();
    await client.flush();

    expect(transport.mock.calls[0][0].events[0]).toMatchObject({
      type: 'http',
      method: 'POST',
      url: 'https://api.example.com/legacy?password=%5BFiltered%5D',
      status: 500,
      success: false
    });
  });

  it('keeps events queued when transport fails so they can be retried', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(undefined);
    const client = createHealthGuardClient({
      appKey: 'demo-app',
      endpoint: '/api/events/batch',
      transport,
      flushIntervalMs: 0
    });

    client.captureException(new Error('retry me'));
    await expect(client.flush()).rejects.toThrow('network down');
    await client.flush();

    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][0].events[0]).toMatchObject({
      type: 'error',
      message: 'retry me'
    });
  });

  it('captures manual performance metrics', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const client = createHealthGuardClient({
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
});
