import type { ErrorEvent, HealthGuardEvent } from '@healthguard/core';
import type { AppRecord, IssueSummary, Store, UserRecord, OverviewTotals, IssueDetail } from './types';

export interface MemoryStoreState {
  users: UserRecord[];
  sessions: Map<string, string>;
  apps: AppRecord[];
  events: HealthGuardEvent[];
  issues: Map<string, IssueSummary>;
}

export function createMemoryStore(): Store {
  const state: MemoryStoreState = {
    users: [],
    sessions: new Map(),
    apps: [],
    events: [],
    issues: new Map()
  };

  return {
    async createUser(user: UserRecord): Promise<void> {
      state.users.push(user);
    },

    async findUserByEmail(email: string): Promise<UserRecord | null> {
      return state.users.find((user) => user.email === email) ?? null;
    },

    async findUserById(id: string): Promise<UserRecord | null> {
      return state.users.find((user) => user.id === id) ?? null;
    },

    async createSession(token: string, userId: string): Promise<void> {
      state.sessions.set(token, userId);
    },

    async findUserBySessionToken(token: string): Promise<UserRecord | null> {
      const userId = state.sessions.get(token);
      if (!userId) return null;
      return state.users.find((user) => user.id === userId) ?? null;
    },

    async createApp(app: AppRecord): Promise<void> {
      state.apps.push(app);
    },

    async listAppsByUser(userId: string): Promise<AppRecord[]> {
      return state.apps
        .filter((record) => record.ownerUserId === userId)
        .sort((left, right) => right.createdAt - left.createdAt);
    },

    async ingestEvents(events: HealthGuardEvent[]): Promise<void> {
      state.events.push(...events);
      for (const event of events) {
        if (event.type === 'error') {
          aggregateError(state, event);
        }
      }
    },

    async listIssues(appKey?: string, platform?: string): Promise<IssueSummary[]> {
      return Array.from(state.issues.values())
        .filter((issue) => (appKey ? issue.appKey === appKey : true))
        .filter((issue) => (platform ? (issue.platformDistribution[platform] ?? 0) > 0 : true))
        .sort((left, right) => right.lastSeenAt - left.lastSeenAt);
    },

    async getOverview(appKey?: string, platform?: string): Promise<OverviewTotals> {
      const events = filterEvents(state.events, appKey, platform);
      const issues = Array.from(state.issues.values())
        .filter((issue) => (appKey ? issue.appKey === appKey : true))
        .filter((issue) => (platform ? (issue.platformDistribution[platform] ?? 0) > 0 : true));
      const affectedUsers = new Set(events.map((event) => event.userId ?? event.anonymousId));

      return {
        events: events.length,
        errors: events.filter((event) => event.type === 'error').length,
        failedRequests: events.filter((event) => event.type === 'http' && !event.success).length,
        affectedUsers: affectedUsers.size,
        issues: issues.length
      };
    },

    async getIssueDetail(id: string, platform?: string): Promise<IssueDetail> {
      const issue = state.issues.get(id) ?? null;
      if (!issue) {
        return { issue: null, events: [] };
      }
      const events = state.events
        .filter((event) => event.type === 'error' && event.appKey === issue.appKey && event.fingerprint === issue.fingerprint)
        .filter((event) => (platform ? event.platform === platform : true))
        .sort((left, right) => right.timestamp - left.timestamp);

      return { issue, events };
    }
  };
}

function aggregateError(state: MemoryStoreState, event: ErrorEvent): void {
  const key = `${event.appKey}:${event.fingerprint}`;
  const existing = state.issues.get(key);

  if (existing) {
    existing.eventCount += 1;
    existing.lastSeenAt = Math.max(existing.lastSeenAt, event.timestamp);
    existing.platformDistribution[event.platform] = (existing.platformDistribution[event.platform] ?? 0) + 1;
    return;
  }

  state.issues.set(key, {
    id: key,
    appKey: event.appKey,
    fingerprint: event.fingerprint,
    message: event.message,
    errorType: event.errorType,
    eventCount: 1,
    firstSeenAt: event.timestamp,
    lastSeenAt: event.timestamp,
    platformDistribution: { [event.platform]: 1 }
  });
}

function filterEvents(events: HealthGuardEvent[], appKey?: string, platform?: string): HealthGuardEvent[] {
  return events.filter((event) => (appKey ? event.appKey === appKey : true)).filter((event) => (platform ? event.platform === platform : true));
}
