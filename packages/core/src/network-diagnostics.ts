// Dependency-free: imported directly by the mini-program bundle to avoid Zod.
export type NetworkCategory = 'offline' | 'dns' | 'connect' | 'tls' | 'timeout' | 'cancelled' | 'http' | 'unknown';
export interface NetworkSnapshot {
  online?: boolean;
  transport?: 'wifi' | 'cellular' | 'ethernet' | 'vpn' | 'none' | 'unknown';
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
  validated?: boolean;
  metered?: boolean;
  vpn?: boolean;
}
export interface NetworkTiming {
  availability: 'available' | 'unavailable';
  dnsMs?: number;
  connectMs?: number;
  ttfbMs?: number;
}
export interface NetworkDiagnostic {
  version: 1;
  category: NetworkCategory;
  targetOrigin?: string;
  networkAvailability: 'available' | 'unavailable';
  network: NetworkSnapshot;
  timing: NetworkTiming;
  recentChanges: Array<{ timestamp: number; online?: boolean; transport?: NetworkSnapshot['transport'] }>;
}
export interface DiagnosticStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface NetworkDiagnosticsOptions {
  cooldownMs?: number;
  maxPendingEvents?: number;
  storage?: DiagnosticStorage;
}
export interface DiagnosticRequest {
  method: string;
  url: string;
  duration: number;
  success: boolean;
  status?: number;
  errorMessage?: string;
  failureKind?: NetworkCategory;
  snapshot?: NetworkSnapshot;
  timing?: NetworkTiming;
}
interface Runtime {
  navigator?: { onLine?: boolean; connection?: { effectiveType?: string; addEventListener?: (name: string, cb: () => void) => void; removeEventListener?: (name: string, cb: () => void) => void } };
  location?: { href: string };
  performance?: { getEntriesByName(name: string): ArrayLike<unknown> };
  addEventListener?: (name: string, cb: () => void) => void;
  removeEventListener?: (name: string, cb: () => void) => void;
  getNetworkType?: (options: { success: (value: { networkType?: string }) => void }) => void;
  onNetworkStatusChange?: (cb: (value: { isConnected?: boolean; networkType?: string }) => void) => void;
  offNetworkStatusChange?: (cb: (value: { isConnected?: boolean; networkType?: string }) => void) => void;
}
const transports = ['wifi', 'cellular', 'ethernet', 'vpn', 'none', 'unknown'];
const categories: NetworkCategory[] = ['offline', 'dns', 'connect', 'tls', 'timeout', 'cancelled', 'http', 'unknown'];

export function sanitizeNetworkSnapshot(value: NetworkSnapshot = {}): NetworkSnapshot {
  const result: NetworkSnapshot = {};
  for (const key of ['online', 'validated', 'metered', 'vpn'] as const) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  if (value.transport && transports.includes(value.transport)) result.transport = value.transport;
  if (value.effectiveType && ['slow-2g', '2g', '3g', '4g'].includes(value.effectiveType)) result.effectiveType = value.effectiveType;
  return result;
}
export function networkTargetOrigin(raw: string, base?: string): string | undefined {
  try {
    const url = new URL(raw, base);
    return /^https?:$/.test(url.protocol) ? url.origin : undefined;
  } catch { return undefined; }
}
export function safeNetworkRequestUrl(raw: string): string {
  try {
    const url = new URL(raw, 'https://healthguard.invalid');
    if (!/^https?:$/.test(url.protocol)) return '[Unavailable]';
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return /^https?:\/\//i.test(raw) ? url.href : url.pathname;
  } catch { return '[Unavailable]'; }
}
export function createNetworkDiagnostic(input: DiagnosticRequest): NetworkDiagnostic {
  const network = sanitizeNetworkSnapshot(input.snapshot);
  const message = input.errorMessage ?? '';
  // A status is evidence that an HTTP response was received. Online is only an OS hint.
  const category: NetworkCategory = input.status && input.status >= 400 ? 'http'
    : input.failureKind === 'cancelled' ? 'cancelled'
    : network.online === false ? 'offline'
    : input.failureKind && categories.includes(input.failureKind) ? input.failureKind
    : /timeout|timed out/i.test(message) ? 'timeout'
    : /ENOTFOUND|EAI_AGAIN|UnknownHostException|Failed host lookup/i.test(message) ? 'dns'
    : /ECONNREFUSED|connection refused/i.test(message) ? 'connect'
    : /CERT_|SSLHandshakeException|HandshakeException/i.test(message) ? 'tls' : 'unknown';
  const timing: NetworkTiming = { availability: 'unavailable' };
  for (const key of ['dnsMs', 'connectMs', 'ttfbMs'] as const) {
    const value = input.timing?.[key];
    if (input.timing?.availability === 'available' && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3600000) {
      timing[key] = value; timing.availability = 'available';
    }
  }
  return { version: 1, category, targetOrigin: networkTargetOrigin(input.url), networkAvailability: Object.keys(network).length ? 'available' : 'unavailable', network, timing, recentChanges: [] };
}

export function createNetworkDiagnosticCollector(config: boolean | NetworkDiagnosticsOptions | undefined, target?: unknown) {
  const runtime = (target ?? {}) as Runtime;
  const options = typeof config === 'object' ? config : {};
  const cooldown = Math.max(0, options.cooldownMs ?? 30000);
  const lastCapture = new Map<string, number>();
  const changes: NetworkDiagnostic['recentChanges'] = [];
  let cached: NetworkSnapshot = {};
  let disposed = false;
  const snapshot = () => sanitizeNetworkSnapshot({ ...cached,
    ...(typeof runtime.navigator?.onLine === 'boolean' ? { online: runtime.navigator.onLine } : {}),
    effectiveType: runtime.navigator?.connection?.effectiveType as NetworkSnapshot['effectiveType'] });
  const changed = () => {
    if (disposed) return;
    const value = snapshot();
    changes.push({ timestamp: Date.now(), online: value.online, transport: value.transport });
    if (changes.length > 5) changes.shift();
  };
  const platformChanged = (value: { isConnected?: boolean; networkType?: string }) => {
    if (disposed) return;
    const name = value.networkType;
    const transport: NetworkSnapshot['transport'] = name === 'wifi' ? 'wifi' : name === 'none' ? 'none' : /^(2g|3g|4g|5g|cellular)$/.test(name ?? '') ? 'cellular' : 'unknown';
    cached = { transport, ...(typeof value.isConnected === 'boolean' ? { online: value.isConnected } : name && name !== 'unknown' ? { online: name !== 'none' } : {}) };
    changed();
  };
  if (config) {
    try { runtime.getNetworkType?.({ success: (value) => platformChanged(value) }); } catch { /* unavailable */ }
    try { runtime.onNetworkStatusChange?.(platformChanged); } catch { /* unavailable */ }
    for (const name of ['online', 'offline']) { try { runtime.addEventListener?.(name, changed); } catch { /* unavailable */ } }
    try { runtime.navigator?.connection?.addEventListener?.('change', changed); } catch { /* unavailable */ }
  }
  return {
    capture(input: DiagnosticRequest): NetworkDiagnostic | undefined {
      if (!config || disposed || input.success) return undefined;
      try {
        const origin = networkTargetOrigin(input.url, runtime.location?.href);
        const key = origin ?? 'relative';
        const now = Date.now();
        if (lastCapture.has(key) && now - lastCapture.get(key)! < cooldown) return undefined;
        lastCapture.delete(key); lastCapture.set(key, now);
        if (lastCapture.size > 20) lastCapture.delete(lastCapture.keys().next().value!);
        const report = createNetworkDiagnostic({ ...input, snapshot: input.snapshot ?? snapshot(), timing: input.timing ?? resourceTiming(runtime, input.url) });
        report.targetOrigin = origin;
        report.recentChanges = changes.filter((item) => now - item.timestamp <= 120000).slice(-5);
        return report;
      } catch { return createNetworkDiagnostic(input); }
    },
    dispose() {
      disposed = true;
      try { runtime.offNetworkStatusChange?.(platformChanged); } catch { /* unavailable */ }
      for (const name of ['online', 'offline']) { try { runtime.removeEventListener?.(name, changed); } catch { /* unavailable */ } }
      try { runtime.navigator?.connection?.removeEventListener?.('change', changed); } catch { /* unavailable */ }
    }
  };
}
function resourceTiming(runtime: Runtime, url: string): NetworkTiming {
  const result: NetworkTiming = { availability: 'unavailable' };
  try {
    let name = url;
    try { name = new URL(url, runtime.location?.href).href; } catch { /* relative */ }
    const entries = runtime.performance?.getEntriesByName(name);
    const entry = entries?.[entries.length - 1] as Record<string, unknown> | undefined;
    if (!entry) return result;
    for (const [key, start, end] of [ ['dnsMs', 'domainLookupStart', 'domainLookupEnd'], ['connectMs', 'connectStart', 'connectEnd'], ['ttfbMs', 'requestStart', 'responseStart'] ] as const) {
      const a = entry[start], b = entry[end];
      // Cross-origin protected zeros are unavailable, never reported as measured zero.
      if (typeof a === 'number' && typeof b === 'number' && a > 0 && b >= a) {
        result[key] = b - a; result.availability = 'available';
      }
    }
  } catch { /* unavailable */ }
  return result;
}

// Persist only diagnostic HTTP evidence, with bounded storage and no body/headers.
// In-flight events remain in storage until transport acknowledgement.
export function createDiagnosticBuffer<T>(config: boolean | NetworkDiagnosticsOptions | undefined, appKey: string, endpoint: string, fallbackStorage?: DiagnosticStorage) {
  const options = typeof config === 'object' ? config : {};
  const limit = config ? Math.max(1, Math.min(100, options.maxPendingEvents ?? 100)) : Number.POSITIVE_INFINITY;
  const storage = config ? options.storage ?? fallbackStorage : undefined;
  const key = `healthguard_network_pending_v1:${encodeURIComponent(appKey)}:${encodeURIComponent(endpoint)}`;
  let saved: T[] = [];
  try {
    const data: unknown = JSON.parse(storage?.getItem(key) ?? '[]');
    if (Array.isArray(data)) saved = data.filter((item) => item?.appKey === appKey && item?.type === 'http' && item?.networkDiagnostic?.version === 1).slice(-limit);
  } catch { /* unavailable */ }
  return {
    restored: saved,
    limit,
    save(queue: T[]) {
      try {
        const evidence = queue.filter((item: any) => item.type === 'http' && item.networkDiagnostic).slice(-limit).map((item: any) => {
          const { type, eventId, appKey, platform, timestamp, sessionId, anonymousId, sdkVersion, release, environment, method, url, status, duration, success, networkDiagnostic } = item;
          return { type, eventId, appKey, platform, timestamp, sessionId, anonymousId, sdkVersion, release, environment, method, url: safeNetworkRequestUrl(url), status, duration, success, networkDiagnostic };
        });
        storage?.setItem(key, JSON.stringify(evidence));
      } catch { /* Monitoring must not interfere with the business request. */ }
    }
  };
}
