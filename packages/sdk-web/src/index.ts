import {
  createIssueFingerprint,
  sanitizeUrl,
  type Breadcrumb,
  type ErrorEvent,
  type EventBatch
} from '@healthguard/core';

const SDK_VERSION = '0.1.0';

export interface CaptureHttpInput {
  method: string;
  url: string;
  status?: number;
  duration: number;
  success: boolean;
  errorMessage?: string;
}

export interface HealthGuardClientOptions {
  appKey: string;
  endpoint: string;
  release?: string;
  environment?: ErrorEvent['environment'];
  userId?: string;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  transport?: (batch: EventBatch, endpoint: string) => Promise<void>;
}

export interface HealthGuardClient {
  captureException(error: unknown): void;
  captureHttp(input: CaptureHttpInput): void;
  addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'> & { timestamp?: number }): void;
  flush(): Promise<void>;
}

export function createHealthGuardClient(options: HealthGuardClientOptions): HealthGuardClient {
  const queue: EventBatch['events'] = [];
  const breadcrumbs: Breadcrumb[] = [];
  const sessionId = createId('session');
  const anonymousId = getAnonymousId();
  const maxBatchSize = options.maxBatchSize ?? 10;
  const transport = options.transport ?? defaultTransport;

  let timer: ReturnType<typeof setInterval> | undefined;

  async function flush(): Promise<void> {
    if (queue.length === 0) {
      return;
    }

    const events = queue.splice(0, maxBatchSize);
    await transport({ appKey: options.appKey, events }, options.endpoint);
  }

  function enqueue(event: EventBatch['events'][number]): void {
    queue.push(event);

    if (queue.length >= maxBatchSize) {
      void flush();
    }
  }

  if ((options.flushIntervalMs ?? 5000) > 0) {
    timer = setInterval(() => {
      void flush();
    }, options.flushIntervalMs);
    timer.unref?.();
  }

  return {
    captureException(error: unknown): void {
      const normalized = normalizeError(error);
      enqueue({
        ...createBaseEvent(options, sessionId, anonymousId),
        type: 'error',
        errorType: 'js',
        message: normalized.message,
        stack: normalized.stack,
        fingerprint: createIssueFingerprint({
          errorType: 'js',
          message: normalized.message,
          stack: normalized.stack
        }),
        breadcrumbs: [...breadcrumbs]
      });
    },

    captureHttp(input: CaptureHttpInput): void {
      enqueue({
        ...createBaseEvent(options, sessionId, anonymousId),
        type: 'http',
        method: input.method.toUpperCase(),
        url: sanitizeUrl(input.url),
        status: input.status,
        duration: input.duration,
        success: input.success,
        errorMessage: input.errorMessage
      });
    },

    addBreadcrumb(input): void {
      breadcrumbs.push({
        ...input,
        timestamp: input.timestamp ?? Date.now()
      });

      if (breadcrumbs.length > 30) {
        breadcrumbs.shift();
      }
    },

    async flush(): Promise<void> {
      if (timer && queue.length === 0) {
        clearInterval(timer);
        timer = undefined;
      }

      await flush();
    }
  };
}

function createBaseEvent(
  options: HealthGuardClientOptions,
  sessionId: string,
  anonymousId: string
): Pick<
  ErrorEvent,
  | 'eventId'
  | 'appKey'
  | 'platform'
  | 'timestamp'
  | 'sessionId'
  | 'anonymousId'
  | 'sdkVersion'
  | 'release'
  | 'environment'
  | 'userId'
  | 'pageUrl'
> {
  return {
    eventId: createId('evt'),
    appKey: options.appKey,
    platform: 'web',
    timestamp: Date.now(),
    sessionId,
    anonymousId,
    sdkVersion: SDK_VERSION,
    release: options.release,
    environment: options.environment,
    userId: options.userId,
    pageUrl: typeof window === 'undefined' ? undefined : window.location.href
  };
}

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: typeof error === 'string' ? error : JSON.stringify(error)
  };
}

async function defaultTransport(batch: EventBatch, endpoint: string): Promise<void> {
  await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(batch),
    keepalive: true
  });
}

function getAnonymousId(): string {
  const storageKey = 'healthguard_anonymous_id';

  try {
    const existing = globalThis.localStorage?.getItem(storageKey);
    if (existing) {
      return existing;
    }

    const created = createId('anon');
    globalThis.localStorage?.setItem(storageKey, created);
    return created;
  } catch {
    return createId('anon');
  }
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
