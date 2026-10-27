import { deviceContextLines, deviceShortCode, httpEventSummary, networkDiagnosticLines, type HealthGuardEvent } from '@health-guard/core';
import type { AppRecord, IssueSummary, StoredEvent } from '../store/types';
import type { NotificationJob } from './types';

const labels = { new_issue: '新异常 / New issue', regression: '异常再次出现 / Regression', threshold: '达到次数阈值 / Threshold reached', test: '测试 / Test' };
const missing = '未上报 / Not reported';

function redactParameters(value: string): string {
  const params = new URLSearchParams(value);
  let changed = false;
  for (const key of new Set(params.keys())) {
    if (/^(authorization|auth|cookie|password|passwd|pwd|secret|token|accesstoken|refreshtoken|idtoken|apikey|sessionid)$/i.test(key.replace(/[-_]/g, ''))) {
      params.set(key, '[Filtered]'); changed = true;
    }
  }
  return changed ? params.toString() : value;
}

// Preserve the host, path and hash route, but never include URL credentials in email.
export function notificationAddress(value: string, base?: string): string {
  const raw = value.replace(/[\r\n\t]/g, '').trim();
  try {
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(raw);
    const resolved = base && /^https?:\/\//i.test(base) ? base : undefined;
    const url = absolute ? new URL(raw) : new URL(raw, resolved ?? 'https://healthguard.invalid/');
    if (!['http:', 'https:'].includes(url.protocol)) return '地址格式不支持 / Unsupported URL';
    url.username = ''; url.password = '';
    url.search = redactParameters(url.search.slice(1));
    const hash = url.hash.slice(1);
    const queryAt = hash.indexOf('?');
    url.hash = queryAt >= 0
      ? `${hash.slice(0, queryAt + 1)}${redactParameters(hash.slice(queryAt + 1))}`
      : hash.includes('=') ? redactParameters(hash) : hash;
    if (absolute || resolved) return url.href;
    if (raw.startsWith('//')) return `//${url.host}${url.pathname}${url.search}${url.hash}`;
    return `${raw.split(/[?#]/, 1)[0]}${url.search}${url.hash}`;
  } catch {
    return '地址无法解析 / Invalid URL';
  }
}

export function pageAddress(event: HealthGuardEvent): string | undefined {
  const context = 'context' in event ? event.context : undefined;
  return [event.pageUrl, 'page' in event ? event.page : undefined, context?.pageUrl, context?.page, context?.route]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

export function issueAlertContent(app: AppRecord, issue: IssueSummary, event: StoredEvent, reason: NotificationJob['reason'], dashboard?: string, createdAt = Date.now()): { subject: string; text: string } {
  const page = pageAddress(event);
  const browser = event.platform === 'web' || event.platform === 'uniapp-h5';
  const native = event.platform === 'uniapp-app' || event.platform === 'flutter';
  const pageLabel = browser ? '页面完整地址 / Page URL' : native ? 'App 页面路由 / App route' : '页面路由 / Page route';
  const lines = [
    labels[reason], '',
    `项目 / Project: ${app.name}`,
    ...(event.type === 'http' ? [
      `本次异常 / Current occurrence: ${httpEventSummary(event)}`,
      ...(issue.message === httpEventSummary(event) ? [] : [`历史聚合摘要 / Historical issue summary: ${issue.message.slice(0, 500)}`])
    ] : [`异常 / Issue: ${issue.message.slice(0, 500)}`]),
    `类型 / Type: ${issue.errorType}`,
    `平台 / Platform: ${event.platform}`,
    `环境 / Environment: ${event.environment ?? missing}`,
    `本次设备型号 / Event device model: ${event.deviceInfo?.model?.trim() || missing}`,
    `本次系统版本 / Event OS: ${event.deviceInfo?.system?.trim() || missing}`,
    ...deviceContextLines(event, 'zh'),
    ...deviceContextLines(event, 'en'),
    `累计次数 / Total count: ${issue.eventCount}`, ''
  ];
  if (event.type === 'http') {
    const address = notificationAddress(event.url, browser ? page : undefined);
    lines.push(
      `请求方法 / Method: ${event.method.toUpperCase()}`,
      `请求地址 / Request URL: ${address}`,
      ...(/^https?:\/\//i.test(address) ? [] : ['完整请求地址未上报 / Full request URL was not reported.']),
      `状态码 / Status: ${event.status ?? missing}`,
      `请求耗时 / Duration: ${event.duration} ms`,
      `请求错误 / Request error: ${event.errorMessage?.slice(0, 500) || '-'}`, ''
    );
  }
  lines.push(...networkDiagnosticLines(event, 'zh'), ...networkDiagnosticLines(event, 'en'));
  lines.push(
    `${pageLabel}: ${page ? notificationAddress(page) : missing}`, '',
    `本次版本 / Event release: ${event.release ?? missing}`,
    `客户端发生时间 / Client event time (UTC): ${new Date(event.timestamp).toISOString()}`,
    `服务器接收时间 / Server received (UTC): ${event.receivedAt == null ? "历史记录未保存 / Not recorded" : new Date(event.receivedAt).toISOString()}`,
    `邮件生成时间 / Notification created (UTC): ${new Date(createdAt).toISOString()}`,
    ...(event.receivedAt == null ? [] : [`接收与发生时间差 / Receipt minus event time: ${event.receivedAt - event.timestamp} ms`]),
    "时间说明 / Timing note: 发生时间由客户端上报；时间差可能来自补报、传输延迟或设备时钟偏差，不能单凭收信时间认定为刚发生或当前版本故障。 / Client time and receipt time can differ due to replay, transport delay or device clock skew; receiving an email does not establish a new failure or a current-release failure.",
    `最近发生 / Last seen (UTC): ${new Date(issue.lastSeenAt).toISOString()}`,
    `Event ID: ${event.eventId}`,
    `Issue ID: ${issue.id}`
  );
  if (dashboard) lines.push('', `查看项目 / View project: ${dashboard.replace(/\/$/, '')}/projects/${encodeURIComponent(app.appKey)}`);
  lines.push('', '可在 HealthGuard 通知设置中调整规则或关闭推送。');
  return { subject: `[HealthGuard][${issue.id}] ${labels[reason]} · ${app.name}${deviceShortCode(event) ? ` · ${deviceShortCode(event)}` : ''}`.replace(/[\r\n]/g, ' ').slice(0, 512), text: lines.join('\n') };
}
