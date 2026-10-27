/** Device IDs are scoped pseudonyms, never a permanent hardware identity. */
export const deviceIdPattern = /^hgd1_[a-f0-9]{64}$/;
export const deviceScopes = ['android_user_signing_key_app', 'android_user_app_legacy'] as const;
export type DeviceKind = 'stable' | 'installation' | 'unknown';
export interface DeviceSummary {
  key: string;
  kind: DeviceKind;
  deviceId: string | null;
  shortCode: string | null;
  source: string | null;
  scope: string | null;
  model: string | null;
  system: string | null;
  latestRelease: string | null;
  sdkVersion: string | null;
  anomalyCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastReportedAt: number | null;
}
export interface DeviceList {
  devices: DeviceSummary[];
  totals: { stableDevices: number; installations: number; unidentifiedEvents: number };
  total: number;
}
export function hasStableDeviceId(event: Record<string, unknown>): boolean {
  return event.deviceIdStatus === 'available' && typeof event.deviceId === 'string'
    && deviceIdPattern.test(event.deviceId) && event.deviceIdSource === 'android_id'
    && deviceScopes.some(scope => scope === event.deviceIdScope) && event.deviceIdReason === undefined;
}
export function deviceIdentityIsConsistent(event: Record<string, unknown>): boolean {
  if (event.deviceIdStatus === 'available') return hasStableDeviceId(event);
  if (event.deviceIdStatus === 'unavailable') return event.deviceId === undefined;
  return ['deviceId', 'deviceIdSource', 'deviceIdScope', 'deviceIdReason'].every(key => event[key] === undefined);
}
export function deviceShortCode(event: Record<string, unknown>): string | null {
  return hasStableDeviceId(event) ? `HG-${String(event.deviceId).slice(5, 17).toUpperCase()}` : null;
}
export function deviceGrouping(event: Record<string, unknown>): { key: string; kind: DeviceKind } {
  if (hasStableDeviceId(event)) return { kind: 'stable', key: `stable:${event.deviceIdSource}:${event.deviceIdScope}:${event.deviceId}` };
  const installation = typeof event.anonymousId === 'string' ? event.anonymousId.trim() : '';
  if (installation && !/^(unknown|unavailable|undefined|null|未获取|未知)$/i.test(installation)) {
    return { kind: 'installation', key: `installation:${installation}` };
  }
  // Each unidentifiable event stays separate; the model is never a grouping key.
  return { kind: 'unknown', key: `unknown:${event.eventId}` };
}
export function deviceContextLines(event: Record<string, unknown>, language: 'zh' | 'en' = 'zh'): string[] {
  const zh = language === 'zh';
  const missing = zh ? '未获取' : 'Unavailable';
  const unknown = zh ? '未知' : 'Unknown';
  const info = event.deviceInfo as { model?: string; system?: string } | undefined;
  return [
    `${zh ? '设备短码' : 'Device code'}: ${deviceShortCode(event) ?? (event.deviceIdStatus === 'unavailable' ? missing : unknown)}`,
    `${zh ? '标识来源 / 作用域' : 'ID source / scope'}: ${event.deviceIdSource ?? unknown} / ${event.deviceIdScope ?? unknown}`,
    `${zh ? '标识状态' : 'ID status'}: ${event.deviceIdStatus ?? unknown}${event.deviceIdReason ? ` (${event.deviceIdReason})` : ''}`,
    `${zh ? '设备型号 / 系统' : 'Model / OS'}: ${info?.model || missing} / ${info?.system || missing}`,
    `${zh ? '本次 App 版本 / SDK' : 'Event App release / SDK'}: ${event.release || missing} / ${event.sdkVersion || missing}`
  ];
}
