import type { Pool, PoolClient } from 'pg';
import { createHttpFingerprint, extractPathname } from '@healthguard/core';
import type { ErrorEvent, HealthGuardEvent, HttpEvent } from '@healthguard/core';
import type { AppRecord, IssueSummary, Store, UserRecord, OverviewTotals, IssueDetail } from './types';

function httpIssueMessage(event: { method: string; url: string; errorMessage?: string }): string {
  const pathname = extractPathname(event.url);
  return event.errorMessage
    ? `${event.method} ${pathname} - ${event.errorMessage}`
    : `${event.method} ${pathname}`;
}

export interface PostgresStoreOptions {
  pool: Pool;
  sessionTtlMs?: number;
}

export async function createPostgresStore(options: PostgresStoreOptions): Promise<Store> {
  const { pool, sessionTtlMs = 7 * 24 * 60 * 60 * 1000 } = options;
  await ensureSchema(pool);
  await backfillFailedHttpIssues(pool);

  return {
    async createUser(user: UserRecord): Promise<void> {
      await pool.query(
        'INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)',
        [user.id, user.email, user.passwordHash, user.createdAt]
      );
    },

    async findUserByEmail(email: string): Promise<UserRecord | null> {
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (result.rows.length === 0) return null;
      return rowToUser(result.rows[0]);
    },

    async findUserById(id: string): Promise<UserRecord | null> {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      if (result.rows.length === 0) return null;
      return rowToUser(result.rows[0]);
    },

    async createSession(token: string, userId: string): Promise<void> {
      await pool.query(
        'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000 + $3)',
        [token, userId, sessionTtlMs]
      );
    },

    async findUserBySessionToken(token: string): Promise<UserRecord | null> {
      const result = await pool.query(
        'SELECT u.* FROM users u JOIN sessions s ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > EXTRACT(EPOCH FROM NOW()) * 1000',
        [token]
      );
      if (result.rows.length === 0) return null;
      return rowToUser(result.rows[0]);
    },

    async createApp(app: AppRecord): Promise<void> {
      await pool.query(
        'INSERT INTO apps (id, name, app_key, type, owner_user_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [app.id, app.name, app.appKey, app.type, app.ownerUserId, app.createdAt]
      );
    },

    async listAppsByUser(userId: string): Promise<AppRecord[]> {
      const result = await pool.query(
        'SELECT * FROM apps WHERE owner_user_id = $1 ORDER BY created_at DESC',
        [userId]
      );
      return result.rows.map(rowToApp);
    },

    async ingestEvents(events: HealthGuardEvent[]): Promise<void> {
      if (events.length === 0) return;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const values: unknown[] = [];
        const placeholders: string[] = [];

        for (let i = 0; i < events.length; i++) {
          let payload = events[i];
          if (payload.type === 'http' && !payload.success) {
            payload = { ...payload, fingerprint: createHttpFingerprint(payload) };
          }

          const offset = i * 13;
          placeholders.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13})`
          );
          values.push(
            payload.eventId,
            payload.appKey,
            payload.platform,
            payload.type,
            payload.timestamp,
            payload.sessionId,
            payload.userId ?? null,
            payload.anonymousId,
            payload.release ?? null,
            payload.environment ?? null,
            payload.pageUrl ?? null,
            payload.sdkVersion,
            JSON.stringify(payload)
          );
        }

        await client.query(
          `INSERT INTO events (
            event_id, app_key, platform, type, timestamp, session_id, user_id,
            anonymous_id, release, environment, page_url, sdk_version, payload
          ) VALUES ${placeholders.join(', ')}`,
          values
        );

        for (const event of events) {
          if (event.type === 'error') {
            await upsertIssue(client, event as ErrorEvent);
          }
          if (event.type === 'http' && !event.success) {
            const payload = { ...event, fingerprint: createHttpFingerprint(event) } as HttpEvent & { fingerprint: string };
            await upsertHttpIssue(client, payload);
          }
        }

        await client.query('COMMIT');
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* ignore rollback failure */ }
        throw err;
      } finally {
        client.release();
      }
    },

    async listIssues(appKey?: string, platform?: string, limit = 100, offset = 0): Promise<IssueSummary[]> {
      let sql = 'SELECT * FROM issues';
      const params: (string | number)[] = [];
      const conditions: string[] = [];

      if (appKey) {
        conditions.push(`app_key = $${params.length + 1}`);
        params.push(appKey);
      }

      if (platform) {
        conditions.push(`platform_distribution->>$${params.length + 1} IS NOT NULL`);
        params.push(platform);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ` ORDER BY last_seen_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await pool.query(sql, params);
      return result.rows.map(rowToIssue);
    },

    async getOverview(appKey?: string, platform?: string): Promise<OverviewTotals> {
      let eventSql = 'SELECT COUNT(*)::int as total, COUNT(CASE WHEN type = $1 THEN 1 END)::int as errors, COUNT(CASE WHEN type = $2 AND (payload->>\'success\')::boolean = false THEN 1 END)::int as failed_requests FROM events';
      const eventParams: (string | number)[] = ['error', 'http'];
      const conditions: string[] = [];

      if (appKey) {
        conditions.push(`app_key = $${eventParams.length + 1}`);
        eventParams.push(appKey);
      }

      if (platform) {
        conditions.push(`platform = $${eventParams.length + 1}`);
        eventParams.push(platform);
      }

      if (conditions.length > 0) {
        eventSql += ' WHERE ' + conditions.join(' AND ');
      }

      const eventResult = await pool.query(eventSql, eventParams);
      const row = eventResult.rows[0];

      let userSql = 'SELECT COUNT(DISTINCT COALESCE(user_id, anonymous_id))::int as affected_users FROM events';
      const userParams: (string | number)[] = [];
      const userConditions: string[] = [];

      if (appKey) {
        userConditions.push(`app_key = $${userParams.length + 1}`);
        userParams.push(appKey);
      }
      if (platform) {
        userConditions.push(`platform = $${userParams.length + 1}`);
        userParams.push(platform);
      }
      if (userConditions.length > 0) {
        userSql += ' WHERE ' + userConditions.join(' AND ');
      }

      const userResult = await pool.query(userSql, userParams);

      let issueSql = 'SELECT COUNT(*)::int as issues FROM issues';
      const issueParams: (string | number)[] = [];
      const issueConditions: string[] = [];

      if (appKey) {
        issueConditions.push(`app_key = $${issueParams.length + 1}`);
        issueParams.push(appKey);
      }

      if (platform) {
        issueConditions.push(`platform_distribution->>$${issueParams.length + 1} IS NOT NULL`);
        issueParams.push(platform);
      }

      if (issueConditions.length > 0) {
        issueSql += ' WHERE ' + issueConditions.join(' AND ');
      }

      const issueResult = await pool.query(issueSql, issueParams);

      return {
        events: row.total ?? 0,
        errors: row.errors ?? 0,
        failedRequests: row.failed_requests ?? 0,
        affectedUsers: userResult.rows[0]?.affected_users ?? 0,
        issues: issueResult.rows[0]?.issues ?? 0
      };
    },

    async getAppsOverview(appKeys: string[]): Promise<Array<{ appKey: string; totals: OverviewTotals }>> {
      if (appKeys.length === 0) return [];

      const eventSql = `
        SELECT app_key,
               COUNT(*)::int as total,
               COUNT(CASE WHEN type = $1 THEN 1 END)::int as errors,
               COUNT(CASE WHEN type = $2 AND (payload->>'success')::boolean = false THEN 1 END)::int as failed_requests
        FROM events
        WHERE app_key = ANY($3)
        GROUP BY app_key
      `;
      const eventResult = await pool.query(eventSql, ['error', 'http', appKeys]);

      const userSql = `
        SELECT app_key, COUNT(DISTINCT COALESCE(user_id, anonymous_id))::int as affected_users
        FROM events
        WHERE app_key = ANY($1)
        GROUP BY app_key
      `;
      const userResult = await pool.query(userSql, [appKeys]);

      const issueSql = `
        SELECT app_key, COUNT(*)::int as issues
        FROM issues
        WHERE app_key = ANY($1)
        GROUP BY app_key
      `;
      const issueResult = await pool.query(issueSql, [appKeys]);

      const userMap = new Map<string, number>();
      for (const row of userResult.rows) {
        userMap.set(String(row.app_key), Number(row.affected_users));
      }

      const issueMap = new Map<string, number>();
      for (const row of issueResult.rows) {
        issueMap.set(String(row.app_key), Number(row.issues));
      }

      const totalsMap = new Map<string, OverviewTotals>();
      for (const row of eventResult.rows) {
        const key = String(row.app_key);
        totalsMap.set(key, {
          events: Number(row.total),
          errors: Number(row.errors),
          failedRequests: Number(row.failed_requests),
          affectedUsers: 0,
          issues: 0
        });
      }

      for (const [appKey, totals] of totalsMap) {
        totals.affectedUsers = userMap.get(appKey) ?? 0;
        totals.issues = issueMap.get(appKey) ?? 0;
      }

      return appKeys.map((appKey) => ({
        appKey,
        totals: totalsMap.get(appKey) ?? { events: 0, errors: 0, failedRequests: 0, affectedUsers: 0, issues: 0 }
      }));
    },

    async getIssueDetail(id: string, platform?: string, eventLimit = 50): Promise<IssueDetail> {
      const issueResult = await pool.query('SELECT * FROM issues WHERE id = $1', [id]);
      if (issueResult.rows.length === 0) {
        return { issue: null, events: [] };
      }

      const issue = rowToIssue(issueResult.rows[0]);
      const eventType = issue.errorType === 'http' ? 'http' : 'error';

      let sql = 'SELECT payload FROM events WHERE type = $1 AND app_key = $2 AND payload->>\'fingerprint\' = $3';
      const params: (string | number)[] = [eventType, issue.appKey, issue.fingerprint];

      if (platform) {
        sql += ` AND platform = $${params.length + 1}`;
        params.push(platform);
      }

      sql += ` ORDER BY timestamp DESC LIMIT $${params.length + 1}`;
      params.push(eventLimit);

      const eventResult = await pool.query(sql, params);
      const events = eventResult.rows.map((row) => parsePayload(row.payload));

      return { issue, events };
    },

    async cleanup(retentionDays = 30): Promise<{ deletedEvents: number; deletedSessions: number }> {
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      const eventResult = await pool.query('DELETE FROM events WHERE timestamp < $1', [cutoff]);
      const sessionResult = await pool.query('DELETE FROM sessions WHERE expires_at < EXTRACT(EPOCH FROM NOW()) * 1000');
      return {
        deletedEvents: eventResult.rowCount ?? 0,
        deletedSessions: sessionResult.rowCount ?? 0
      };
    }
  };
}

async function ensureSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      expires_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000 + ${7 * 24 * 60 * 60 * 1000}
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS apps (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      app_key VARCHAR(64) UNIQUE NOT NULL,
      type VARCHAR(32) NOT NULL,
      owner_user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      event_id VARCHAR(64) PRIMARY KEY,
      app_key VARCHAR(64) NOT NULL,
      platform VARCHAR(32) NOT NULL,
      type VARCHAR(32) NOT NULL,
      timestamp BIGINT NOT NULL,
      session_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64),
      anonymous_id VARCHAR(64) NOT NULL,
      release VARCHAR(255),
      environment VARCHAR(32),
      page_url TEXT,
      sdk_version VARCHAR(32) NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_events_app_key ON events(app_key)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_events_platform ON events(platform)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issues (
      id VARCHAR(255) PRIMARY KEY,
      app_key VARCHAR(64) NOT NULL,
      fingerprint VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      error_type VARCHAR(32) NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      first_seen_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL,
      platform_distribution JSONB NOT NULL DEFAULT '{}'
    )
  `);

  // Migrate existing sessions table to add expires_at if missing
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sessions' AND column_name = 'expires_at'
      ) THEN
        ALTER TABLE sessions ADD COLUMN expires_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000 + ${7 * 24 * 60 * 60 * 1000};
      END IF;
    END $$;
  `);
}

async function backfillFailedHttpIssues(pool: Pool): Promise<void> {
  const result = await pool.query(
    `SELECT event_id, app_key, platform, timestamp, payload
     FROM events
     WHERE type = $1 AND (payload->>'success')::boolean = false`,
    ['http']
  );

  const aggregates = new Map<
    string,
    {
      event: HttpEvent & { fingerprint: string };
      count: number;
      firstSeenAt: number;
      lastSeenAt: number;
      platformDistribution: Record<string, number>;
    }
  >();

  for (const row of result.rows) {
    const payload = parsePayload(row.payload);
    if (payload.type !== 'http' || payload.success) {
      continue;
    }

    const fingerprint = payload.fingerprint ?? createHttpFingerprint(payload);
    const event = { ...payload, fingerprint };

    if (payload.fingerprint !== fingerprint) {
      await pool.query('UPDATE events SET payload = $1 WHERE event_id = $2', [JSON.stringify(event), row.event_id]);
    }

    const key = `${event.appKey}:${fingerprint}`;
    const existing = aggregates.get(key);

    if (existing) {
      existing.count += 1;
      existing.firstSeenAt = Math.min(existing.firstSeenAt, event.timestamp);
      existing.lastSeenAt = Math.max(existing.lastSeenAt, event.timestamp);
      existing.platformDistribution[event.platform] = (existing.platformDistribution[event.platform] ?? 0) + 1;
      continue;
    }

    aggregates.set(key, {
      event,
      count: 1,
      firstSeenAt: event.timestamp,
      lastSeenAt: event.timestamp,
      platformDistribution: { [event.platform]: 1 }
    });
  }

  for (const aggregate of aggregates.values()) {
    await upsertHttpIssueSnapshot(pool, aggregate);
  }
}

async function upsertIssue(poolOrClient: Pool | PoolClient, event: ErrorEvent): Promise<void> {
  const id = `${event.appKey}:${event.fingerprint}`;
  const existing = await poolOrClient.query('SELECT event_count, last_seen_at, platform_distribution FROM issues WHERE id = $1', [id]);

  if (existing.rows.length === 0) {
    await poolOrClient.query(
      `INSERT INTO issues (id, app_key, fingerprint, message, error_type, event_count, first_seen_at, last_seen_at, platform_distribution)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8)`,
      [id, event.appKey, event.fingerprint, event.message, event.errorType, event.timestamp, event.timestamp, JSON.stringify({ [event.platform]: 1 })]
    );
    return;
  }

  const row = existing.rows[0];
  const distribution = (row.platform_distribution as Record<string, number>) ?? {};
  distribution[event.platform] = (distribution[event.platform] ?? 0) + 1;

  await poolOrClient.query(
    `UPDATE issues SET event_count = $1, last_seen_at = $2, platform_distribution = $3 WHERE id = $4`,
    [(row.event_count as number) + 1, Math.max(Number(row.last_seen_at), event.timestamp), JSON.stringify(distribution), id]
  );
}

async function upsertHttpIssue(poolOrClient: Pool | PoolClient, event: HttpEvent & { fingerprint: string }): Promise<void> {
  const id = `${event.appKey}:${event.fingerprint}`;
  const message = httpIssueMessage(event);
  const existing = await poolOrClient.query('SELECT event_count, last_seen_at, platform_distribution FROM issues WHERE id = $1', [id]);

  if (existing.rows.length === 0) {
    await poolOrClient.query(
      `INSERT INTO issues (id, app_key, fingerprint, message, error_type, event_count, first_seen_at, last_seen_at, platform_distribution)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8)`,
      [id, event.appKey, event.fingerprint, message, 'http', event.timestamp, event.timestamp, JSON.stringify({ [event.platform]: 1 })]
    );
    return;
  }

  const row = existing.rows[0];
  const distribution = (row.platform_distribution as Record<string, number>) ?? {};
  distribution[event.platform] = (distribution[event.platform] ?? 0) + 1;

  await poolOrClient.query(
    `UPDATE issues SET event_count = $1, last_seen_at = $2, platform_distribution = $3 WHERE id = $4`,
    [(row.event_count as number) + 1, Math.max(Number(row.last_seen_at), event.timestamp), JSON.stringify(distribution), id]
  );
}

async function upsertHttpIssueSnapshot(
  pool: Pool,
  aggregate: {
    event: HttpEvent & { fingerprint: string };
    count: number;
    firstSeenAt: number;
    lastSeenAt: number;
    platformDistribution: Record<string, number>;
  }
): Promise<void> {
  const { event } = aggregate;
  const id = `${event.appKey}:${event.fingerprint}`;
  const message = httpIssueMessage(event);
  const existing = await pool.query('SELECT event_count, last_seen_at, platform_distribution FROM issues WHERE id = $1', [id]);

  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO issues (id, app_key, fingerprint, message, error_type, event_count, first_seen_at, last_seen_at, platform_distribution)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        event.appKey,
        event.fingerprint,
        message,
        'http',
        aggregate.count,
        aggregate.firstSeenAt,
        aggregate.lastSeenAt,
        JSON.stringify(aggregate.platformDistribution)
      ]
    );
    return;
  }

  await pool.query(
    `UPDATE issues SET event_count = $1, last_seen_at = $2, platform_distribution = $3 WHERE id = $4`,
    [aggregate.count, aggregate.lastSeenAt, JSON.stringify(aggregate.platformDistribution), id]
  );
}

function parsePayload(payload: unknown): HealthGuardEvent {
  if (typeof payload === 'string') {
    return JSON.parse(payload) as HealthGuardEvent;
  }
  return payload as HealthGuardEvent;
}

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    createdAt: Number(row.created_at)
  };
}

function rowToApp(row: Record<string, unknown>): AppRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    appKey: String(row.app_key),
    type: String(row.type) as AppRecord['type'],
    ownerUserId: String(row.owner_user_id),
    createdAt: Number(row.created_at)
  };
}

function rowToIssue(row: Record<string, unknown>): IssueSummary {
  return {
    id: String(row.id),
    appKey: String(row.app_key),
    fingerprint: String(row.fingerprint),
    message: String(row.message),
    errorType: String(row.error_type) as IssueSummary['errorType'],
    eventCount: Number(row.event_count),
    firstSeenAt: Number(row.first_seen_at),
    lastSeenAt: Number(row.last_seen_at),
    platformDistribution: (row.platform_distribution as Record<string, number>) ?? {}
  };
}
