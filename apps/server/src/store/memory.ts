import { createHttpFingerprint, extractPathname } from '@health-guard/core';
import type { ErrorEvent, HealthGuardEvent, HttpEvent } from '@health-guard/core';
import type { AppRecord, IssueSummary, Store, UserRecord, OverviewTotals, IssueDetail, IssueQuery, CreateRepairTaskInput, RepairTask, RepairTaskNote } from './types';

export interface MemoryStoreState {
  users: UserRecord[];
  sessions: Map<string, string>;
  apps: AppRecord[];
  events: HealthGuardEvent[];
  issues: Map<string, IssueSummary>;
  repairTasks: RepairTask[];
  repairTaskNotes: RepairTaskNote[];
}

export function createMemoryStore(): Store {
  const state: MemoryStoreState = {
    users: [],
    sessions: new Map(),
    apps: [],
    events: [],
    issues: new Map(),
    repairTasks: [],
    repairTaskNotes: []
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
      for (const event of events) {
        let payload = event;

        if (event.type === 'http' && !event.success) {
          payload = { ...event, fingerprint: createHttpFingerprint(event) };
        }

        state.events.push(payload);

        if (event.type === 'error') {
          aggregateError(state, event);
        }

        if (event.type === 'http' && !event.success) {
          aggregateHttpIssue(state, payload as HttpEvent & { fingerprint: string });
        }
      }
    },

    async listIssues(query: IssueQuery = {}): Promise<IssueSummary[]> {
      const {
        appKey,
        platform,
        status = 'open',
        startTime,
        endTime,
        limit = 100,
        offset = 0
      } = query;
      return Array.from(state.issues.values())
        .filter((issue) => (appKey ? issue.appKey === appKey : true))
        .filter((issue) => (platform ? (issue.platformDistribution[platform] ?? 0) > 0 : true))
        .filter((issue) => matchesIssueStatus(issue, status))
        .filter((issue) => matchesTimeRange(issue.lastSeenAt, startTime, endTime))
        .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
        .slice(offset, offset + limit);
    },

    async getOverview(query: IssueQuery = {}): Promise<OverviewTotals> {
      const { appKey, platform, status = 'open', startTime, endTime } = query;
      const events = filterEvents(state.events, appKey, platform);
      const issues = Array.from(state.issues.values())
        .filter((issue) => (appKey ? issue.appKey === appKey : true))
        .filter((issue) => (platform ? (issue.platformDistribution[platform] ?? 0) > 0 : true))
        .filter((issue) => matchesIssueStatus(issue, status))
        .filter((issue) => matchesTimeRange(issue.lastSeenAt, startTime, endTime));
      const rangedEvents = events.filter((event) => matchesTimeRange(event.timestamp, startTime, endTime));
      const affectedUsers = new Set(rangedEvents.map((event) => event.userId ?? event.anonymousId));

      return {
        events: rangedEvents.length,
        errors: rangedEvents.filter((event) => event.type === 'error').length,
        failedRequests: rangedEvents.filter((event) => event.type === 'http' && !event.success).length,
        affectedUsers: affectedUsers.size,
        issues: issues.length
      };
    },

    async getAppsOverview(appKeys: string[]): Promise<Array<{ appKey: string; totals: OverviewTotals }>> {
      if (appKeys.length === 0) return [];

      return appKeys.map((appKey) => {
        const events = filterEvents(state.events, appKey);
        const issues = Array.from(state.issues.values()).filter((issue) => issue.appKey === appKey).filter((issue) => !issue.archived);
        const affectedUsers = new Set(events.map((event) => event.userId ?? event.anonymousId));

        return {
          appKey,
          totals: {
            events: events.length,
            errors: events.filter((event) => event.type === 'error').length,
            failedRequests: events.filter((event) => event.type === 'http' && !event.success).length,
            affectedUsers: affectedUsers.size,
            issues: issues.length
          }
        };
      });
    },

    async getIssueDetail(id: string, platform?: string, eventLimit = 50, startTime?: number, endTime?: number): Promise<IssueDetail> {
      const issue = state.issues.get(id) ?? null;
      if (!issue) {
        return { issue: null, events: [] };
      }
      const eventType = issue.errorType === 'http' ? 'http' : 'error';
      const events = state.events
        .filter((event) => event.type === eventType && event.appKey === issue.appKey && 'fingerprint' in event && event.fingerprint === issue.fingerprint)
        .filter((event) => (platform ? event.platform === platform : true))
        .filter((event) => matchesTimeRange(event.timestamp, startTime, endTime))
        .sort((left, right) => right.timestamp - left.timestamp)
        .slice(0, eventLimit);

      return { issue, events };
    },

    async archiveIssue(id: string, archivedAt: number): Promise<IssueSummary | null> {
      const issue = state.issues.get(id) ?? null;
      if (!issue) return null;
      issue.archived = true;
      issue.archivedAt = archivedAt;
      return issue;
    },

    async reopenIssue(id: string): Promise<IssueSummary | null> {
      const issue = state.issues.get(id) ?? null;
      if (!issue) return null;
      issue.archived = false;
      issue.archivedAt = null;
      return issue;
    },

    async createRepairTask(input: CreateRepairTaskInput): Promise<RepairTask> {
      const task: RepairTask = {
        id: `repair_${state.repairTasks.length + 1}`,
        issueId: input.issueId,
        appKey: input.appKey,
        ownerUserId: input.ownerUserId,
        status: 'pending',
        agent: input.agent,
        repoUrl: input.repoUrl,
        baseBranch: input.baseBranch,
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      };
      const note: RepairTaskNote = {
        id: `repair_note_${state.repairTaskNotes.length + 1}`,
        taskId: task.id,
        actor: 'healthguard',
        message: 'Repair task created.',
        createdAt: input.createdAt
      };

      state.repairTasks.push(task);
      state.repairTaskNotes.push(note);

      return task;
    },

    async listRepairTasks(appKey: string, ownerUserId: string): Promise<RepairTask[]> {
      return state.repairTasks
        .filter((task) => task.appKey === appKey && task.ownerUserId === ownerUserId)
        .sort((left, right) => right.updatedAt - left.updatedAt);
    },

    async getRepairTaskDetail(id: string, ownerUserId: string): Promise<{ task: RepairTask | null; notes: RepairTaskNote[] }> {
      const task = state.repairTasks.find((record) => record.id === id && record.ownerUserId === ownerUserId) ?? null;
      if (!task) return { task: null, notes: [] };
      const notes = state.repairTaskNotes
        .filter((note) => note.taskId === id)
        .sort((left, right) => left.createdAt - right.createdAt);

      return { task, notes };
    },

    async cancelRepairTask(id: string, ownerUserId: string, canceledAt: number): Promise<RepairTask | null> {
      const task = state.repairTasks.find((record) => record.id === id && record.ownerUserId === ownerUserId) ?? null;
      if (!task) return null;
      if (!['pending', 'claimed', 'running'].includes(task.status)) return task;

      task.status = 'canceled';
      task.updatedAt = canceledAt;
      task.completedAt = canceledAt;
      state.repairTaskNotes.push({
        id: `repair_note_${state.repairTaskNotes.length + 1}`,
        taskId: task.id,
        actor: 'user',
        message: 'Repair task canceled.',
        createdAt: canceledAt
      });

      return task;
    }
  };
}

function matchesIssueStatus(issue: IssueSummary, status: IssueQuery['status'] = 'open'): boolean {
  if (status === 'all') return true;
  if (status === 'archived') return issue.archived;
  return !issue.archived;
}

function matchesTimeRange(timestamp: number, startTime?: number, endTime?: number): boolean {
  if (startTime !== undefined && timestamp < startTime) return false;
  if (endTime !== undefined && timestamp > endTime) return false;
  return true;
}

function aggregateError(state: MemoryStoreState, event: ErrorEvent): void {
  const key = `${event.appKey}:${event.fingerprint}`;
  const existing = state.issues.get(key);

  if (existing) {
    existing.eventCount += 1;
    existing.lastSeenAt = Math.max(existing.lastSeenAt, event.timestamp);
    existing.platformDistribution[event.platform] = (existing.platformDistribution[event.platform] ?? 0) + 1;
    existing.archived = false;
    existing.archivedAt = null;
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
    platformDistribution: { [event.platform]: 1 },
    archived: false,
    archivedAt: null
  });
}

function aggregateHttpIssue(state: MemoryStoreState, event: HttpEvent & { fingerprint: string }): void {
  const key = `${event.appKey}:${event.fingerprint}`;
  const existing = state.issues.get(key);
  const pathname = extractPathname(event.url);
  const message = event.errorMessage
    ? `${event.method} ${pathname} - ${event.errorMessage}`
    : `${event.method} ${pathname}`;

  if (existing) {
    existing.eventCount += 1;
    existing.lastSeenAt = Math.max(existing.lastSeenAt, event.timestamp);
    existing.platformDistribution[event.platform] = (existing.platformDistribution[event.platform] ?? 0) + 1;
    existing.archived = false;
    existing.archivedAt = null;
    return;
  }

  state.issues.set(key, {
    id: key,
    appKey: event.appKey,
    fingerprint: event.fingerprint,
    message,
    errorType: 'http',
    eventCount: 1,
    firstSeenAt: event.timestamp,
    lastSeenAt: event.timestamp,
    platformDistribution: { [event.platform]: 1 },
    archived: false,
    archivedAt: null
  });
}

function filterEvents(events: HealthGuardEvent[], appKey?: string, platform?: string): HealthGuardEvent[] {
  return events.filter((event) => (appKey ? event.appKey === appKey : true)).filter((event) => (platform ? event.platform === platform : true));
}
