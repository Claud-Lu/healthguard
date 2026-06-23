import { reactive, computed } from 'vue';
import { defaultLocaleFromTimeZone, getMessages, type Locale } from './i18n';
import { apiUrl, requestJson, friendlyErrorMessage } from './api';

export type AppType = 'web' | 'wechat-miniprogram' | 'alipay-miniprogram' | 'flutter' | 'uni-app' | 'other';

export interface UserRecord {
  id: string;
  email: string;
  createdAt: number;
}

export interface AppRecord {
  id: string;
  name: string;
  appKey: string;
  type: AppType;
  createdAt: number;
}

export interface IssueSummary {
  id: string;
  appKey: string;
  fingerprint: string;
  message: string;
  errorType: string;
  eventCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  firstSeenRelease: string | null;
  lastSeenRelease: string | null;
  fixedInRelease: string | null;
  verifiedInRelease: string | null;
  status: IssueLifecycleStatus;
  platformDistribution: Record<string, number>;
  archived: boolean;
  archivedAt: number | null;
}

export interface OverviewTotals {
  events: number;
  errors: number;
  failedRequests: number;
  affectedUsers: number;
  issues: number;
}

export type RepairTaskStatus = 'pending' | 'claimed' | 'running' | 'pr_created' | 'failed' | 'canceled' | 'closed';
export type RepairTaskAgent = 'hermes' | 'codex' | 'claude-code' | 'manual';
export type IssueLifecycleStatus = 'open' | 'fixed_pending_release' | 'verifying' | 'resolved' | 'archived';

export interface RepairTask {
  id: string;
  issueId: string;
  appKey: string;
  ownerUserId: string;
  status: RepairTaskStatus;
  agent: RepairTaskAgent;
  repoUrl: string;
  baseBranch: string;
  repairBranch?: string;
  prUrl?: string;
  commitSha?: string;
  summary?: string;
  failureReason?: string;
  createdAt: number;
  updatedAt: number;
  claimedAt?: number;
  completedAt?: number;
}

function initialLocale(): Locale {
  const saved = localStorage.getItem('healthguard_locale');
  if (saved === 'en-US' || saved === 'zh-CN') {
    return saved;
  }
  return defaultLocaleFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

export const store = reactive({
  locale: initialLocale(),
  token: localStorage.getItem('healthguard_token') ?? '',
  user: null as UserRecord | null,
  apps: [] as AppRecord[],
  loading: false,
  errorMessage: ''
});

export const messages = computed(() => getMessages(store.locale));

export function setLocale(nextLocale: Locale): void {
  store.locale = nextLocale;
  localStorage.setItem('healthguard_locale', nextLocale);
}

export async function loadProfile(): Promise<void> {
  if (!store.token) {
    store.user = null;
    return;
  }
  try {
    const response = await requestJson<{ user: UserRecord }>(apiUrl('/auth/me'), undefined, store.token);
    store.user = response.user;
  } catch {
    logout();
  }
}

export async function loadApps(): Promise<void> {
  if (!store.token || !store.user) {
    store.apps = [];
    return;
  }
  try {
    const response = await requestJson<{ apps: AppRecord[] }>(apiUrl('/apps'), undefined, store.token);
    store.apps = response.apps;
  } catch (error) {
    store.errorMessage = friendlyErrorMessage(error, store.locale);
  }
}

export async function loginOrRegister(mode: 'login' | 'register', email: string, password: string): Promise<boolean> {
  store.loading = true;
  store.errorMessage = '';
  try {
    const response = await requestJson<{ token: string; user: UserRecord }>(apiUrl(`/auth/${mode}`), {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    store.token = response.token;
    store.user = response.user;
    localStorage.setItem('healthguard_token', response.token);
    await loadApps();
    return true;
  } catch (error) {
    store.errorMessage = friendlyErrorMessage(error, store.locale);
    return false;
  } finally {
    store.loading = false;
  }
}

export function logout(): void {
  store.token = '';
  store.user = null;
  store.apps = [];
  localStorage.removeItem('healthguard_token');
}

export async function createApp(name: string, type: AppType): Promise<string | null> {
  if (!store.token || !name.trim()) return null;
  store.loading = true;
  store.errorMessage = '';
  try {
    const response = await requestJson<{ app: AppRecord }>(
      apiUrl('/apps'),
      { method: 'POST', body: JSON.stringify({ name: name.trim(), type }) },
      store.token
    );
    await loadApps();
    return response.app.appKey;
  } catch (error) {
    store.errorMessage = friendlyErrorMessage(error, store.locale);
    return null;
  } finally {
    store.loading = false;
  }
}
