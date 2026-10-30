import { describe, expect, it, vi } from 'vitest';
import { createHealthGuardClient, installVueErrorHandler, sanitizeWebDiagnosticUrl } from './index';
import { describeWebDevice, sanitizeWebValue } from './web-diagnostics';
import type { HealthGuardClient } from './index';

function browser() {
  const listeners = new Map<string, EventListener>();
  return {
    location: { href: 'https://app.example.com/#/download?type=passenger&token=page-secret' },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 10; ExamplePhone Build/EXAMPLE) Chrome/121.0 MQQBrowser/20.7', onLine: true },
    document: { scripts: [{ src: 'https://app.example.com/assets/main.123.js', crossOrigin: 'anonymous' }], visibilityState: 'visible' },
    performance: { getEntriesByName: () => [], getEntriesByType: () => [{ name: 'https://app.example.com/assets/download.456.js', initiatorType: 'script' }] },
    addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type: string, listener: EventListener) => { if (listeners.get(type) === listener) listeners.delete(type); }),
    listeners
  };
}

describe('SDK-owned browser diagnostics', () => {
  it('captures the failure scene inside the SDK, before later navigation or script loading', async () => {
    const target = browser();
    const transport = vi.fn().mockResolvedValue(undefined);
    const client = createHealthGuardClient({ appKey: 'demo-app', endpoint: 'https://collector.example.com/events', release: 'demo-build', autoCapture: true, target, transport, flushIntervalMs: 0 });
    target.listeners.get('error')?.({ message: 'Script error.', error: null, filename: '', lineno: 0, colno: 0 } as unknown as Event);
    target.location.href = 'https://app.example.com/#/after-error';
    target.document.scripts.push({ src: 'https://app.example.com/assets/after-error.js', crossOrigin: '' });
    await client.flush();
    const event = transport.mock.calls[0][0].events[0];
    expect(event.deviceInfo).toMatchObject({ model: 'ExamplePhone', system: 'Android 10' });
    const context = event.breadcrumbs.find((item: { message: string }) => item.message === 'web.error-context').data;
    expect(context).toMatchObject({ integration: 'sdk-web', release: 'demo-build', browser: 'QQBrowser 20.7', errorVisibility: 'opaque' });
    expect(context.pageUrl).toContain('/download');
    expect(context.scripts).toContainEqual({ url: 'https://app.example.com/assets/download.456.js' });
    expect(JSON.stringify(event)).not.toContain('after-error');
    expect(JSON.stringify(event)).not.toContain('page-secret');
    client.dispose();
  });

  it('keeps each error context isolated without changing the original exception or fingerprint', async () => {
    const target = browser();
    const transport = vi.fn().mockResolvedValue(undefined);
    const client = createHealthGuardClient({ appKey: 'demo-app', endpoint: '/events', target, transport, flushIntervalMs: 0 });
    const error = new Error('ordinary failure');
    client.captureException(error);
    target.location.href = 'https://app.example.com/#/second';
    client.captureException(error);
    await client.flush();
    const [first, second] = transport.mock.calls[0][0].events;
    expect(first.stack).toBe(error.stack);
    expect(first.fingerprint).toBe(second.fingerprint);
    for (const event of [first, second]) expect(event.breadcrumbs.filter((item: { message: string }) => item.message === 'web.error-context')).toHaveLength(1);
    expect(first.breadcrumbs.at(-1).data.pageUrl).toContain('/download');
    expect(second.breadcrumbs.at(-1).data.pageUrl).toContain('/second');
    client.dispose();
  });

  it('records bounded route, action and HTTP metadata without reading input or request bodies', async () => {
    const target = browser();
    const transport = vi.fn().mockResolvedValue(undefined);
    const client = createHealthGuardClient({ appKey: 'demo-app', endpoint: '/events', target, transport, autoCapture: true, flushIntervalMs: 0 });
    target.listeners.get('click')?.({ target: { value: 'private-input', textContent: 'private-text', closest: () => ({ tagName: 'BUTTON', getAttribute: (name: string) => name === 'data-healthguard-action' ? 'download-passenger' : null }) } } as unknown as Event);
    target.listeners.get('hashchange')?.({ oldURL: target.location.href, newURL: 'https://app.example.com/#/next?phone=13800138000' } as unknown as Event);
    client.captureHttp({ method: 'GET', url: 'https://api.example.com/items?code=123456', status: 200, duration: 25, success: true });
    client.captureException(new Error('failure after request'));
    await client.flush();
    const event = transport.mock.calls[0][0].events.find((item: { type: string }) => item.type === 'error');
    expect(event.breadcrumbs).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'click', message: 'download-passenger' }), expect.objectContaining({ type: 'navigation' }), expect.objectContaining({ type: 'http', data: expect.objectContaining({ status: 200, duration: 25 }) })]));
    for (const value of ['private-input', 'private-text', '13800138000', '123456', 'page-secret']) expect(JSON.stringify(event)).not.toContain(value);
    client.dispose();
  });

  it('redacts all outgoing event fields even for custom transports and keeps random SDK session IDs', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const target = browser();
    target.location.href = 'https://user:password@example.com/#/page?accessToken=access-secret';
    const client = createHealthGuardClient({ appKey: 'demo-app', endpoint: '/events', target, transport, flushIntervalMs: 0 });
    client.addBreadcrumb({ type: 'manual', message: 'manual', data: { authorization: 'Bearer nested-secret', nested: { url: 'https://api.example.com/items?phone=13800138000' } } });
    const error = new Error('failure');
    error.stack = 'Error at https://app.example.com/assets/main.js?token=stack-secret:10:2';
    client.captureException(error);
    await client.flush();
    const event = transport.mock.calls[0][0].events[0];
    for (const value of ['user:password', 'access-secret', 'nested-secret', '13800138000', 'stack-secret']) expect(JSON.stringify(event)).not.toContain(value);
    expect(event.sessionId).toMatch(/^session_/);
    expect(error.stack).toContain('stack-secret');
    client.dispose();
  });

  it('provides a reusable Vue adapter that preserves the existing handler and avoids duplicate registration', async () => {
    const target = browser();
    const transport = vi.fn().mockResolvedValue(undefined);
    const previous = vi.fn();
    const app = { config: { errorHandler: previous } };
    const client = createHealthGuardClient({ appKey: 'demo-app', endpoint: '/events', buildRelease: 'exact-build', release: '1.0', target, transport, flushIntervalMs: 0 });
    const cleanup = installVueErrorHandler(app, client);
    expect(installVueErrorHandler(app, client)).toBe(cleanup);
    const error = new Error('Vue component failure');
    const instance = { $options: { __name: 'DownloadPage' }, password: 'component-state-secret' };
    app.config.errorHandler(error, instance, 'mounted hook');
    await client.flush();
    const events = transport.mock.calls[0][0].events;
    expect(events).toHaveLength(1);
    expect(events[0].stack).toBe(error.stack);
    expect(events[0].breadcrumbs.at(-1).data).toMatchObject({ buildRelease: 'exact-build', component: 'DownloadPage', phase: 'mounted hook' });
    expect(JSON.stringify(events)).not.toContain('component-state-secret');
    expect(previous).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalledWith(error, instance, 'mounted hook');
    cleanup();
    expect(app.config.errorHandler).toBe(previous);
    client.dispose();
  });

  it('cleans up browser observers and fetch hooks, honors opt-out, and bounds history', async () => {
    const target = { ...browser(), fetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }) };
    const original = target.fetch;
    const transport = vi.fn().mockResolvedValue(undefined);
    const client = createHealthGuardClient({ appKey: 'demo-app', endpoint: '/events', target, transport, autoCapture: true, flushIntervalMs: 0 });
    for (let i = 0; i < 50; i++) client.addBreadcrumb({ type: 'manual', message: `step-${i}` });
    client.captureException(new Error('bounded history'));
    await client.flush();
    expect(transport.mock.calls[0][0].events[0].breadcrumbs).toHaveLength(30);
    client.dispose();
    expect(target.fetch).toBe(original);
    expect(target.listeners.size).toBe(0);
    client.captureException(new Error('after dispose'));
    await client.flush();
    expect(transport).toHaveBeenCalledTimes(1);
    const disabledTransport = vi.fn().mockResolvedValue(undefined);
    const disabled = createHealthGuardClient({ appKey: 'demo-app', endpoint: '/events', target, transport: disabledTransport, autoCapture: true, webDiagnostics: false, flushIntervalMs: 0 });
    expect(target.listeners.has('click')).toBe(false);
    disabled.captureException(new Error('no browser diagnostics'));
    await disabled.flush();
    expect(disabledTransport.mock.calls[0][0].events[0].breadcrumbs).toEqual([]);
    disabled.dispose();
  });

  it('keeps Vue handling functional when metadata or monitoring fails and preserves a later handler', () => {
    const captureException = vi.fn(() => { throw new Error('monitor unavailable'); });
    const client = { captureException } as unknown as HealthGuardClient;
    const previous = vi.fn(() => 'handled');
    const app: { config: { errorHandler?: (...args: any[]) => any } } = { config: { errorHandler: previous } };
    const cleanup = installVueErrorHandler(app, client);
    const instance = Object.defineProperty({}, '$options', { get() { throw new Error('metadata unavailable'); } });
    expect(app.config.errorHandler?.(new Error('original'), instance, 'mounted')).toBe('handled');
    expect(previous).toHaveBeenCalledTimes(1);
    const later = () => undefined;
    app.config.errorHandler = later;
    cleanup();
    expect(app.config.errorHandler).toBe(later);
    const noHandler: { config: { errorHandler?: (...args: any[]) => any } } = { config: {} };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const restore = installVueErrorHandler(noHandler, client);
      const error = new Error('unhandled component failure');
      noHandler.config.errorHandler?.(error, null, 'mounted');
      expect(errorLog).toHaveBeenCalledWith(error);
      restore();
      expect(noHandler.config.errorHandler).toBeUndefined();
    } finally { errorLog.mockRestore(); }
  });

  it('does not drop an application error while another batch is in flight', async () => {
    let acknowledge: (() => void) | undefined;
    const transport = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { acknowledge = resolve; })).mockResolvedValue(undefined);
    const client = createHealthGuardClient({ appKey: 'demo-app', endpoint: '/events', transport, flushIntervalMs: 0 });
    client.captureException(new Error('first failure'));
    const flushing = client.flush();
    client.captureException(new Error('second failure during upload'));
    acknowledge?.();
    await flushing;
    await client.flush();
    expect(transport.mock.calls.map(call => call[0].events[0].message)).toEqual(['first failure', 'second failure during upload']);
    client.dispose();
  });

  it('uses normal fetch for large diagnostic batches instead of exceeding the keepalive quota', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetcher);
    const client = createHealthGuardClient({ appKey: 'demo-app', endpoint: 'https://collector.example.com/events', flushIntervalMs: 0, maxBatchSize: 100 });
    try {
      client.captureException(new Error('small failure'));
      await client.flush();
      expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', keepalive: true });
      for (let i = 0; i < 3; i++) client.captureException(new Error(`large failure ${i} ${'x'.repeat(16000)}`));
      await client.flush();
      expect(fetcher.mock.calls[1][1].keepalive).toBe(false);
    } finally { client.dispose(); vi.unstubAllGlobals(); }
  });

  it('handles SSR, missing browser APIs, unknown models, and malformed or nested diagnostic values safely', async () => {
    expect(describeWebDevice('')).toEqual({ model: undefined, system: undefined, browser: 'Unknown' });
    expect(describeWebDevice('iPhone; CPU iPhone OS 17_2 like Mac OS X) Version/17.2 Safari')).toMatchObject({ model: 'iPhone', system: 'iOS 17.2', browser: 'Safari 17.2' });
    expect(describeWebDevice('Chrome/121.0 MicroMessenger/8.0')).toMatchObject({ browser: 'WeChat 8.0' });
    expect(describeWebDevice('Chrome/121.0 Edg/121.0')).toMatchObject({ browser: 'Edge 121.0' });
    expect(sanitizeWebDiagnosticUrl('demo.js?token=secret')).toBe('demo.js?token=%5BFiltered%5D');
    expect(sanitizeWebDiagnosticUrl('//user:password@example.com/a?token=secret')).toBe('//example.com/a?token=%5BFiltered%5D');
    expect(sanitizeWebDiagnosticUrl('http://[invalid?token=secret')).not.toContain('=secret');
    expect(sanitizeWebDiagnosticUrl('https://url-user:url-password@[invalid?token=secret')).not.toContain('url-password');
    const cyclic: { child?: unknown } = {};
    cyclic.child = cyclic;
    expect(JSON.stringify(sanitizeWebValue(cyclic))).toContain('[Truncated]');
    const transport = vi.fn().mockResolvedValue(undefined);
    const target = browser();
    Object.defineProperty(target.document, 'scripts', { get() { throw new Error('restricted browser'); } });
    const client = createHealthGuardClient({ appKey: 'demo-app', endpoint: '/events', target, transport, flushIntervalMs: 0 });
    client.captureException(new Error('restricted browser original error'));
    await client.flush();
    expect(transport.mock.calls[0][0].events[0].message).toBe('restricted browser original error');
    client.dispose();
  });
});
