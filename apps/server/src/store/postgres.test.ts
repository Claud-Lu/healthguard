import { describe, expect, it } from 'vitest';
import { createPostgresStore } from './postgres';

interface QueryResult {
  rows: unknown[];
  rowCount?: number;
}

interface StoredEvent {
  event_id: string;
  app_key: string;
  platform: string;
  timestamp: number;
  type: string;
  payload: Record<string, unknown>;
}

interface StoredIssue {
  id: string;
  app_key: string;
  fingerprint: string;
  message: string;
  error_type: string;
  event_count: number;
  first_seen_at: number;
  last_seen_at: number;
  first_seen_release: string | null;
  last_seen_release: string | null;
  fixed_in_release: string | null;
  verified_in_release: string | null;
  status: string;
  platform_distribution: Record<string, number>;
  archived_at: number | null;
}

interface StoredRepairTask {
  id: string;
  issue_id: string;
  app_key: string;
  owner_user_id: string;
  status: string;
  agent: string;
  repo_url: string;
  base_branch: string;
  repair_branch: string | null;
  pr_url: string | null;
  commit_sha: string | null;
  summary: string | null;
  failure_reason: string | null;
  created_at: number;
  updated_at: number;
  claimed_at: number | null;
  completed_at: number | null;
}

interface StoredRepairTaskNote {
  id: string;
  task_id: string;
  actor: string;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: number;
}

function createFakePostgresPool(events: StoredEvent[]) {
  const issues = new Map<string, StoredIssue>();
  const repairTasks = new Map<string, StoredRepairTask>();
  const repairTaskNotes: StoredRepairTaskNote[] = [];

  const fakePool = {
    issues,
    async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
      if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX') || sql.includes('DO $$') || sql.includes('ALTER TABLE')) {
        return { rows: [] };
      }

      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }

      if (sql.startsWith("UPDATE issues SET status = 'archived'")) {
        for (const issue of issues.values()) {
          if (issue.archived_at !== null) issue.status = 'archived';
        }
        return { rows: [] };
      }

      if (sql.includes('SELECT event_id, app_key, platform, timestamp, payload') && sql.includes('FROM events')) {
        return {
          rows: events.filter((event) => event.type === 'http' && event.payload.success === false)
        };
      }

      if (sql.startsWith('UPDATE events SET payload = $1 WHERE event_id = $2')) {
        const event = events.find((item) => item.event_id === params[1]);
        if (event) {
          event.payload = typeof params[0] === 'string' ? JSON.parse(params[0]) as Record<string, unknown> : params[0] as Record<string, unknown>;
        }
        return { rows: [] };
      }

      if (sql.startsWith('SELECT event_count, last_seen_at, platform_distribution FROM issues WHERE id = $1')) {
        const issue = issues.get(String(params[0]));
        return { rows: issue ? [issue] : [] };
      }

      if (sql.startsWith('INSERT INTO issues')) {
        const hasReleaseColumns = sql.includes('first_seen_release');
        const [id, appKey, fingerprint, message, errorType] = params;
        const eventCount = hasReleaseColumns ? 1 : Number(params[5]);
        const firstSeenAt = hasReleaseColumns ? params[5] : params[6];
        const lastSeenAt = hasReleaseColumns ? params[6] : params[7];
        const firstSeenRelease = hasReleaseColumns ? params[7] : null;
        const lastSeenRelease = hasReleaseColumns ? params[8] : null;
        const platformDistribution = hasReleaseColumns ? params[9] : params[8];
        issues.set(String(id), {
          id: String(id),
          app_key: String(appKey),
          fingerprint: String(fingerprint),
          message: String(message),
          error_type: String(errorType),
          event_count: Number(eventCount),
          first_seen_at: Number(firstSeenAt),
          last_seen_at: Number(lastSeenAt),
          first_seen_release: firstSeenRelease === null ? null : String(firstSeenRelease),
          last_seen_release: lastSeenRelease === null ? null : String(lastSeenRelease),
          fixed_in_release: null,
          verified_in_release: null,
          status: 'open',
          platform_distribution: JSON.parse(String(platformDistribution)) as Record<string, number>,
          archived_at: null
        });
        return { rows: [] };
      }

      if (sql.startsWith('UPDATE issues SET event_count = $1')) {
        const idIndex = sql.includes('last_seen_release') ? 4 : 3;
        const distributionIndex = sql.includes('last_seen_release') ? 3 : 2;
        const issue = issues.get(String(params[idIndex]));
        if (issue) {
          issue.event_count = Number(params[0]);
          issue.last_seen_at = Number(params[1]);
          if (sql.includes('last_seen_release') && params[2] !== null && params[2] !== undefined) {
            issue.last_seen_release = String(params[2]);
          }
          issue.platform_distribution = JSON.parse(String(params[distributionIndex])) as Record<string, number>;
        }
        return { rows: [] };
      }

      if (sql.startsWith('SELECT * FROM issues WHERE id = $1')) {
        const issue = issues.get(String(params[0]));
        return { rows: issue ? [issue] : [] };
      }

      if (sql.startsWith('SELECT * FROM issues')) {
        return { rows: Array.from(issues.values()) };
      }

      if (sql.startsWith('INSERT INTO repair_tasks')) {
        const [id, issueId, appKey, ownerUserId, status, agent, repoUrl, baseBranch, createdAt, updatedAt] = params;
        const row: StoredRepairTask = {
          id: String(id),
          issue_id: String(issueId),
          app_key: String(appKey),
          owner_user_id: String(ownerUserId),
          status: String(status),
          agent: String(agent),
          repo_url: String(repoUrl),
          base_branch: String(baseBranch),
          repair_branch: null,
          pr_url: null,
          commit_sha: null,
          summary: null,
          failure_reason: null,
          created_at: Number(createdAt),
          updated_at: Number(updatedAt),
          claimed_at: null,
          completed_at: null
        };
        repairTasks.set(row.id, row);
        return { rows: [row] };
      }

      if (sql.startsWith('INSERT INTO repair_task_notes')) {
        const [id, taskId, actor, message, metadata, createdAt] = params;
        repairTaskNotes.push({
          id: String(id),
          task_id: String(taskId),
          actor: String(actor),
          message: String(message),
          metadata: metadata ? JSON.parse(String(metadata)) as Record<string, unknown> : null,
          created_at: Number(createdAt)
        });
        return { rows: [] };
      }

      if (sql.startsWith('SELECT * FROM repair_tasks WHERE app_key = $1 AND owner_user_id = $2')) {
        return {
          rows: Array.from(repairTasks.values())
            .filter((task) => task.app_key === params[0] && task.owner_user_id === params[1])
            .sort((left, right) => right.updated_at - left.updated_at)
        };
      }

      if (sql.startsWith('SELECT * FROM repair_tasks WHERE id = $1 AND owner_user_id = $2')) {
        const task = repairTasks.get(String(params[0]));
        return { rows: task && task.owner_user_id === params[1] ? [task] : [] };
      }

      if (sql.startsWith('SELECT * FROM repair_task_notes WHERE task_id = $1')) {
        return {
          rows: repairTaskNotes
            .filter((note) => note.task_id === params[0])
            .sort((left, right) => left.created_at - right.created_at)
        };
      }

      if (sql.startsWith('UPDATE repair_tasks SET status = $1')) {
        const task = repairTasks.get(String(params[2]));
        if (!task || task.owner_user_id !== params[3]) return { rows: [] };
        task.status = String(params[0]);
        task.updated_at = Number(params[1]);
        task.completed_at = Number(params[1]);
        return { rows: [task] };
      }

      if (sql.startsWith('SELECT payload FROM events')) {
        return {
          rows: events
            .filter((event) => event.type === params[0] && event.app_key === params[1] && event.payload.fingerprint === params[2])
            .map((event) => ({ payload: event.payload }))
        };
      }

      if (sql.startsWith('DELETE FROM')) {
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`Unhandled query: ${sql}`);
    },
    async connect() {
      return {
        query: fakePool.query,
        release() {}
      };
    }
  };

  return { issues, pool: fakePool, repairTasks, repairTaskNotes };
}

describe('postgres store historical http issues', () => {
  it('backfills failed http events into queryable issues on startup', async () => {
    const { pool } = createFakePostgresPool([
      {
        event_id: 'evt_http_1',
        app_key: 'demo-app',
        platform: 'alipay-miniprogram',
        timestamp: 1710000000000,
        type: 'http',
        payload: {
          eventId: 'evt_http_1',
          appKey: 'demo-app',
          platform: 'alipay-miniprogram',
          type: 'http',
          timestamp: 1710000000000,
          sessionId: 'session-1',
          anonymousId: 'anon-1',
          sdkVersion: '0.1.0',
          method: 'GET',
          url: 'https://api.example.com/fail',
          status: 500,
          duration: 120,
          success: false
        }
      }
    ]);

    const store = await createPostgresStore({ pool: pool as never });

    const issues = await store.listIssues({ appKey: 'demo-app' });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      appKey: 'demo-app',
      message: 'GET /fail',
      errorType: 'http',
      eventCount: 1,
      platformDistribution: { 'alipay-miniprogram': 1 }
    });
  });

  it('reads jsonb payload objects when returning issue detail events', async () => {
    const { pool } = createFakePostgresPool([
      {
        event_id: 'evt_http_1',
        app_key: 'demo-app',
        platform: 'alipay-miniprogram',
        timestamp: 1710000000000,
        type: 'http',
        payload: {
          eventId: 'evt_http_1',
          appKey: 'demo-app',
          platform: 'alipay-miniprogram',
          type: 'http',
          timestamp: 1710000000000,
          sessionId: 'session-1',
          anonymousId: 'anon-1',
          sdkVersion: '0.1.0',
          method: 'GET',
          url: 'https://api.example.com/fail',
          status: 500,
          duration: 120,
          success: false
        }
      }
    ]);

    const store = await createPostgresStore({ pool: pool as never });
    const [issue] = await store.listIssues({ appKey: 'demo-app' });
    const detail = await store.getIssueDetail(issue.id);

    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]).toMatchObject({
      eventId: 'evt_http_1',
      type: 'http',
      status: 500
    });
  });

  it('persists repair tasks and notes', async () => {
    const { pool } = createFakePostgresPool([]);
    const store = await createPostgresStore({ pool: pool as never });

    const task = await store.createRepairTask({
      issueId: 'demo-app:js:boom',
      appKey: 'demo-app',
      ownerUserId: 'user_1',
      agent: 'hermes',
      repoUrl: 'git@github.com:example/demo.git',
      baseBranch: 'main',
      createdAt: 1710000000000
    });
    const tasks = await store.listRepairTasks('demo-app', 'user_1');
    const detail = await store.getRepairTaskDetail(task.id, 'user_1');
    const canceled = await store.cancelRepairTask(task.id, 'user_1', 1710000001000);

    expect(task).toMatchObject({
      issueId: 'demo-app:js:boom',
      appKey: 'demo-app',
      status: 'pending',
      agent: 'hermes'
    });
    expect(tasks).toHaveLength(1);
    expect(detail.notes).toMatchObject([
      {
        actor: 'healthguard',
        message: 'Repair task created.'
      }
    ]);
    expect(canceled).toMatchObject({
      id: task.id,
      status: 'canceled',
      completedAt: 1710000001000
    });
  });
});
