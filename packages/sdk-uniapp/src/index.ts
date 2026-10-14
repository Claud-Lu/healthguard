import { createNetworkDiagnosticCollector, createDiagnosticBuffer, type NetworkDiagnosticsOptions, type NetworkCategory } from '../../core/src/network-diagnostics';
import {
  createIssueFingerprint,
  sanitizeUrl,
  type Breadcrumb,
  type ErrorEvent,
  type EventBatch
} from '@health-guard/core';

const SDK_VERSION = '0.4.0';

// uni-app exposes this as a global API, not as a method on `uni`.
declare const getCurrentPages: undefined | (() => Array<{ route?: string; __route__?: string; $page?: { fullPath?: string } }>);

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

export interface CaptureHttpInput {
  method: string;
  url: string;
  status?: number;
  duration: number;
  requestStartedAt?: number;
  success: boolean;
  errorMessage?: string;
  failureKind?: NetworkCategory;
}

export interface CapturePerformanceInput {
  name: string;
  value: number;
  rating?: 'good' | 'needs-improvement' | 'poor';
}

export interface UniAppAutoCaptureOptions {
  errors?: boolean;
  unhandledRejections?: boolean;
  fetch?: boolean;
  xhr?: boolean;
  request?: boolean;
}

export interface UniAppClientOptions {
  networkDiagnostics?: boolean | NetworkDiagnosticsOptions;
  appKey: string;
  endpoint: string;
  release?: string;
  environment?: ErrorEvent['environment'];
  userId?: string;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  transportFailureRetryDelayMs?: number;
  autoCapture?: boolean | UniAppAutoCaptureOptions;
  transport?: (batch: EventBatch, endpoint: string) => Promise<void>;
}

export interface UniAppClient {
  captureException(error: unknown): void;
  captureHttp(input: CaptureHttpInput): void;
  capturePerformance(input: CapturePerformanceInput): void;
  addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'> & { timestamp?: number }): void;
  dispose(): void;
  flush(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*                               Platform detection                           */
/* -------------------------------------------------------------------------- */

function detectPlatform(): string {
  // H5 / Browser
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return 'uniapp-h5';
  }

  // Mini-program or App runtime
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uniGlobal = (globalThis as any).uni;
    if (uniGlobal && typeof uniGlobal.getSystemInfoSync === 'function') {
      const info = uniGlobal.getSystemInfoSync();
      const platform = info?.uniPlatform || info?.platform;

      if (platform === 'mp-weixin') return 'uniapp-wechat';
      if (platform === 'mp-alipay') return 'uniapp-alipay';
      if (platform === 'mp-douyin' || platform === 'mp-toutiao') return 'uniapp-douyin';
      if (platform === 'app' || platform === 'app-plus') return 'uniapp-app';
      if (platform === 'web') return 'uniapp-h5';
    }
  } catch {
    // ignore
  }

  return 'uniapp';
}

function isH5(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function getUniAppDeviceInfo() {
  // H5 / Browser
  if (typeof navigator !== 'undefined' && typeof window !== 'undefined') {
    return {
      userAgent: navigator.userAgent,
      language: navigator.language,
      screenWidth: window.screen?.width,
      screenHeight: window.screen?.height
    };
  }

  // Mini-program or App runtime
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uniGlobal = (globalThis as any).uni;
    if (uniGlobal && typeof uniGlobal.getSystemInfoSync === 'function') {
      const info = uniGlobal.getSystemInfoSync();
      return {
        model: info.model,
        system: info.system,
        screenWidth: info.screenWidth,
        screenHeight: info.screenHeight,
        language: info.language
      };
    }
  } catch {
    // ignore
  }

  return undefined;
}

/* -------------------------------------------------------------------------- */
/*                                 Storage helpers                            */
/* -------------------------------------------------------------------------- */

function getStorageItem(key: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uniGlobal = (globalThis as any).uni;
    if (uniGlobal && typeof uniGlobal.getStorageSync === 'function') {
      const value = uniGlobal.getStorageSync(key);
      return value ?? null;
    }
  } catch {
    // ignore
  }

  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(key);
  }

  return null;
}

function setStorageItem(key: string, value: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uniGlobal = (globalThis as any).uni;
    if (uniGlobal && typeof uniGlobal.setStorageSync === 'function') {
      uniGlobal.setStorageSync(key, value);
      return;
    }
  } catch {
    // ignore
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, value);
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Page URL                                   */
/* -------------------------------------------------------------------------- */

function getCurrentPageUrl(): string | undefined {
  if (isH5() && window.location) {
    return window.location.href;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uniGlobal = (globalThis as any).uni;
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : uniGlobal?.getCurrentPages?.();
    if (Array.isArray(pages) && pages.length > 0) {
      const page = pages[pages.length - 1];
      const route = page?.$page?.fullPath || page?.route || page?.__route__;
      if (typeof route === 'string' && route) {
        return `/${route.replace(/^\/+/, '')}`;
      }
    }
  } catch {
    // ignore
  }

  return undefined;
}

function isSdkInternalError(message: string | undefined): boolean {
  if (!message) {
    return false;
  }
  return (
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('healthguard')
  );
}

/* -------------------------------------------------------------------------- */
/*                               Default transport                            */
/* -------------------------------------------------------------------------- */

async function defaultTransport(batch: EventBatch, endpoint: string, requireAcknowledgement = false): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uniGlobal = (globalThis as any).uni;

  if (uniGlobal && typeof uniGlobal.request === 'function') {
    await new Promise<void>((resolve, reject) => {
      uniGlobal.request({
        url: endpoint,
        method: 'POST',
        header: { 'content-type': 'application/json' },
        data: batch,
        success: (response: { statusCode?: number; data?: { accepted?: number } }) => {
          if (requireAcknowledgement && (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300 || response.data?.accepted !== batch.events.length)) {
            reject(new Error('Collector did not acknowledge the batch')); return;
          }
          resolve();
        },
        fail: (err: { errMsg?: string }) => {
          reject(new Error(err?.errMsg || 'uni.request failed'));
        }
      });
    });
    return;
  }

  // Fallback for pure H5 environments
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(batch),
    keepalive: true
  });

  if (!response.ok) {
    throw new Error(`Transport failed: ${response.status}`);
  }
  if (requireAcknowledgement) {
    const body = await response.json();
    if (body?.accepted !== batch.events.length) throw new Error('Collector did not acknowledge the batch');
  }
}

/* -------------------------------------------------------------------------- */
/*                               Client factory                               */
/* -------------------------------------------------------------------------- */

export function createUniAppClient(options: UniAppClientOptions): UniAppClient {
  const queue: EventBatch['events'] = [];
  const breadcrumbs: Breadcrumb[] = [];
  const sessionId = createId('session');
  const anonymousId = getAnonymousId();
  const maxBatchSize = options.maxBatchSize ?? 10;
  const transportFailureRetryDelayMs = options.transportFailureRetryDelayMs ?? 30000;
  const transport = options.transport ?? ((batch: EventBatch, endpoint: string) => defaultTransport(batch, endpoint, Boolean(options.networkDiagnostics)));
  const platform = detectPlatform();
  const h5 = isH5();

  const diagnostics = createNetworkDiagnosticCollector(options.networkDiagnostics, h5 ? window : (globalThis as any).uni);
  const pending = createDiagnosticBuffer<EventBatch['events'][number]>(options.networkDiagnostics, options.appKey, options.endpoint, {
    getItem(key) {
      return getStorageItem(key);
    },
    setItem(key, value) {
      setStorageItem(key, value);
    }
  });
  queue.push(...pending.restored);

  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let isFlushing = false;
  let inFlight: EventBatch['events'] = [];
  let nextAutomaticFlushAt = 0;

  function createBaseEvent(): Pick<
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
    | 'deviceInfo'
  > {
    return {
      eventId: createId('evt'),
      appKey: options.appKey,
      platform: platform as ErrorEvent['platform'],
      timestamp: Date.now(),
      sessionId,
      anonymousId,
      sdkVersion: SDK_VERSION,
      release: options.release,
      environment: options.environment,
      userId: options.userId,
      pageUrl: getCurrentPageUrl(),
      deviceInfo: getUniAppDeviceInfo()
    };
  }

  async function flush(force = false): Promise<void> {
    if (queue.length === 0 || isFlushing) {
      return;
    }

    if (!force && nextAutomaticFlushAt > Date.now()) {
      return;
    }

    isFlushing = true;
    const events = queue.splice(0, maxBatchSize);
    inFlight = events;
    try {
      await transport({ appKey: options.appKey, events }, options.endpoint);
      nextAutomaticFlushAt = 0;
    } catch (error) {
      queue.unshift(...events);
      if (transportFailureRetryDelayMs > 0) {
        nextAutomaticFlushAt = Date.now() + transportFailureRetryDelayMs;
      }
    } finally {
      inFlight = [];
      if (queue.length > pending.limit) queue.splice(0, queue.length - pending.limit);
      pending.save(queue);
      isFlushing = false;
    }
  }

  function enqueue(event: EventBatch['events'][number]): void {
    if (disposed || (event.type === 'http' && isCollectorEndpoint(event.url, options.endpoint))) return;
    queue.push(event);
    if (queue.length > pending.limit) queue.splice(0, queue.length - pending.limit);
    pending.save([...inFlight, ...queue]);

    if (queue.length >= maxBatchSize) {
      void flush().catch(() => {});
    }
  }

  function captureError(
    error: unknown,
    errorType: ErrorEvent['errorType'],
    metadata: Partial<ErrorEvent> = {}
  ): void {
    const normalized = normalizeError(error);
    const message = metadata.message ?? normalized.message;
    const stack = metadata.stack ?? normalized.stack;

    if (isFlushing || isSdkInternalError(message)) {
      return;
    }

    enqueue({
      ...createBaseEvent(),
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
    }, options.flushIntervalMs ?? 5000);
    timer.unref?.();
  }

  installAutoCapture(options, h5, captureError, (input) => {
    enqueue({
      ...createBaseEvent(),
      type: 'http',
      method: input.method.toUpperCase(),
      url: sanitizeUrl(input.url),
      status: input.status,
      duration: input.duration,
      success: input.success,
      networkDiagnostic: diagnostics.capture(input),
      errorMessage: input.errorMessage
    });
  });

  return {
    captureException(error: unknown): void {
      captureError(error, 'js');
    },

    captureHttp(input: CaptureHttpInput): void {
      enqueue({
        ...createBaseEvent(),
        type: 'http',
        method: input.method.toUpperCase(),
        url: sanitizeUrl(input.url),
        status: input.status,
        duration: input.duration,
        success: input.success,
        networkDiagnostic: diagnostics.capture(input),
      errorMessage: input.errorMessage
      });
    },

    capturePerformance(input: CapturePerformanceInput): void {
      enqueue({
        ...createBaseEvent(),
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

    dispose(): void {
      disposed = true;
      if (timer) clearInterval(timer);
      diagnostics.dispose();
    },
    async flush(): Promise<void> {
      if (timer && queue.length === 0) {
        clearInterval(timer);
        timer = undefined;
      }

      await flush(true);
    }
  };
}

/* -------------------------------------------------------------------------- */
/*                                Auto capture                                */
/* -------------------------------------------------------------------------- */

function normalizeAutoCapture(autoCapture: UniAppClientOptions['autoCapture']): Required<UniAppAutoCaptureOptions> {
  if (autoCapture === true) {
    return {
      errors: true,
      unhandledRejections: true,
      fetch: true,
      xhr: true,
      request: true
    };
  }

  if (!autoCapture) {
    return {
      errors: false,
      unhandledRejections: false,
      fetch: false,
      xhr: false,
      request: false
    };
  }

  return {
    errors: autoCapture.errors ?? false,
    unhandledRejections: autoCapture.unhandledRejections ?? false,
    fetch: autoCapture.fetch ?? false,
    xhr: autoCapture.xhr ?? false,
    request: autoCapture.request ?? false
  };
}

function installAutoCapture(
  options: UniAppClientOptions,
  h5: boolean,
  captureError: (error: unknown, errorType: ErrorEvent['errorType'], metadata?: Partial<ErrorEvent>) => void,
  captureHttp: (input: CaptureHttpInput) => void
): void {
  const autoCapture = normalizeAutoCapture(options.autoCapture);

  // Error listeners
  if (h5) {
    if (autoCapture.errors && typeof window !== 'undefined') {
      window.addEventListener('error', ((event: Event) => {
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

    if (autoCapture.unhandledRejections && typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', ((event: Event) => {
        const rejectionEvent = event as PromiseRejectionEvent;
        const reason = rejectionEvent.reason;
        
        if (reason instanceof Error && isSdkInternalError(reason.message)) {
          return;
        }
        
        captureError(reason, 'promise');
      }) as EventListener);
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uniGlobal = (globalThis as any).uni;

    if (autoCapture.errors && typeof uniGlobal?.onError === 'function') {
      uniGlobal.onError((message: string) => {
        captureError(message, 'js');
      });
    }

    if (autoCapture.unhandledRejections && typeof uniGlobal?.onUnhandledRejection === 'function') {
      uniGlobal.onUnhandledRejection((event: { reason: unknown }) => {
        captureError(event.reason, 'promise');
      });
    }
  }

  // HTTP interceptors
  if (h5) {
    if (autoCapture.fetch && typeof window !== 'undefined' && typeof window.fetch === 'function') {
      installFetchCapture(window, options.endpoint, captureHttp);
    }

    if (autoCapture.xhr && typeof window !== 'undefined' && typeof window.XMLHttpRequest === 'function') {
      installXhrCapture(window, captureHttp);
    }
  }

  if (autoCapture.request) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uniGlobal = (globalThis as any).uni;
    if (uniGlobal && typeof uniGlobal.request === 'function') {
      installUniRequestCapture(uniGlobal, options.endpoint, captureHttp);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                              H5 fetch capture                              */
/* -------------------------------------------------------------------------- */

function installFetchCapture(
  target: Window & typeof globalThis,
  endpoint: string,
  captureHttp: (input: CaptureHttpInput) => void
): void {
  const originalFetch = target.fetch.bind(target);

  target.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const startedAt = Date.now();
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const url = input instanceof Request ? input.url : input.toString();

    if (isCollectorEndpoint(url, endpoint)) {
      return originalFetch(input, init);
    }

    try {
      const response = await originalFetch(input, init);
      captureHttp({
        method,
        url,
        status: response.status,
        requestStartedAt: startedAt,
      duration: Date.now() - startedAt,
        success: response.ok
      });
      return response;
    } catch (error) {
      captureHttp({
        method,
        url,
        requestStartedAt: startedAt,
      duration: Date.now() - startedAt,
        success: false,
        errorMessage: normalizeError(error).message
      });
      throw error;
    }
  }) as typeof fetch;
}

/* -------------------------------------------------------------------------- */
/*                              H5 XHR capture                                */
/* -------------------------------------------------------------------------- */

function installXhrCapture(
  target: Window & typeof globalThis,
  captureHttp: (input: CaptureHttpInput) => void
): void {
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
      captureHttp({
        method,
        url,
        status: xhr.status,
        requestStartedAt: startedAt,
      duration: Date.now() - startedAt,
        success: xhr.status > 0 && xhr.status < 400
      });

      if (typeof originalOnloadend === 'function') {
        return originalOnloadend.call(this, event);
      }

      return undefined;
    };

    return xhr;
  } as unknown as typeof XMLHttpRequest;
}

/* -------------------------------------------------------------------------- */
/*                           uni.request capture                              */
/* -------------------------------------------------------------------------- */

interface UniRequestOptions {
  url: string;
  method?: string;
  header?: Record<string, string>;
  data?: unknown;
  success?: (response: unknown) => void;
  fail?: (error: { errMsg?: string }) => void;
  complete?: (response: unknown) => void;
  [key: string]: unknown;
}

interface UniLike {
  request: (options: UniRequestOptions) => unknown;
}

function installUniRequestCapture(
  uniGlobal: UniLike,
  endpoint: string,
  captureHttp: (input: CaptureHttpInput) => void
): void {
  const originalRequest = uniGlobal.request.bind(uniGlobal);

  uniGlobal.request = (options: UniRequestOptions) => {
    const startedAt = Date.now();
    const method = options.method ?? 'GET';

    if (isCollectorEndpoint(options.url, endpoint)) {
      return originalRequest(options);
    }

    return originalRequest({
      ...options,
      success(response: unknown) {
        const res = response as { statusCode?: number };
        captureHttp({
          method,
          url: options.url,
          status: res.statusCode,
          requestStartedAt: startedAt,
      duration: Date.now() - startedAt,
          success: res.statusCode ? res.statusCode < 400 : true
        });
        options.success?.(response);
      },
      fail(error: { errMsg?: string }) {
        captureHttp({
          method,
          url: options.url,
          requestStartedAt: startedAt,
      duration: Date.now() - startedAt,
          success: false,
          errorMessage: error.errMsg
        });
        options.fail?.(error);
      },
      complete(response: unknown) {
        options.complete?.(response);
      }
    });
  };
}

/* -------------------------------------------------------------------------- */
/*                                 Utilities                                  */
/* -------------------------------------------------------------------------- */

function getAnonymousId(): string {
  const storageKey = 'healthguard_anonymous_id';
  const existing = getStorageItem(storageKey);

  if (existing) {
    return existing;
  }

  const created = createId('anon');
  setStorageItem(storageKey, created);
  return created;
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
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

function isCollectorEndpoint(url: string, endpoint: string): boolean {
  try {
    const current = new URL(url, 'http://healthguard.local');
    const collector = new URL(endpoint, 'http://healthguard.local');
    return current.origin === collector.origin && current.pathname === collector.pathname;
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
