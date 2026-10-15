import { describe, it, expect } from 'vitest';
import { renderToString } from '@vue/server-renderer';
import { networkDiagnosticLines } from '@health-guard/core';
import { renderNetworkDiagnostic } from './network-diagnostic';
const diagnostic = { version: 1, category: 'unknown', targetOrigin: 'https://api.example.com', networkAvailability: 'unavailable', network: {}, timing: { availability: 'unavailable' }, recentChanges: [] };
describe('diagnostic presentation', () => {
  it('renders unavailable evidence explicitly and does not turn network hints into a root cause', async () => {
    const vnode = renderNetworkDiagnostic({ networkDiagnostic: diagnostic }, 'zh');
    const html = await renderToString(vnode!);
    expect(html).toContain('原因未知');
    expect(html).toContain('不可用');
    expect(html).not.toContain('DNS 故障');
    expect(networkDiagnosticLines({ networkDiagnostic: diagnostic }, 'en').join(' ')).toContain('Unknown');
  });
  it('handles old events and malicious diagnostic URLs safely', () => {
    expect(renderNetworkDiagnostic({}, 'zh')).toBeNull();
    const text = networkDiagnosticLines({ networkDiagnostic: { ...diagnostic, targetOrigin: 'https://user:secret@api.example.com/v1?token=secret' } }, 'zh').join(' ');
    expect(text).not.toContain('secret');
    expect(text).toContain('https://api.example.com');
  });
});

it('does not throw when a malformed event contains an out-of-range timestamp', () => {
  expect(networkDiagnosticLines({ networkDiagnostic: { ...diagnostic, recentChanges: [{ timestamp: 1e100, online: false }] } }, 'zh')).toEqual([]);
});

it('renders original failure phase and independent probe times for old SDK payloads', async () => {
  const html = await renderToString(renderNetworkDiagnostic({ context: { originalError: { dioType: 'connectionTimeout' }, networkDiagnostics: { requestId: 'request-42', probes: { cached: true, sampledAt: 1000 } } } }, 'zh')!);
  expect(html).toContain('connectionTimeout');
  expect(html).toContain('request-42');
  expect(html).toContain('1970-01-01T00:00:01.000Z');
  expect(html).toContain('不是原请求');
});
