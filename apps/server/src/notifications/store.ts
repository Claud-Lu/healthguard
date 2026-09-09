import type { Pool, PoolClient } from 'pg';
import { defaultRule, type NotificationJob, type NotificationRule, type NotificationStore, type SenderConfig } from './types';

export function createMemoryNotifications(): NotificationStore {
  const senders = new Map<string, SenderConfig>();
  const rules = new Map<string, NotificationRule>();
  const jobs: NotificationJob[] = [];
  const cooldowns = new Map<string, number>();
  return {
    async getSender(id) { return structuredClone(senders.get(id) ?? null); },
    async saveSender(id, config) { if (config) senders.set(id, structuredClone(config)); else senders.delete(id); },
    async getRule(key) { return structuredClone(rules.get(key) ?? defaultRule); },
    async saveRule(key, rule) { rules.set(key, structuredClone(rule)); },
    async enqueue(job, cooldownMs) {
      const key = job.issueId ?? `test:${job.ownerUserId}`;
      if ((cooldowns.get(key) ?? 0) > job.createdAt) return false;
      cooldowns.set(key, job.createdAt + cooldownMs);
      jobs.push(structuredClone(job));
      return true;
    },
    async listJobs(id, key) { return structuredClone(jobs.filter(j => j.ownerUserId === id && j.appKey === key).slice(-50).reverse()); },
    async claimJob(now) {
      for (const job of jobs) {
        if (job.status === 'sending' && job.updatedAt < now - 300_000) {
          job.status = 'failed'; job.error = 'DELIVERY_UNKNOWN'; job.updatedAt = now;
        }
      }
      const job = jobs.find(j => j.status === 'pending');
      if (!job) return null;
      job.status = 'sending'; job.updatedAt = now;
      return structuredClone(job);
    },
    async finishJob(id, status, error, now) { const job = jobs.find(j => j.id === id); if (job) Object.assign(job, { status, error, updatedAt: now }); }
  };
}

export async function ensureNotificationSchema(db: Pool): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS notification_senders (
    user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, config JSONB NOT NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS notification_rules (
    app_key VARCHAR(128) PRIMARY KEY REFERENCES apps(app_key) ON DELETE CASCADE, config JSONB NOT NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS notification_cooldowns (
    key TEXT PRIMARY KEY, next_at BIGINT NOT NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS notification_jobs (
    id VARCHAR(64) PRIMARY KEY, owner_user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_key VARCHAR(128) NOT NULL REFERENCES apps(app_key) ON DELETE CASCADE,
    payload JSONB NOT NULL, status VARCHAR(16) NOT NULL, error TEXT,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
  )`);
  await db.query('CREATE INDEX IF NOT EXISTS idx_notification_jobs_history ON notification_jobs (owner_user_id, app_key, created_at DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_notification_jobs_pending ON notification_jobs (created_at) WHERE status = \'pending\'');
}

export function createPostgresNotifications(db: Pool | PoolClient): NotificationStore {
  return {
    async getSender(id) { const r = await db.query('SELECT config FROM notification_senders WHERE user_id = $1', [id]); return r.rows[0]?.config ?? null; },
    async saveSender(id, config) {
      if (!config) { await db.query('DELETE FROM notification_senders WHERE user_id = $1', [id]); return; }
      await db.query('INSERT INTO notification_senders (user_id, config) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET config = EXCLUDED.config', [id, JSON.stringify(config)]);
    },
    async getRule(key) { const r = await db.query('SELECT config FROM notification_rules WHERE app_key = $1', [key]); return r.rows[0]?.config ?? structuredClone(defaultRule); },
    async saveRule(key, config) { await db.query('INSERT INTO notification_rules (app_key, config) VALUES ($1, $2) ON CONFLICT (app_key) DO UPDATE SET config = EXCLUDED.config', [key, JSON.stringify(config)]); },
    async enqueue(job, cooldownMs) {
      const result = await db.query(`WITH gate AS (
        INSERT INTO notification_cooldowns (key, next_at) VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET next_at = EXCLUDED.next_at WHERE notification_cooldowns.next_at <= $3 RETURNING key
      ) INSERT INTO notification_jobs (id, owner_user_id, app_key, payload, status, created_at, updated_at)
        SELECT $4, $5, $6, $7, 'pending', $3, $3 FROM gate RETURNING id`,
      [job.issueId ?? `test:${job.ownerUserId}`, job.createdAt + cooldownMs, job.createdAt, job.id, job.ownerUserId, job.appKey, JSON.stringify(job)]);
      return result.rows.length > 0;
    },
    async listJobs(id, key) {
      const r = await db.query('SELECT * FROM notification_jobs WHERE owner_user_id = $1 AND app_key = $2 ORDER BY created_at DESC LIMIT 50', [id, key]);
      return r.rows.map(toJob);
    },
    async claimJob(now) {
      // A crash after SMTP accepted a message is ambiguous. Do not resend and risk duplicate mail.
      await db.query("UPDATE notification_jobs SET status = 'failed', error = 'DELIVERY_UNKNOWN', updated_at = $1 WHERE status = 'sending' AND updated_at < $2", [now, now - 300_000]);
      const r = await db.query(`UPDATE notification_jobs SET status = 'sending', updated_at = $1 WHERE id = (
        SELECT id FROM notification_jobs WHERE status = 'pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
      ) RETURNING *`, [now]);
      return r.rows[0] ? toJob(r.rows[0]) : null;
    },
    async finishJob(id, status, error, now) { await db.query('UPDATE notification_jobs SET status = $2, error = $3, updated_at = $4 WHERE id = $1', [id, status, error, now]); }
  };
}

function toJob(row: Record<string, any>): NotificationJob {
  return { ...row.payload, status: row.status, error: row.error ?? null, updatedAt: Number(row.updated_at) };
}
