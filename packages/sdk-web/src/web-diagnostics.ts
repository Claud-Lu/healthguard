import type { Breadcrumb } from '@health-guard/core';
import type { BrowserLikeTarget, ExceptionContext, HealthGuardClientOptions } from './index';

const sensitive = new Set(['authorization', 'auth', 'cookie', 'password', 'passwd', 'pwd', 'secret', 'token', 'accesstoken', 'refreshtoken', 'drivertoken', 'idtoken', 'apikey', 'sessionid', 'phone', 'mobile', 'code', 'verifycode', 'email', 'idcard']);
const sensitiveKey = (key: string) => sensitive.has(key.toLowerCase().replace(/[-_]/g, ''));

export function sanitizeWebDiagnosticUrl(raw: string): string {
  try {
    const absolute = /^https?:\/\//i.test(raw);
    const url = new URL(raw, 'https://diagnostic.invalid');
    url.username = ''; url.password = '';
    const redact = (params: URLSearchParams) => {
      for (const key of Array.from(params.keys())) if (sensitiveKey(key)) params.set(key, '[Filtered]');
    };
    redact(url.searchParams);
    const query = url.hash.indexOf('?');
    if (query >= 0) {
      const params = new URLSearchParams(url.hash.slice(query + 1));
      redact(params);
      url.hash = `${url.hash.slice(0, query)}?${params}`;
    }
    if (absolute) return url.href;
    if (raw.startsWith('//')) return `//${url.host}${url.pathname}${url.search}${url.hash}`;
    return `${raw.split(/[?#]/, 1)[0]}${url.search}${url.hash}`;
  } catch {
    // Malformed addresses never bypass credential filtering.
    return raw.replace(/((?:https?:)?\/\/)[^/?#\s@]*@/gi, '$1')
      .replace(/([?&#])([^=&#]+)=([^&#\s]*)/g, (match, separator, key) => sensitiveKey(key) ? `${separator}${key}=[Filtered]` : match);
  }
}

function sanitizeText(value: string): string {
  return value.replace(/https?:\/\/[^\s<>"')]+/gi, match => {
    const position = match.match(/:\d+:\d+$/)?.[0] || '';
    return sanitizeWebDiagnosticUrl(position ? match.slice(0, -position.length) : match) + position;
  }).replace(/\bBearer\s+[\w.~+/-]+=*/gi, 'Bearer [Filtered]');
}

export function sanitizeWebValue<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return sanitizeText(value).slice(0, 16000) as T;
  if (depth > 8) return '[Truncated]' as T;
  if (Array.isArray(value)) return value.slice(-40).map(item => sanitizeWebValue(item, depth + 1)) as T;
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    // This SDK-generated ID is pseudonymous correlation metadata, not login state.
    if (sensitiveKey(key) && !(depth === 0 && key === 'sessionId')) result[key] = '[Filtered]';
    else if (['pageUrl', 'url', 'filename', 'from', 'to'].includes(key) && typeof item === 'string') result[key] = sanitizeWebDiagnosticUrl(item);
    else result[key] = sanitizeWebValue(item, depth + 1);
  }
  return result as T;
}

export function describeWebDevice(userAgent: string) {
  const android = userAgent.match(/Android\s+([\d.]+)/i);
  const ios = userAgent.match(/(?:CPU(?: iPhone)? OS|iPhone OS)\s+([\d_]+)/i);
  const model = userAgent.match(/;\s*([^;()]+?)\s+Build\//i)?.[1]?.trim() || userAgent.match(/\b(iPhone|iPad|iPod)\b/i)?.[1];
  const system = android ? `Android ${android[1]}` : ios ? `iOS ${ios[1].replace(/_/g, '.')}` : undefined;
  const browsers = [
    ['QQBrowser', /MQQBrowser\/([\d.]+)/i], ['WeChat', /MicroMessenger\/([\d.]+)/i],
    ['Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/i], ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/i], ['Safari', /Version\/([\d.]+).*Safari/i]
  ] as const;
  const found = browsers.find(([, pattern]) => pattern.test(userAgent));
  return { model, system, browser: found ? `${found[0]} ${userAgent.match(found[1])?.[1]}` : 'Unknown' };
}

function scripts(target?: BrowserLikeTarget) {
  const loaded = new Map<string, { url: string; crossOrigin?: string }>();
  try {
    for (const entry of Array.from(target?.performance?.getEntriesByType?.('resource') || [])) {
      if (entry.initiatorType === 'script') loaded.set(entry.name, { url: entry.name });
    }
    for (const script of Array.from(target?.document?.scripts || [])) {
      if (script.src) loaded.set(script.src, { url: script.src, crossOrigin: script.crossOrigin || 'unset' });
    }
  } catch { /* Resource timing can be unavailable in restricted browsers. */ }
  return Array.from(loaded.values()).slice(-12);
}

export function webErrorBreadcrumb(target: BrowserLikeTarget | undefined, options: HealthGuardClientOptions, error: { message: string; stack?: string; lineno?: number }, context?: ExceptionContext): Breadcrumb {
  const userAgent = target?.navigator?.userAgent?.slice(0, 512) || '';
  return {
    type: 'manual', message: 'web.error-context', timestamp: Date.now(),
    data: {
      integration: 'sdk-web', version: 1, release: options.release, buildRelease: options.buildRelease || options.release,
      pageUrl: target?.location?.href, userAgent, browser: describeWebDevice(userAgent).browser,
      deviceSource: 'user-agent', online: target?.navigator?.onLine, visibility: target?.document?.visibilityState,
      scripts: scripts(target), errorVisibility: error.message === 'Script error.' && !error.stack && !error.lineno ? 'opaque' : 'standard',
      ...(typeof context?.component === 'string' ? { component: context.component.slice(0, 200) } : {}),
      ...(typeof context?.phase === 'string' ? { phase: context.phase.slice(0, 200) } : {})
    }
  };
}

export function installWebBreadcrumbs(target: BrowserLikeTarget | undefined, add: (breadcrumb: Breadcrumb) => void): () => void {
  const cleanups: (() => void)[] = [];
  if (!target?.addEventListener) return () => {};
  const observe = (type: string, listener: EventListener) => {
    const safe: EventListener = event => { try { listener(event); } catch { /* Diagnostics must not break an application event handler. */ } };
    target.addEventListener?.(type, safe);
    cleanups.push(() => target.removeEventListener?.(type, safe));
  };
  let previousPage = target.location?.href;
  const navigate: EventListener = event => {
    const hash = event as HashChangeEvent;
    const to = hash.newURL || target.location?.href;
    add({ type: 'navigation', message: 'page.navigation', timestamp: Date.now(), data: { from: hash.oldURL || previousPage, to } });
    previousPage = to;
  };
  observe('hashchange', navigate);
  observe('popstate', navigate);
  observe('click', event => {
    const element = (event.target as Element | null)?.closest?.('button,a,[role="button"],[data-healthguard-action]');
    if (!element) return;
    const action = element.getAttribute('data-healthguard-action') || '';
    add({ type: 'click', message: /^[a-z][a-z0-9._-]{0,63}$/.test(action) ? action : 'ui.click', timestamp: Date.now(), data: { tag: element.tagName, pageUrl: target.location?.href } });
  });
  return () => cleanups.forEach(cleanup => cleanup());
}
