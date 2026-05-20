import { z } from 'zod';

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

export const baseEventSchema = z.object({
  eventId: z.string().min(1),
  appKey: z.string().min(1),
  platform: z.enum(['web', 'wechat-miniprogram', 'flutter']),
  timestamp: z.number(),
  sessionId: z.string().min(1),
  userId: z.string().optional(),
  anonymousId: z.string().min(1),
  release: z.string().optional(),
  environment: z.enum(['development', 'test', 'production']).optional(),
  pageUrl: z.string().optional(),
  sdkVersion: z.string().min(1)
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
  breadcrumbs: z.array(breadcrumbSchema)
});

export const httpEventSchema = baseEventSchema.extend({
  type: z.literal('http'),
  method: z.string().min(1),
  url: z.string().min(1),
  status: z.number().optional(),
  duration: z.number().nonnegative(),
  success: z.boolean(),
  errorMessage: z.string().optional()
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
  const source = `${input.errorType}|${input.message}|${stackHead}`;
  return `${input.errorType}:${hashString(source)}`;
}

function hashString(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}
