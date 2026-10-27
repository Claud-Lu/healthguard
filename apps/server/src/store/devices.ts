import { deviceGrouping, deviceShortCode, type DeviceList, type DeviceSummary } from '@health-guard/core';
import type { DeviceQuery, StoredEvent } from './types';

export function matchesDeviceEvent(event: StoredEvent, query: DeviceQuery): boolean {
  return event.appKey === query.appKey && (event.type === 'error' || (event.type === 'http' && !event.success))
    && (!query.platform || query.platform === event.platform)
    && (query.startTime === undefined || event.timestamp >= query.startTime)
    && (query.endTime === undefined || event.timestamp <= query.endTime);
}
export function matchesDeviceSummary(device: DeviceSummary, query: DeviceQuery): boolean {
  const search = query.search?.toLowerCase().replace(/^hg-/, '') ?? '';
  return (!query.kind || device.kind === query.kind)
    && (!search || device.key.toLowerCase().includes(search) || device.model?.toLowerCase().includes(search) === true);
}
export function summarizeDevices(events: StoredEvent[], query: DeviceQuery): DeviceList {
  const groups = new Map<string, DeviceSummary>();
  // Match SQL's deterministic tie-breaker; arrival time selects reported metadata.
  for (const event of events.filter(e => matchesDeviceEvent(e, query)).sort((a, b) =>
    (a.receivedAt ?? a.timestamp) - (b.receivedAt ?? b.timestamp) || a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId))) {
    const identity = deviceGrouping(event);
    const before = groups.get(identity.key);
    groups.set(identity.key, {
      ...identity,
      deviceId: identity.kind === 'stable' ? event.deviceId! : null,
      shortCode: deviceShortCode(event),
      source: identity.kind === 'stable' ? event.deviceIdSource! : null,
      scope: identity.kind === 'stable' ? event.deviceIdScope! : null,
      model: event.deviceInfo?.model || null, system: event.deviceInfo?.system || null,
      latestRelease: event.release?.trim() || null, sdkVersion: event.sdkVersion || null,
      anomalyCount: (before?.anomalyCount ?? 0) + 1,
      firstSeenAt: Math.min(before?.firstSeenAt ?? event.timestamp, event.timestamp),
      lastSeenAt: Math.max(before?.lastSeenAt ?? event.timestamp, event.timestamp),
      lastReportedAt: event.receivedAt ?? null,
    });
  }
  const all = [...groups.values()];
  const filtered = all.filter(d => matchesDeviceSummary(d, query)).sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.key.localeCompare(b.key));
  return { devices: filtered.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 50)), total: filtered.length,
    totals: { stableDevices: all.filter(d => d.kind === 'stable').length,
      installations: all.filter(d => d.kind === 'installation').length,
      unidentifiedEvents: all.filter(d => d.kind === 'unknown').reduce((count, d) => count + d.anomalyCount, 0) } };
}

/** Parameterized project/time filtering; grouping never examines a device model. */
export function deviceEventSql(query: DeviceQuery): { cte: string; params: unknown[] } {
  const params: unknown[] = [query.appKey];
  const where = ["app_key = $1", "(type = 'error' OR (type = 'http' AND payload->>'success' = 'false'))"];
  for (const [column, op, value] of [['platform', '=', query.platform], ['timestamp', '>=', query.startTime], ['timestamp', '<=', query.endTime]] as const) {
    if (value !== undefined) { params.push(value); where.push(`${column} ${op} $${params.length}`); }
  }
  const stable = `payload->>'deviceIdStatus' = 'available' AND payload->>'deviceId' ~ '^hgd1_[a-f0-9]{64}$'
    AND payload->>'deviceIdSource' = 'android_id' AND payload->>'deviceIdScope' IN ('android_user_signing_key_app', 'android_user_app_legacy')
    AND NOT (payload ? 'deviceIdReason')`;
  return { params, cte: `WITH classified AS (
    SELECT *, CASE WHEN ${stable} THEN 'stable'
      WHEN COALESCE(TRIM(anonymous_id), '') <> '' AND TRIM(anonymous_id) !~* '^(unknown|unavailable|undefined|null|未获取|未知)$' THEN 'installation'
      ELSE 'unknown' END AS kind FROM events WHERE ${where.join(' AND ')}
  ), identified AS (
    SELECT *, CASE kind WHEN 'stable' THEN 'stable:' || (payload->>'deviceIdSource') || ':' || (payload->>'deviceIdScope') || ':' || (payload->>'deviceId')
      WHEN 'installation' THEN 'installation:' || TRIM(anonymous_id) ELSE 'unknown:' || event_id END AS identity_key
    FROM classified
  )` };
}
