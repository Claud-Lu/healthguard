import { describe, expect, it } from 'vitest';
import { sdkIntegrationSnippet } from './sdk-integration';
describe('diagnostic SDK integration instructions', () => {
  it('gives Flutter actual SDK initialization and Dio attachment with an absolute collector URL', () => {
    const snippet = sdkIntegrationSnippet('flutter', 'demo', 'https://collector.example.com/api/events/batch');
    expect(snippet).toContain('healthguard_flutter');
    expect(snippet).toContain('await healthGuard.initialize()');
    expect(snippet).toContain('dio.interceptors.add(healthGuard.interceptor())');
    expect(snippet).toContain('https://collector.example.com/api/events/batch');
  });
  it.each(['web','uni-app','wechat-miniprogram','alipay-miniprogram'])('enables diagnostics for %s without adding business diagnostic code', (type) => {
    expect(sdkIntegrationSnippet(type, 'demo', 'https://collector.example.com/events')).toContain('networkDiagnostics: true');
  });
});
