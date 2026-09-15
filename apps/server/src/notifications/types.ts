import type { IssueSummary } from '../store/types';

export interface SenderConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromEmail: string;
  fromName: string;
  passwordEncrypted: string;
}

export interface NotificationRule {
  enabled: boolean;
  recipients: string[];
  onNewIssue: boolean;
  onRegression: boolean;
  threshold: number;
  cooldownMinutes: number;
}

export const defaultRule: NotificationRule = {
  enabled: false, recipients: [], onNewIssue: true, onRegression: true,
  threshold: 10, cooldownMinutes: 30
};

export type NotificationReason = 'test' | 'new_issue' | 'regression' | 'threshold';
export type DeferredAlertReason = 'new_issue' | 'regression';
export interface NotificationJob {
  id: string;
  ownerUserId: string;
  appKey: string;
  issueId: string | null;
  reason: NotificationReason;
  subject: string;
  text: string;
  recipients: string[];
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'canceled';
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NotificationStore {
  getSender(userId: string): Promise<SenderConfig | null>;
  saveSender(userId: string, config: SenderConfig | null): Promise<void>;
  getRule(appKey: string): Promise<NotificationRule>;
  saveRule(appKey: string, rule: NotificationRule): Promise<void>;
  deferLocalTrigger(appKey: string, issueId: string, reason: DeferredAlertReason): Promise<void>;
  takeLocalTrigger(issueId: string): Promise<DeferredAlertReason | null>;
  enqueue(job: NotificationJob, cooldownMs: number): Promise<boolean>;
  listJobs(userId: string, appKey: string): Promise<NotificationJob[]>;
  claimJob(now: number): Promise<NotificationJob | null>;
  finishJob(id: string, status: NotificationJob['status'], error: string | null, now: number): Promise<void>;
}

export function alertReason(before: IssueSummary | null, after: IssueSummary, rule: NotificationRule): NotificationReason | null {
  if (!rule.enabled) return null;
  if (!before && rule.onNewIssue) return 'new_issue';
  if (before && before.status !== 'open' && after.status === 'open' && rule.onRegression) return 'regression';
  if (rule.threshold > 0 && after.eventCount >= rule.threshold) return 'threshold';
  return null;
}
