import { z } from 'zod';
export * from './network-diagnostics';
import { networkTargetOrigin } from './network-diagnostics';

export const networkDiagnosticSchema = z.object({
  version: z.literal(1),
  category: z.enum(['offline', 'dns', 'connect', 'tls', 'timeout', 'cancelled', 'http', 'unknown']),
  targetOrigin: z.string().max(256).transform((value) => networkTargetOrigin(value)).optional(),
  networkAvailability: z.enum(['available', 'unavailable']),
  network: z.object({
    online: z.boolean().optional(), transport: z.enum(['wifi', 'cellular', 'ethernet', 'vpn', 'none', 'unknown']).optional(),
    effectiveType: z.enum(['slow-2g', '2g', '3g', '4g']).optional(), validated: z.boolean().optional(), metered: z.boolean().optional(), vpn: z.boolean().optional()
  }),
  timing: z.object({ availability: z.enum(['available', 'unavailable']), dnsMs: z.number().min(0).max(3600000).optional(), connectMs: z.number().min(0).max(3600000).optional(), ttfbMs: z.number().min(0).max(3600000).optional() }),
  recentChanges: z.array(z.object({ timestamp: z.number(), online: z.boolean().optional(), transport: z.enum(['wifi', 'cellular', 'ethernet', 'vpn', 'none', 'unknown']).optional() })).max(5)
});

export const sensitiveQueryKeys = new Set([
  'authorization',
  'auth',
  'cookie',
  'password',
  'secret',
  'token',
  'access_token',
  'refresh_token'
]);

export const breadcrumbSchema = z.object({
  type: z.enum(['navigation', 'click', 'http', 'manual']),
  message: z.string(),
  timestamp: z.number(),
  data: z.record(z.unknown()).optional()
});

export const deviceInfoSchema = z.object({
  model: z.string().optional(),
  system: z.string().optional(),
  screenWidth: z.number().optional(),
  screenHeight: z.number().optional(),
  language: z.string().optional(),
  userAgent: z.string().optional()
});

export const baseEventSchema = z.object({
  eventId: z.string().min(1),
  appKey: z.string().min(1),
  platform: z.enum([
    'web',
    'wechat-miniprogram',
    'alipay-miniprogram',
    'flutter',
    'uniapp-h5',
    'uniapp-wechat',
    'uniapp-alipay',
    'uniapp-douyin',
    'uniapp-app',
    'uniapp'
  ]),
  timestamp: z.number(),
  sessionId: z.string().min(1),
  userId: z.string().optional(),
  anonymousId: z.string().min(1),
  release: z.string().optional(),
  environment: z.enum(['development', 'test', 'production']).optional(),
  pageUrl: z.string().optional(),
  sdkVersion: z.string().min(1),
  deviceInfo: deviceInfoSchema.optional(),
  networkDiagnostic: networkDiagnosticSchema.optional()
});

export const errorEventSchema = baseEventSchema.extend({
  type: z.literal('error'),
  errorType: z.enum(['js', 'promise', 'resource', 'request', 'native']),
  message: z.string().min(1),
  stack: z.string().optional(),
  filename: z.string().optional(),
  lineno: z.number().optional(),
  colno: z.number().optional(),
  fingerprint: z.string().min(1),
  breadcrumbs: z.array(breadcrumbSchema),
  context: z.record(z.unknown()).refine((obj) => Object.keys(obj).length <= 20, { message: 'context must have at most 20 keys' }).optional(),
  page: z.string().optional(),
  scene: z.string().optional()
});

export const httpEventSchema = baseEventSchema.extend({
  type: z.literal('http'),
  method: z.string().min(1),
  url: z.string().min(1),
  status: z.number().optional(),
  duration: z.number().nonnegative(),
  success: z.boolean(),
  errorMessage: z.string().optional(),
  fingerprint: z.string().optional(),
  context: z.record(z.unknown()).refine((obj) => Object.keys(obj).length <= 20, { message: 'context must have at most 20 keys' }).optional(),
  requestData: z.record(z.unknown()).refine((obj) => Object.keys(obj).length <= 20, { message: 'requestData must have at most 20 keys' }).optional(),
  page: z.string().optional(),
  scene: z.string().optional()
});

export const performanceEventSchema = baseEventSchema.extend({
  type: z.literal('performance'),
  name: z.string().min(1),
  value: z.number(),
  rating: z.enum(['good', 'needs-improvement', 'poor']).optional()
});

export const breadcrumbEventSchema = baseEventSchema.extend({
  type: z.literal('breadcrumb'),
  breadcrumb: breadcrumbSchema
});

export const eventSchema = z.discriminatedUnion('type', [
  errorEventSchema,
  httpEventSchema,
  performanceEventSchema,
  breadcrumbEventSchema
]);

export const eventBatchSchema = z
  .object({
    appKey: z.string().min(1),
    events: z.array(eventSchema).min(1).max(50)
  })
  .superRefine((batch, context) => {
    for (const [index, event] of batch.events.entries()) {
      if (event.appKey !== batch.appKey) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['events', index, 'appKey'],
          message: 'event appKey must match batch appKey'
        });
      }
    }
  });

export type Breadcrumb = z.infer<typeof breadcrumbSchema>;
export type HealthGuardEvent = z.infer<typeof eventSchema>;
export type ErrorEvent = z.infer<typeof errorEventSchema>;
export type HttpEvent = z.infer<typeof httpEventSchema>;
export type EventBatch = z.infer<typeof eventBatchSchema>;

export interface FingerprintInput {
  errorType: ErrorEvent['errorType'];
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

export function parseEventBatch(input: unknown): EventBatch {
  const result = eventBatchSchema.safeParse(input);

  if (!result.success) {
    throw new Error(`Invalid event batch: ${result.error.issues.map((issue) => issue.message).join('; ')}`);
  }

  return result.data;
}

export function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, 'http://healthguard.local');

    for (const key of Array.from(url.searchParams.keys())) {
      if (sensitiveQueryKeys.has(key.toLowerCase())) {
        url.searchParams.set(key, '[Filtered]');
      }
    }

    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      return url.toString();
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return rawUrl;
  }
}

export function createIssueFingerprint(input: FingerprintInput): string {
  const stackHead = input.stack?.split('\n').slice(0, 2).join('\n').trim() ?? '';
  let source = `${input.errorType}|${input.message}|${stackHead}`;

  if (input.context) {
    if (input.context.url) {
      let pathname: string;
      try {
        const urlObj = new URL(String(input.context.url), 'http://healthguard.local');
        pathname = urlObj.pathname;
      } catch {
        pathname = String(input.context.url).split('?')[0] ?? String(input.context.url);
      }
      source += `|${pathname}`;
    }
    if (input.context.method) source += `|${input.context.method}`;
    if (input.context.scene) source += `|${input.context.scene}`;
    if (input.context.page) source += `|${input.context.page}`;
  }

  return `${input.errorType}:${hashString(source)}`;
}

export function createHttpFingerprint(event: { method: string; url: string; status?: number; platform?: string }): string {
  const pathname = extractPathname(event.url);
  const source = `http|${event.method}|${pathname}|${event.status ?? 'unknown'}|${event.platform ?? 'unknown'}`;
  return `http:${hashString(source)}`;
}

export function extractPathname(url: string): string {
  try {
    return new URL(url, 'http://healthguard.local').pathname || url;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

function hashString(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}


// Reused by Dashboard, AI handoff and email so the same event has the same summary.
export function networkDiagnosticLines(event: { networkDiagnostic?: unknown }, language: 'zh' | 'en' = 'zh'): string[] {
  const parsed = networkDiagnosticSchema.safeParse(event.networkDiagnostic);
  if (!parsed.success) return [];
  const value = parsed.data;
  const zh = language === 'zh';
  const unavailable = zh ? '不可用' : 'Unavailable';
  const unknown = zh ? '未知' : 'Unknown';
  const categories = zh ? { offline: '设备报告离线', dns: 'DNS 解析失败', connect: '连接失败', tls: 'TLS 失败', timeout: '超时', cancelled: '请求取消', http: 'HTTP 错误响应', unknown: '原因未知' }
    : { offline: 'Device reports offline', dns: 'DNS failure', connect: 'Connection failure', tls: 'TLS failure', timeout: 'Timeout', cancelled: 'Cancelled', http: 'HTTP error response', unknown: 'Unknown cause' };
  const bool = (v?: boolean) => v === undefined ? unavailable : v ? (zh ? '是' : 'Yes') : (zh ? '否' : 'No');
  const timing = (v?: number) => v === undefined ? unavailable : `${v} ms`;
  return [
    `${zh ? '网络诊断' : 'Network diagnostic'}: ${categories[value.category]}`,
    `${zh ? '目标域' : 'Target origin'}: ${value.targetOrigin ?? unavailable}`,
    `${zh ? '网络状态' : 'Network state'}: ${value.network.transport ?? unavailable}; ${zh ? '在线' : 'Online'}=${bool(value.network.online)}; ${zh ? '系统验证联网' : 'OS validated'}=${bool(value.network.validated)}; VPN=${bool(value.network.vpn)}`,
    `DNS=${timing(value.timing.dnsMs)}; ${zh ? '连接' : 'Connect'}=${timing(value.timing.connectMs)}; TTFB=${timing(value.timing.ttfbMs)}`,
    `${zh ? '近两分钟网络变化' : 'Network changes in last two minutes'}: ${value.recentChanges.length ? value.recentChanges.map((c) => `${new Date(c.timestamp).toISOString()} ${c.transport ?? unknown} ${bool(c.online)}`).join('; ') : unavailable}`,
    zh ? '分类来自本次请求和设备线索，不等于已确认根因。' : 'Classification reflects this request and device hints; it is not a confirmed root cause.'
  ];
}
