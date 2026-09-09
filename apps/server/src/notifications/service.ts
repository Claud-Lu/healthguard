import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import nodemailer from 'nodemailer';
import { nanoid } from 'nanoid';
import type { AppRecord, IssueSummary, Store } from '../store/types';
import { alertReason, type NotificationJob, type NotificationRule, type NotificationStore, type SenderConfig } from './types';

export function encryptionKey(value = process.env.HEALTHGUARD_ENCRYPTION_KEY): Buffer | null {
  if (!value) return null;
  const key = Buffer.from(value, 'base64');
  return key.length === 32 ? key : null;
}

export function encryptSecret(password: string, key: Buffer, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(userId));
  const data = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}

export function decryptSecret(value: string, key: Buffer, userId: string): string {
  const [iv, tag, data] = value.split('.').map(s => Buffer.from(s, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(userId)); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}

export async function queueIssueAlert(notifications: NotificationStore, app: AppRecord, rule: NotificationRule, before: IssueSummary | null, after: IssueSummary): Promise<void> {
  const reason = alertReason(before, after, rule);
  if (!reason || !rule.recipients.length || !await notifications.getSender(app.ownerUserId)) return;
  const labels = { new_issue: '新异常 / New issue', regression: '异常再次出现 / Regression', threshold: '达到次数阈值 / Threshold reached', test: '测试 / Test' };
  const now = Date.now();
  const subject = `[HealthGuard] ${labels[reason]} · ${app.name}`.replace(/[\r\n]/g, ' ').slice(0, 200);
  const dashboard = process.env.HEALTHGUARD_DASHBOARD_URL?.replace(/\/$/, '');
  const text = `${labels[reason]}\n\n项目 / Project: ${app.name}\n异常 / Issue: ${after.message.slice(0, 500)}\n类型 / Type: ${after.errorType}\n累计次数 / Total count: ${after.eventCount}\n版本 / Release: ${after.lastSeenRelease ?? '-'}\n最近发生 / Last seen: ${new Date(after.lastSeenAt).toISOString()}\nIssue ID: ${after.id}\n${dashboard ? `\n${dashboard}/projects/${encodeURIComponent(app.appKey)}` : ''}\n\n可在 HealthGuard 通知设置中调整规则或关闭推送。`;
  await notifications.enqueue({ id: nanoid(), ownerUserId: app.ownerUserId, appKey: app.appKey, issueId: after.id, reason, subject, text, recipients: rule.recipients, status: 'pending', error: null, createdAt: now, updatedAt: now }, rule.cooldownMinutes * 60_000);
}

export type SendMail = (sender: SenderConfig, password: string, job: NotificationJob) => Promise<void>;

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  // Only globally routable unicast IPv6. This also excludes mapped IPv4 and local ranges.
  return /^[23][0-9a-f]{3}:/i.test(address);
}

export const smtpSendMail: SendMail = async (sender, password, job) => {
  const addresses = await lookup(sender.host, { all: true });
  if (!addresses.length || (process.env.HEALTHGUARD_ALLOW_PRIVATE_SMTP !== 'true' && addresses.some(a => !publicAddress(a.address)))) {
    throw Object.assign(new Error('SMTP host is not allowed'), { code: 'SMTP_HOST_BLOCKED' });
  }
  const transport = nodemailer.createTransport({
    host: addresses[0].address, port: sender.port, secure: sender.secure, requireTLS: !sender.secure,
    tls: { servername: sender.host, minVersion: 'TLSv1.2' },
    auth: { user: sender.username, pass: password },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false
  });
  try {
    const result = await transport.sendMail({
      from: { name: sender.fromName || 'HealthGuard', address: sender.fromEmail },
      to: job.recipients, subject: job.subject, text: job.text,
      messageId: `<${job.id}@healthguard.local>`
    });
    if (result.rejected?.length) throw Object.assign(new Error('Recipients rejected'), { code: 'PARTIAL_REJECTION' });
  } finally { transport.close(); }
};

export function safeMailError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === 'EAUTH') return 'SMTP_AUTH_FAILED';
  if (code === 'SMTP_HOST_BLOCKED') return code;
  if (code === 'PARTIAL_REJECTION' || code === 'EENVELOPE') return 'RECIPIENT_REJECTED';
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNECTION' || code === 'EDNS') return 'SMTP_CONNECTION_FAILED';
  return 'SMTP_SEND_FAILED';
}

export function createNotificationWorker(store: Store, key: Buffer | null, sendMail: SendMail = smtpSendMail) {
  let running: Promise<void> | null = null;
  let stopped = false;
  async function processJob(): Promise<void> {
    if (!key || stopped) return;
    const job = await store.notifications.claimJob(Date.now());
    if (!job) return;
    const config = await store.notifications.getSender(job.ownerUserId);
    const rule = await store.notifications.getRule(job.appKey);
    if (!config || (job.reason !== 'test' && !rule.enabled)) {
      await store.notifications.finishJob(job.id, 'canceled', 'NOTIFICATIONS_DISABLED', Date.now()); return;
    }
    try {
      // Use current recipients so removed recipients never receive queued alerts.
      await sendMail(config, decryptSecret(config.passwordEncrypted, key, job.ownerUserId), { ...job, recipients: job.reason === 'test' ? job.recipients : rule.recipients });
      await store.notifications.finishJob(job.id, 'sent', null, Date.now());
    } catch (error) {
      await store.notifications.finishJob(job.id, 'failed', safeMailError(error), Date.now());
    }
  }
  return {
    run() { if (!running) running = processJob().finally(() => { running = null; }); return running; },
    async stop() { stopped = true; await running; }
  };
}
