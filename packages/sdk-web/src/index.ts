import {
  createIssueFingerprint,
  sanitizeUrl,
  type Breadcrumb,
  type ErrorEvent as HealthGuardErrorEvent,
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
  environment?: HealthGuardErrorEvent['environment'];
  userId?: string;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  autoCapture?: boolean | AutoCaptureOptions;
  target?: BrowserLikeTarget;
  transport?: (batch: EventBatch, endpoint: string) => Promise<void>;
}

export interface HealthGuardClient {
  captureException(error: unknown): void;
  captureHttp(input: CaptureHttpInput): void;
  capturePerformance(input: CapturePerformanceInput): void;
  addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'> & { timestamp?: number }): void;
  flush(): Promise<void>;
}

export interface AutoCaptureOptions {
  errors?: boolean;
  unhandledRejections?: boolean;
  fetch?: boolean;
  xhr?: boolean;
}

export interface CapturePerformanceInput {
  name: string;
  value: number;
  rating?: 'good' | 'needs-improvement' | 'poor';
}

export interface BrowserLikeTarget {
  location?: {
    href: string;
  };
  addEventListener?: (type: string, listener: EventListener) => void;
  removeEventListener?: (type: string, listener: EventListener) => void;
  fetch?: typeof fetch;
  XMLHttpRequest?: any;
}

export function createHealthGuardClient(options: HealthGuardClientOptions): HealthGuardClient {
  const queue: EventBatch['events'] = [];
  const breadcrumbs: Breadcrumb[] = [];
  const sessionId = createId('session');
  const anonymousId = getAnonymousId();
  const maxBatchSize = options.maxBatchSize ?? 10;
  const transport = options.transport ?? defaultTransport;
  const target = options.target ?? getDefaultTarget();

  let timer: ReturnType<typeof setInterval> | undefined;

  async function flush(): Promise<void> {
    if (queue.length === 0) {
      return;
    }

    const events = queue.splice(0, maxBatchSize);
    try {
      await transport({ appKey: options.appKey, events }, options.endpoint);
    } catch (error) {
      queue.unshift(...events);
      throw error;
    }
  }

  function enqueue(event: EventBatch['events'][number]): void {
    queue.push(event);

    if (queue.length >= maxBatchSize) {
      void flush();
    }
  }

  function captureError(error: unknown, errorType: HealthGuardErrorEvent['errorType'], metadata: Partial<HealthGuardErrorEvent> = {}): void {
    const normalized = normalizeError(error);
    const message = metadata.message ?? normalized.message;
    const stack = metadata.stack ?? normalized.stack;

    enqueue({
      ...createBaseEvent(options, sessionId, anonymousId, target),
      type: 'error',
      errorType,
      message,
      stack,
      filename: metadata.filename,
      lineno: metadata.lineno,
      colno: metadata.colno,
      fingerprint: createIssueFingerprint({
        errorType,
        message,
        stack
      }),
      breadcrumbs: [...breadcrumbs]
    });
  }

  if ((options.flushIntervalMs ?? 5000) > 0) {
    timer = setInterval(() => {
      void flush();
    }, options.flushIntervalMs);
    timer.unref?.();
  }

  installAutoCapture(options, target, captureError, (input) => {
    enqueue({
      ...createBaseEvent(options, sessionId, anonymousId, target),
      type: 'http',
      method: input.method.toUpperCase(),
      url: sanitizeUrl(input.url),
      status: input.status,
      duration: input.duration,
      success: input.success,
      errorMessage: input.errorMessage
    });
  });

  return {
    captureException(error: unknown): void {
      captureError(error, 'js');
    },

    captureHttp(input: CaptureHttpInput): void {
      enqueue({
        ...createBaseEvent(options, sessionId, anonymousId, target),
        type: 'http',
        method: input.method.toUpperCase(),
        url: sanitizeUrl(input.url),
        status: input.status,
        duration: input.duration,
        success: input.success,
        errorMessage: input.errorMessage
      });
    },

    capturePerformance(input: CapturePerformanceInput): void {
      enqueue({
        ...createBaseEvent(options, sessionId, anonymousId, target),
        type: 'performance',
        name: input.name,
        value: input.value,
        rating: input.rating
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
  anonymousId: string,
  target?: BrowserLikeTarget
): Pick<
  HealthGuardErrorEvent,
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
    pageUrl: target?.location?.href
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

function getDefaultTarget(): BrowserLikeTarget | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window;
}

function normalizeAutoCapture(autoCapture: HealthGuardClientOptions['autoCapture']): Required<AutoCaptureOptions> {
  if (autoCapture === true) {
    return {
      errors: true,
      unhandledRejections: true,
      fetch: true,
      xhr: true
    };
  }

  if (!autoCapture) {
    return {
      errors: false,
      unhandledRejections: false,
      fetch: false,
      xhr: false
    };
  }

  return {
    errors: autoCapture?.errors ?? false,
    unhandledRejections: autoCapture?.unhandledRejections ?? false,
    fetch: autoCapture?.fetch ?? false,
    xhr: autoCapture?.xhr ?? false
  };
}

function installAutoCapture(
  options: HealthGuardClientOptions,
  target: BrowserLikeTarget | undefined,
  captureError: (
    error: unknown,
    errorType: HealthGuardErrorEvent['errorType'],
    metadata?: Partial<HealthGuardErrorEvent>
  ) => void,
  captureHttp: (input: CaptureHttpInput) => void
): void {
  if (!target) {
    return;
  }

  const autoCapture = normalizeAutoCapture(options.autoCapture);

  if (autoCapture.errors && target.addEventListener) {
    target.addEventListener('error', ((event: Event) => {
      const errorEvent = event as globalThis.ErrorEvent;
      const resourceFailure = getResourceFailure(event);

      if (resourceFailure) {
        captureError(resourceFailure.message, 'resource', {
          message: resourceFailure.message,
          filename: resourceFailure.url
        });
        return;
      }

      captureError(errorEvent.error ?? errorEvent.message, 'js', {
        message: errorEvent.message,
        filename: errorEvent.filename,
        lineno: errorEvent.lineno,
        colno: errorEvent.colno
      });
    }) as EventListener);
  }

  if (autoCapture.unhandledRejections && target.addEventListener) {
    target.addEventListener('unhandledrejection', ((event: Event) => {
      const rejectionEvent = event as PromiseRejectionEvent;
      captureError(rejectionEvent.reason, 'promise');
    }) as EventListener);
  }

  if (autoCapture.fetch && target.fetch) {
    const originalFetch = target.fetch.bind(target);

    target.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const startedAt = Date.now();
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const url = input instanceof Request ? input.url : input.toString();

      if (isCollectorEndpoint(url, options.endpoint)) {
        return originalFetch(input, init);
      }

      try {
        const response = await originalFetch(input, init);
        captureHttp({
          method,
          url,
          status: response.status,
          duration: Date.now() - startedAt,
          success: response.ok
        });
        return response;
      } catch (error) {
        captureHttp({
          method,
          url,
          duration: Date.now() - startedAt,
          success: false,
          errorMessage: normalizeError(error).message
        });
        throw error;
      }
    }) as typeof fetch;
  }

  if (autoCapture.xhr && target.XMLHttpRequest) {
    const OriginalXMLHttpRequest = target.XMLHttpRequest;

    target.XMLHttpRequest = function HealthGuardXMLHttpRequest() {
      const xhr = new OriginalXMLHttpRequest();
      let method = 'GET';
      let url = '';
      let startedAt = 0;
      const originalOpen = xhr.open;
      const originalSend = xhr.send;
      const originalOnloadend = xhr.onloadend;

      xhr.open = function patchedOpen(this: XMLHttpRequest, nextMethod: string, nextUrl: string | URL, ...args: unknown[]) {
        method = nextMethod;
        url = nextUrl.toString();
        return originalOpen.apply(this, [nextMethod, nextUrl, ...args] as any);
      };

      xhr.send = function patchedSend(this: XMLHttpRequest, ...args: unknown[]) {
        startedAt = Date.now();
        return originalSend.apply(this, args as any);
      };

      xhr.onloadend = function patchedLoadEnd(this: XMLHttpRequest, event: ProgressEvent) {
        if (isCollectorEndpoint(url, options.endpoint)) {
          if (typeof originalOnloadend === 'function') {
            return originalOnloadend.call(this, event);
          }

          return undefined;
        }

        captureHttp({
          method,
          url,
          status: xhr.status,
          duration: Date.now() - startedAt,
          success: xhr.status < 400
        });

        if (typeof originalOnloadend === 'function') {
          return originalOnloadend.call(this, event);
        }

        return undefined;
      };

      return xhr;
    } as unknown as typeof XMLHttpRequest;
  }
}

function isCollectorEndpoint(url: string, endpoint: string): boolean {
  try {
    const current = new URL(url, 'http://healthguard.local');
    const collector = new URL(endpoint, 'http://healthguard.local');
    return current.pathname === collector.pathname;
  } catch {
    return url === endpoint;
  }
}

function getResourceFailure(event: Event): { message: string; url: string } | null {
  const target = event.target as { tagName?: string; src?: string; href?: string } | null;
  const tagName = target?.tagName;
  const rawUrl = target?.src ?? target?.href;

  if (!tagName || !rawUrl) {
    return null;
  }

  const url = sanitizeUrl(rawUrl);
  return {
    url,
    message: `Resource load failed: ${tagName} ${url}`
  };
}
