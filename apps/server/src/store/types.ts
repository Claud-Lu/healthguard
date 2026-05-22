import type { ErrorEvent, HealthGuardEvent } from '@healthguard/core';

export type AppType = 'web' | 'wechat-miniprogram' | 'alipay-miniprogram' | 'flutter' | 'uni-app' | 'other';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: number;
}

export interface AppRecord {
  id: string;
  name: string;
  appKey: string;
  type: AppType;
  ownerUserId: string;
  createdAt: number;
}

export interface IssueSummary {
  id: string;
  appKey: string;
  fingerprint: string;
  message: string;
  errorType: ErrorEvent['errorType'];
  eventCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  platformDistribution: Record<string, number>;
}

export interface OverviewTotals {
  events: number;
  errors: number;
  failedRequests: number;
  affectedUsers: number;
  issues: number;
}

export interface IssueDetail {
  issue: IssueSummary | null;
  events: HealthGuardEvent[];
}

export interface Store {
  createUser(user: UserRecord): Promise<void>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;

  createSession(token: string, userId: string): Promise<void>;
  findUserBySessionToken(token: string): Promise<UserRecord | null>;

  createApp(app: AppRecord): Promise<void>;
  listAppsByUser(userId: string): Promise<AppRecord[]>;

  ingestEvents(events: HealthGuardEvent[]): Promise<void>;
  listIssues(appKey?: string, platform?: string): Promise<IssueSummary[]>;
  getOverview(appKey?: string, platform?: string): Promise<OverviewTotals>;
  getIssueDetail(id: string, platform?: string): Promise<IssueDetail>;
}
