const SDK_VERSION = '0.1.0';

const sensitiveQueryKeys = new Set([
  'authorization',
  'auth',
  'cookie',
  'password',
  'secret',
  'token',
  'access_token',
  'refresh_token'
]);

export interface Breadcrumb {
  type: 'navigation' | 'click' | 'http' | 'manual';
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export type MiniProgramPlatform = 'wechat-miniprogram' | 'alipay-miniprogram';
export type HealthGuardEnvironment = 'development' | 'test' | 'production';
export type ErrorType = 'js' | 'promise' | 'resource' | 'request' | 'native';

export interface DeviceInfo {
  model?: string;
  system?: string;
  screenWidth?: number;
  screenHeight?: number;
  language?: string;
  userAgent?: string;
}

export interface BaseEvent {
  eventId: string;
  appKey: string;
  platform: MiniProgramPlatform;
  timestamp: number;
  sessionId: string;
  anonymousId: string;
  sdkVersion: string;
  release?: string;
  environment?: HealthGuardEnvironment;
  userId?: string;
  deviceInfo?: DeviceInfo;
}

export interface ErrorEvent extends BaseEvent {
  type: 'error';
  errorType: ErrorType;
  message: string;
  stack?: string;
  fingerprint: string;
  breadcrumbs: Breadcrumb[];
  context?: Record<string, unknown>;
  page?: string;
  scene?: string;
}

export interface HttpEvent extends BaseEvent {
  type: 'http';
  method: string;
  url: string;
  status?: number;
  duration: number;
  success: boolean;
  errorMessage?: string;
  context?: Record<string, unknown>;
  requestData?: Record<string, unknown>;
  page?: string;
  scene?: string;
}

export interface EventBatch {
  appKey: string;
  events: Array<ErrorEvent | HttpEvent>;
}

export interface MiniProgramWxLike {
  onError?: (handler: (message: string) => void) => void;
  onUnhandledRejection?: (handler: (event: { reason: unknown }) => void) => void;
  request: (options: WxRequestOptions) => unknown;
  getCurrentPages?: () => Array<{ route?: string; __route__?: string }>;
}

export interface WxRequestOptions {
  url: string;
  method?: string;
  success?: (response: { statusCode?: number; status?: number; data?: unknown }) => void;
  fail?: (error: { errMsg?: string }) => void;
  complete?: (response: unknown) => void;
  healthGuard?: {
    page?: string;
    scene?: string;
    context?: Record<string, unknown>;
    requestData?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export interface MiniProgramAutoCaptureOptions {
  request?: boolean;
}

export interface MiniProgramClientOptions {
  appKey: string;
  endpoint: string;
  wx: MiniProgramWxLike;
  platform?: MiniProgramPlatform;
  release?: string;
  environment?: HealthGuardEnvironment;
  userId?: string;
  autoCapture?: boolean | MiniProgramAutoCaptureOptions;
  transport?: (batch: EventBatch, endpoint: string) => Promise<void>;
}

export interface MiniProgramClient {
  captureException(error: unknown, errorType?: ErrorType, context?: Record<string, unknown>): void;
  captureHttp(input: { method: string; url: string; status?: number; duration: number; success: boolean; errorMessage?: string; context?: Record<string, unknown>; requestData?: Record<string, unknown>; page?: string; scene?: string }): void;
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
  const transport = options.transport ?? createRequestTransport(options.wx);

  function enqueue(event: EventBatch['events'][number]): void {
    queue.push(event);
  }

  function captureException(error: unknown, errorType: ErrorType = 'js', context?: Record<string, unknown>): void {
    const normalized = normalizeError(error);
    const message = firstLine(normalized.message);
    const eventContext = sanitizeContext({ ...normalized.context, ...context });

    enqueue({
      ...createBaseEvent(options, sessionId, anonymousId),
      type: 'error',
      errorType,
      message,
      stack: normalized.stack ?? normalized.message,
      fingerprint: createIssueFingerprint({
        errorType,
        message,
        stack: normalized.stack ?? normalized.message,
        context: eventContext
      }),
      breadcrumbs: [...breadcrumbs],
      context: eventContext,
      page: (eventContext?.page as string) ?? undefined,
      scene: (eventContext?.scene as string) ?? undefined
    });
  }

  function captureHttp(input: { method: string; url: string; status?: number; duration: number; success: boolean; errorMessage?: string; context?: Record<string, unknown>; requestData?: Record<string, unknown>; page?: string; scene?: string }): void {
    enqueue({
      ...createBaseEvent(options, sessionId, anonymousId),
      type: 'http',
      method: input.method.toUpperCase(),
      url: sanitizeUrl(input.url),
      status: input.status,
      duration: input.duration,
      success: input.success,
      errorMessage: input.errorMessage,
      context: sanitizeContext(input.context),
      requestData: sanitizeRecord(input.requestData),
      page: input.page,
      scene: input.scene
    });
  }

  options.wx.onError?.((message) => {
    captureException(message, 'js');
  });

  options.wx.onUnhandledRejection?.((event) => {
    const reason = event.reason;
    const context: Record<string, unknown> = {};

    if (reason && typeof reason === 'object') {
      const err = reason as Record<string, unknown>;
      if (err.url) context.url = err.url;
      if (err.method) context.method = err.method;
      if (err.page) context.page = err.page;
      if (err.scene) context.scene = err.scene;
      if (err.status !== undefined) context.status = err.status;
      if (err.statusCode !== undefined) context.statusCode = err.statusCode;
      if (err.errorCode !== undefined) context.errorCode = err.errorCode;
      if (err.originalError) context.originalError = err.originalError;
    }

    captureException(event.reason, 'promise', context);
  });

  if (shouldCaptureRequest(options.autoCapture)) {
    installRequestCapture(options.wx, captureHttp, options.endpoint);
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
  | 'deviceInfo'
> {
  return {
    eventId: createId('evt'),
    appKey: options.appKey,
    platform: options.platform ?? 'wechat-miniprogram',
    timestamp: Date.now(),
    sessionId,
    anonymousId,
    sdkVersion: SDK_VERSION,
    release: options.release,
    environment: options.environment,
    userId: options.userId,
    deviceInfo: getMiniProgramDeviceInfo(options.wx)
  };
}

function getMiniProgramDeviceInfo(wx: MiniProgramWxLike) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info = (wx as any).getSystemInfoSync?.();
    if (!info) return undefined;
    return {
      model: info.model,
      system: info.system,
      screenWidth: info.screenWidth,
      screenHeight: info.screenHeight,
      language: info.language
    };
  } catch {
    return undefined;
  }
}

function installRequestCapture(
  wx: MiniProgramWxLike,
  captureHttp: (input: { method: string; url: string; status?: number; duration: number; success: boolean; errorMessage?: string; context?: Record<string, unknown>; requestData?: Record<string, unknown>; page?: string; scene?: string }) => void,
  endpoint: string
): void {
  const originalRequest = wx.request.bind(wx);

  wx.request = (options: WxRequestOptions) => {
    if (isHealthGuardEndpoint(options.url, endpoint)) {
      return originalRequest(options);
    }

    const startedAt = Date.now();
    const method = options.method ?? 'GET';
    const metadata = options.healthGuard ?? {};
    const page = metadata.page ?? getCurrentPageRoute(wx);
    const scene = metadata.scene;
    const requestData = sanitizeRecord(metadata.requestData ?? getRequestData(options.data));
    const context = sanitizeContext(metadata.context);

    return originalRequest({
      ...options,
      success(response: { statusCode?: number; status?: number; data?: unknown }) {
        const result = getRequestResult(response);
        captureHttp({
          method,
          url: options.url,
          status: result.status,
          duration: Date.now() - startedAt,
          success: result.success,
          errorMessage: result.errorMessage,
          context,
          requestData,
          page,
          scene
        });
        options.success?.(response);
      },
      fail(error: Record<string, unknown>) {
        captureHttp({
          method,
          url: options.url,
          status: getMiniProgramErrorStatus(error),
          duration: Date.now() - startedAt,
          success: false,
          errorMessage: getMiniProgramErrorMessage(error),
          context: {
            ...context,
            originalError: error
          },
          requestData,
          page,
          scene
        });
        options.fail?.(error as { errMsg?: string });
      }
    });
  };
}

function isHealthGuardEndpoint(url: string, endpoint: string): boolean {
  try {
    const urlObj = new URL(url, 'http://healthguard.local');
    const endpointObj = new URL(endpoint, 'http://healthguard.local');
    return urlObj.pathname === endpointObj.pathname;
  } catch {
    return false;
  }
}

function getCurrentPageRoute(wx: MiniProgramWxLike): string | undefined {
  try {
    const pages = wx.getCurrentPages?.();
    const current = pages?.[pages.length - 1];
    return current?.route ?? current?.__route__;
  } catch {
    return undefined;
  }
}

function getMiniProgramErrorMessage(error: Record<string, unknown>): string {
  return String(
    error.errorMessage ||
    error.errMsg ||
    error.message ||
    JSON.stringify(error)
  );
}

function getMiniProgramErrorStatus(error: Record<string, unknown>): number | undefined {
  const candidates = [error.statusCode, error.status, error.error, error.errCode, error.code];
  const value = candidates.find((item): item is number => typeof item === 'number');
  return value;
}

function getRequestResult(response: { statusCode?: number; status?: number; data?: unknown }): {
  status?: number;
  success: boolean;
  errorMessage?: string;
} {
  const body = response.data as { success?: unknown; error?: { code?: unknown; message?: unknown }; message?: unknown; msg?: unknown } | undefined;
  const status = getBusinessStatusCode(body) ?? response.statusCode ?? response.status;
  const isBusinessFailure = body?.success === false;

  return {
    status,
    success: isBusinessFailure ? false : status ? status < 400 : true,
    errorMessage: isBusinessFailure || (status && status >= 400) ? getBusinessErrorMessage(body) : undefined
  };
}

function getBusinessStatusCode(body: { error?: { code?: unknown } } | undefined): number | undefined {
  const code = body?.error?.code;

  if (typeof code === 'number') {
    return code;
  }

  if (typeof code === 'string' && /^\d+$/.test(code)) {
    return Number(code);
  }

  return undefined;
}

function getBusinessErrorMessage(
  body: { error?: { message?: unknown }; message?: unknown; msg?: unknown } | undefined
): string | undefined {
  const candidates = [body?.error?.message, body?.message, body?.msg];
  const message = candidates.find((item): item is string => typeof item === 'string' && item.trim().length > 0);

  return message;
}

function createRequestTransport(wx: MiniProgramWxLike): (batch: EventBatch, endpoint: string) => Promise<void> {
  const request = wx.request.bind(wx);

  return (batch: EventBatch, endpoint: string) => new Promise((resolve, reject) => {
    request({
      url: endpoint,
      method: 'POST',
      data: batch,
      header: {
        'content-type': 'application/json'
      },
      success(response: { statusCode?: number }) {
        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`HealthGuard transport failed with status ${response.statusCode}`));
          return;
        }

        resolve();
      },
      fail(error: { errMsg?: string }) {
        reject(new Error(error.errMsg || 'HealthGuard transport failed'));
      }
    });
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

function normalizeError(error: unknown): { message: string; stack?: string; context?: Record<string, unknown> } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      context: extractOwnEnumerableFields(error as unknown as Record<string, unknown>)
    };
  }

  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    return {
      message: getObjectErrorMessage(obj),
      stack: typeof obj.stack === 'string' ? obj.stack : undefined,
      context: obj
    };
  }

  return {
    message: typeof error === 'string' ? error : JSON.stringify(error)
  };
}

function extractOwnEnumerableFields(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (key !== 'stack' && key !== 'message') {
      result[key] = obj[key];
    }
  }
  return result;
}

function getObjectErrorMessage(obj: Record<string, unknown>): string {
  if (typeof obj.errorMessage === 'string') return obj.errorMessage;
  if (typeof obj.errMsg === 'string') return obj.errMsg;
  if (typeof obj.message === 'string') return obj.message;
  return JSON.stringify(obj);
}

function getRequestData(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return undefined;
  }

  return data as Record<string, unknown>;
}

function sanitizeContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) return undefined;
  return sanitizeRecord(context);
}

function sanitizeRecord(record: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!record) return undefined;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (sensitiveQueryKeys.has(key.toLowerCase())) {
      result[key] = '[Filtered]';
      continue;
    }

    if (key === 'url' && typeof value === 'string') {
      result[key] = sanitizeUrl(value);
      continue;
    }

    if (Array.isArray(value)) {
      result[key] = value.map((item) => sanitizeValue(item));
      continue;
    }

    result[key] = sanitizeValue(value);
  }

  return result;
}

function sanitizeValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  return sanitizeRecord(value as Record<string, unknown>);
}

function firstLine(message: string): string {
  return message.split('\n')[0] || message;
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function sanitizeUrl(rawUrl: string): string {
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

function createIssueFingerprint(input: { errorType: ErrorType; message: string; stack?: string; context?: Record<string, unknown> }): string {
  const stackHead = input.stack?.split('\n').slice(0, 2).join('\n').trim() ?? '';
  let source = `${input.errorType}|${input.message}|${stackHead}`;

  if (input.context) {
    if (input.context.url) {
      const rawUrl = String(input.context.url);
      try {
        source += `|${new URL(rawUrl, 'http://healthguard.local').pathname}`;
      } catch {
        source += `|${rawUrl.split('?')[0] ?? rawUrl}`;
      }
    }
    if (input.context.method) source += `|${input.context.method}`;
    if (input.context.scene) source += `|${input.context.scene}`;
    if (input.context.page) source += `|${input.context.page}`;
  }

  return `${input.errorType}:${hashString(source)}`;
}

function hashString(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}
