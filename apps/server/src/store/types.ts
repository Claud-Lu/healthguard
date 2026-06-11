import type { ErrorEvent, HealthGuardEvent } from '@health-guard/core';

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
  errorType: ErrorEvent['errorType'] | 'http';
  eventCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
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

export interface IssueDetail {
  issue: IssueSummary | null;
  events: HealthGuardEvent[];
}

export type RepairTaskStatus = 'pending' | 'claimed' | 'running' | 'pr_created' | 'failed' | 'canceled' | 'closed';
export type RepairTaskAgent = 'hermes' | 'codex' | 'claude-code' | 'manual';

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

export interface RepairTaskNote {
  id: string;
  taskId: string;
  actor: 'healthguard' | 'hermes' | 'codex' | 'claude-code' | 'user';
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface CreateRepairTaskInput {
  issueId: string;
  appKey: string;
  ownerUserId: string;
  agent: RepairTaskAgent;
  repoUrl: string;
  baseBranch: string;
  createdAt: number;
}

export type IssueStatusFilter = 'open' | 'archived' | 'all';

export interface IssueQuery {
  appKey?: string;
  platform?: string;
  status?: IssueStatusFilter;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
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
  listIssues(query?: IssueQuery): Promise<IssueSummary[]>;
  getOverview(query?: IssueQuery): Promise<OverviewTotals>;
  getAppsOverview(appKeys: string[]): Promise<Array<{ appKey: string; totals: OverviewTotals }>>;
  getIssueDetail(id: string, platform?: string, eventLimit?: number, startTime?: number, endTime?: number): Promise<IssueDetail>;
  archiveIssue(id: string, archivedAt: number): Promise<IssueSummary | null>;
  reopenIssue(id: string): Promise<IssueSummary | null>;
  createRepairTask(input: CreateRepairTaskInput): Promise<RepairTask>;
  listRepairTasks(appKey: string, ownerUserId: string): Promise<RepairTask[]>;
  getRepairTaskDetail(id: string, ownerUserId: string): Promise<{ task: RepairTask | null; notes: RepairTaskNote[] }>;
  cancelRepairTask(id: string, ownerUserId: string, canceledAt: number): Promise<RepairTask | null>;
  cleanup?(retentionDays?: number): Promise<{ deletedEvents: number; deletedSessions: number }>;
}
