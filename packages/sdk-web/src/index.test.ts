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
});
