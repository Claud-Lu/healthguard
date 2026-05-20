import {
  createIssueFingerprint,
  sanitizeUrl,
  type Breadcrumb,
  type ErrorEvent,
  type EventBatch
} from '@healthguard/core';

const SDK_VERSION = '0.1.0';

export interface MiniProgramWxLike {
  onError?: (handler: (message: string) => void) => void;
  onUnhandledRejection?: (handler: (event: { reason: unknown }) => void) => void;
  request: (options: WxRequestOptions) => unknown;
}

export interface WxRequestOptions {
  url: string;
  method?: string;
  success?: (response: { statusCode?: number }) => void;
  fail?: (error: { errMsg?: string }) => void;
  complete?: (response: unknown) => void;
  [key: string]: unknown;
}

export interface MiniProgramAutoCaptureOptions {
  request?: boolean;
}

export interface MiniProgramClientOptions {
  appKey: string;
  endpoint: string;
  wx: MiniProgramWxLike;
  release?: string;
  environment?: ErrorEvent['environment'];
  userId?: string;
  autoCapture?: boolean | MiniProgramAutoCaptureOptions;
  transport?: (batch: EventBatch, endpoint: string) => Promise<void>;
}

export interface MiniProgramClient {
  captureException(error: unknown): void;
  captureHttp(input: { method: string; url: string; status?: number; duration: number; success: boolean; errorMessage?: string }): void;
  addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'> & { timestamp?: number }): void;
  wrapPage<T extends Record<string, any>>(route: string, definition: T): T;
  wrapApp<T extends Record<string, any>>(definition: T): T;
  flush(): Promise<void>;
}

export function createMiniProgramClient(options: MiniProgramClientOptions): MiniProgramClient {
  const queue: EventBatch['events'] = [];
  const breadcrumbs: Breadcrumb[] = [];
  const sessionId = createId('session');
  const anonymousId = createId('anon');
  const transport = options.transport ?? defaultTransport;

  function enqueue(event: EventBatch['events'][number]): void {
    queue.push(event);
  }

  function captureException(error: unknown, errorType: ErrorEvent['errorType'] = 'js'): void {
    const normalized = normalizeError(error);
    const message = firstLine(normalized.message);

    enqueue({
      ...createBaseEvent(options, sessionId, anonymousId),
      type: 'error',
      errorType,
      message,
      stack: normalized.stack ?? normalized.message,
      fingerprint: createIssueFingerprint({
        errorType,
        message,
        stack: normalized.stack ?? normalized.message
      }),
      breadcrumbs: [...breadcrumbs]
    });
  }

  function captureHttp(input: { method: string; url: string; status?: number; duration: number; success: boolean; errorMessage?: string }): void {
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
  }

  options.wx.onError?.((message) => {
    captureException(message, 'js');
  });

  options.wx.onUnhandledRejection?.((event) => {
    captureException(event.reason, 'promise');
  });

  if (shouldCaptureRequest(options.autoCapture)) {
    installRequestCapture(options.wx, captureHttp);
  }

  return {
    captureException,
    captureHttp,
    addBreadcrumb(input): void {
      breadcrumbs.push({
        ...input,
        timestamp: input.timestamp ?? Date.now()
      });

      if (breadcrumbs.length > 30) {
        breadcrumbs.shift();
      }
    },
    wrapPage<T extends Record<string, any>>(route: string, definition: T): T {
      return wrapLifecycle(definition, {
        onLoad: `Page onLoad: ${route}`,
        onShow: `Page onShow: ${route}`,
        onHide: `Page onHide: ${route}`,
        onUnload: `Page onUnload: ${route}`
      });
    },
    wrapApp<T extends Record<string, any>>(definition: T): T {
      return wrapLifecycle(definition, {
        onLaunch: 'App onLaunch',
        onShow: 'App onShow',
        onHide: 'App onHide'
      });
    },
    async flush(): Promise<void> {
      if (queue.length === 0) {
        return;
      }

      const events = queue.splice(0, queue.length);
      await transport({ appKey: options.appKey, events }, options.endpoint);
    }
  };

  function wrapLifecycle<T extends Record<string, any>>(definition: T, lifecycleMessages: Record<string, string>): T {
    const wrapped: Record<string, any> = { ...definition };

    for (const [name, message] of Object.entries(lifecycleMessages)) {
      const original = wrapped[name];
      wrapped[name] = function wrappedLifecycle(this: unknown, ...args: unknown[]) {
        breadcrumbs.push({
          type: 'navigation',
          message,
          timestamp: Date.now()
        });

        if (typeof original === 'function') {
          return original.apply(this, args);
        }

        return undefined;
      };
    }

    return wrapped as T;
  }
}

function createBaseEvent(
  options: MiniProgramClientOptions,
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
> {
  return {
    eventId: createId('evt'),
    appKey: options.appKey,
    platform: 'wechat-miniprogram',
    timestamp: Date.now(),
    sessionId,
    anonymousId,
    sdkVersion: SDK_VERSION,
    release: options.release,
    environment: options.environment,
    userId: options.userId
  };
}

function installRequestCapture(
  wx: MiniProgramWxLike,
  captureHttp: (input: { method: string; url: string; status?: number; duration: number; success: boolean; errorMessage?: string }) => void
): void {
  const originalRequest = wx.request.bind(wx);

  wx.request = (options: WxRequestOptions) => {
    const startedAt = Date.now();
    const method = options.method ?? 'GET';

    return originalRequest({
      ...options,
      success(response: { statusCode?: number }) {
        captureHttp({
          method,
          url: options.url,
          status: response.statusCode,
          duration: Date.now() - startedAt,
          success: response.statusCode ? response.statusCode < 400 : true
        });
        options.success?.(response);
      },
      fail(error: { errMsg?: string }) {
        captureHttp({
          method,
          url: options.url,
          duration: Date.now() - startedAt,
          success: false,
          errorMessage: error.errMsg
        });
        options.fail?.(error);
      }
    });
  };
}

async function defaultTransport(batch: EventBatch, endpoint: string): Promise<void> {
  await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(batch)
  });
}

function shouldCaptureRequest(autoCapture: MiniProgramClientOptions['autoCapture']): boolean {
  if (autoCapture === true) {
    return true;
  }

  if (!autoCapture) {
    return false;
  }

  return autoCapture?.request ?? false;
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

function firstLine(message: string): string {
  return message.split('\n')[0] || message;
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
