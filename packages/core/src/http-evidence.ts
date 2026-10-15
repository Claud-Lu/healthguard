import type { HttpEvent } from './index';
import { networkTargetOrigin } from './network-diagnostics';

type Evidence = Pick<HttpEvent, 'method' | 'url'> & Partial<Pick<HttpEvent, 'status' | 'platform' | 'environment' | 'context' | 'networkDiagnostic' | 'errorMessage'>>;
const phases: Record<string, string> = { connectionTimeout: 'connection_timeout', sendTimeout: 'send_timeout', receiveTimeout: 'response_timeout', badCertificate: 'tls', cancel: 'cancelled', connectionError: 'connect', unknown: 'unknown' };
export function evidenceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function httpFailurePhase(event: Partial<Evidence>): string {
  if (event.status !== undefined && event.status >= 400) return 'http';
  const original = evidenceRecord(event.context?.originalError);
  if (original.dioType === 'connectionError' && original.underlyingType === 'SocketException' && typeof original.message === 'string' && /failed host lookup|name or service not known|no address associated with hostname/i.test(original.message.slice(0, 500))) return 'dns';
  if (typeof original.dioType === 'string' && Object.prototype.hasOwnProperty.call(phases, original.dioType)) return phases[original.dioType];
  const diagnostic = evidenceRecord(event.networkDiagnostic);
  return ['offline', 'dns', 'connect', 'tls', 'timeout', 'cancelled', 'http'].includes(String(diagnostic.category)) ? String(diagnostic.category) : 'unknown';
}
export function httpTarget(event: Pick<Evidence, 'url'>): string {
  try {
    const uri = new URL(event.url, 'https://healthguard.invalid');
    if (!['http:', 'https:'].includes(uri.protocol)) return '[Unavailable]';
    return `${networkTargetOrigin(event.url) ?? ''}${uri.pathname}`;
  } catch { return '[Unavailable]'; }
}
export function evidenceText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t]/g, ' ').replace(/https?:\/\/[^\s)]+/gi, url => httpTarget({ url }))
    .replace(/(Bearer\s+)[^\s,;]+/gi, '$1[Filtered]')
    .replace(/((?:token|password|secret|authorization|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[Filtered]').slice(0, 500);
}
export function httpEventSummary(event: Evidence): string {
  const original = evidenceRecord(event.context?.originalError);
  const message = evidenceText(original.message ?? event.errorMessage);
  return `${event.method.toUpperCase()} ${httpTarget(event)} [${httpFailurePhase(event)}${event.status === undefined ? '' : `; HTTP ${event.status}`}]${message ? ` - ${message}` : ''}`;
}
export function httpOccurrenceLines(event: { context?: unknown }, language: 'zh' | 'en'): string[] {
  const context = evidenceRecord(event.context), original = evidenceRecord(context.originalError);
  const diagnostic = evidenceRecord(context.networkDiagnostics), trace = evidenceRecord(context.requestTrace);
  const zh = language === 'zh';
  const lines: string[] = [];
  if (typeof original.dioType === 'string') lines.push(`${zh ? '本次原始错误' : 'Original request error'}: ${evidenceText(original.dioType)}`);
  if (typeof diagnostic.requestId === 'string' || typeof trace.requestId === 'string') lines.push(`${zh ? '请求编号' : 'Request ID'}: ${evidenceText(diagnostic.requestId ?? trace.requestId)}`);
  if (trace.source === 'original_request') {
    const acquisition = evidenceRecord(trace.connectionAcquisition);
    lines.push(`${zh ? '原请求连接等待' : 'Original connection acquisition'}: ${evidenceText(acquisition.outcome)}; ${typeof acquisition.durationMs === 'number' ? acquisition.durationMs + ' ms' : (zh ? '不可用' : 'Unavailable')}`);
    lines.push(zh ? '原请求 DNS/TCP/TLS 未分段测量；连接等待可能包含连接池等待和握手。' : 'Original DNS/TCP/TLS phases are not individually measured; acquisition can include pool wait and handshakes.');
  }
  const probes = evidenceRecord(diagnostic.probes);
  if (typeof probes.sampledAt === 'number' && Number.isFinite(probes.sampledAt) && Math.abs(probes.sampledAt) <= 8640000000000000) {
    lines.push(`${zh ? '独立探测采样时间' : 'Independent probe sampled at'}: ${new Date(probes.sampledAt).toISOString()}; ${zh ? '缓存' : 'Cached'}=${probes.cached === true}`);
    lines.push(zh ? '独立探测不是原请求的 DNS/TCP/TLS 耗时，成功不能反证原请求正常。' : 'Independent probes are not the original DNS/TCP/TLS timings; success does not prove the failed request was healthy.');
  }
  return lines;
}
