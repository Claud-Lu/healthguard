import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { Store, UserRecord } from '../store/types';
import { createNotificationWorker, encryptionKey, encryptSecret, type SendMail } from './service';

const clean = z.string().trim().max(255).refine(value => !/[\r\n\0]/.test(value));
const email = clean.pipe(z.string().email());
const senderSchema = z.object({
  host: clean.pipe(z.string().min(1).regex(/^[a-zA-Z0-9.-]+$/)),
  port: z.union([z.literal(25), z.literal(465), z.literal(587)]),
  secure: z.boolean(), username: clean.pipe(z.string().min(1)), fromEmail: email,
  fromName: clean.pipe(z.string().max(100)).default('HealthGuard'),
  password: z.string().max(1024).optional()
}).strict().refine(s => s.port !== 465 || s.secure, { message: 'Port 465 requires TLS.' });
const ruleSchema = z.object({
  enabled: z.boolean(), recipients: z.array(email).max(20), onNewIssue: z.boolean(), onRegression: z.boolean(),
  threshold: z.number().int().min(0).max(1_000_000), cooldownMinutes: z.number().int().min(1).max(10080)
}).strict().refine(r => !r.enabled || (r.recipients.length > 0 && (r.onNewIssue || r.onRegression || r.threshold > 0)));

export function registerNotificationRoutes(app: FastifyInstance, store: Store, options?: { encryptionKey?: string; sendMail?: SendMail; notificationWorker?: boolean }) {
  const key = encryptionKey(options?.encryptionKey);
  const worker = createNotificationWorker(store, key, options?.sendMail);
  let timer: ReturnType<typeof setInterval> | undefined;
  if (options?.notificationWorker !== false) {
    app.addHook('onReady', async () => {
      // One job per tick limits outgoing mail to 30/minute per collector.
      timer = setInterval(() => { void worker.run().catch(() => app.log.error('Notification worker failed')); }, 2000);
      timer.unref();
    });
  }
  app.addHook('onClose', async () => { clearInterval(timer); await worker.stop(); });

  void app.register(async routes => {
    routes.addHook('preHandler', async (request, reply) => {
      const token = request.headers.authorization?.replace(/^Bearer /, '');
      const user = token ? await store.findUserBySessionToken(token) : null;
      if (!user) return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Please log in again.' });
      (request as typeof request & { notificationUser: UserRecord }).notificationUser = user;
    });
    const userId = (request: unknown) => (request as { notificationUser: UserRecord }).notificationUser.id;
    const publicSender = (sender: Awaited<ReturnType<Store['notifications']['getSender']>>) => {
      if (!sender) return null;
      const { passwordEncrypted, ...safe } = sender;
      return { ...safe, hasPassword: Boolean(passwordEncrypted) };
    };
    routes.get('/api/notifications/sender', async request => ({ sender: publicSender(await store.notifications.getSender(userId(request))), encryptionReady: Boolean(key) }));
    routes.put('/api/notifications/sender', async (request, reply) => {
      if (!key) return reply.status(503).send({ code: 'ENCRYPTION_NOT_CONFIGURED', message: 'Server encryption key is not configured.' });
      const parsed = senderSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ code: 'INVALID_SENDER', message: 'Check the SMTP server, port and email fields.' });
      const { password, ...config } = parsed.data;
      const id = userId(request);
      const existing = await store.notifications.getSender(id);
      if (!password && (!existing || existing.host !== config.host || existing.port !== config.port || existing.secure !== config.secure || existing.username !== config.username)) {
        return reply.status(400).send({ code: 'SMTP_PASSWORD_REQUIRED', message: 'Enter the authorization code when adding or changing the SMTP connection.' });
      }
      const saved = { ...config, passwordEncrypted: password ? encryptSecret(password, key, id) : existing!.passwordEncrypted };
      await store.notifications.saveSender(id, saved);
      return { sender: publicSender(saved) };
    });
    routes.delete('/api/notifications/sender', async request => {
      await store.notifications.saveSender(userId(request), null);
      for (const project of await store.listAppsByUser(userId(request))) {
        await store.notifications.saveRule(project.appKey, { ...await store.notifications.getRule(project.appKey), enabled: false });
      }
      return { ok: true };
    });

    void routes.register(async projectRoutes => {
      projectRoutes.addHook('preHandler', async (request, reply) => {
        const { appKey } = request.params as { appKey: string };
        const project = await store.findAppByKey(appKey);
        if (!project || project.ownerUserId !== userId(request)) return reply.status(404).send({ code: 'APP_NOT_FOUND', message: 'Project not found.' });
      });
      projectRoutes.get<{ Params: { appKey: string } }>('/api/apps/:appKey/notifications', async request => ({ rule: await store.notifications.getRule(request.params.appKey) }));
      projectRoutes.put<{ Params: { appKey: string } }>('/api/apps/:appKey/notifications', async (request, reply) => {
        const parsed = ruleSchema.safeParse(request.body);
        if (!parsed.success) return reply.status(400).send({ code: 'INVALID_NOTIFICATION_RULE', message: 'Check recipients, trigger rules and notification interval.' });
        if (parsed.data.enabled && (!key || !await store.notifications.getSender(userId(request)))) {
          return reply.status(400).send({ code: 'SMTP_NOT_CONFIGURED', message: 'Save sender settings before enabling notifications.' });
        }
        const rule = { ...parsed.data, recipients: [...new Set(parsed.data.recipients)] };
        await store.notifications.saveRule(request.params.appKey, rule);
        return { rule };
      });
      projectRoutes.get<{ Params: { appKey: string } }>('/api/apps/:appKey/notifications/history', async request => ({ jobs: await store.notifications.listJobs(userId(request), request.params.appKey) }));
      projectRoutes.post<{ Params: { appKey: string } }>('/api/apps/:appKey/notifications/test', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
        const id = userId(request);
        if (!key || !await store.notifications.getSender(id)) return reply.status(400).send({ code: 'SMTP_NOT_CONFIGURED', message: 'Save sender settings first.' });
        const rule = await store.notifications.getRule(request.params.appKey);
        if (!rule.recipients.length) return reply.status(400).send({ code: 'RECIPIENTS_REQUIRED', message: 'Save at least one recipient first.' });
        const now = Date.now();
        const job = { id: nanoid(), ownerUserId: id, appKey: request.params.appKey, issueId: null, reason: 'test' as const,
          subject: '[HealthGuard] 邮件推送测试 / Email notification test', text: '这是一封 HealthGuard 测试邮件。收到邮件表示当前发件与收件配置可用。\n\nThis is a HealthGuard test email. Your email notification settings are working.',
          recipients: rule.recipients, status: 'pending' as const, error: null, createdAt: now, updatedAt: now };
        const queued = await store.notifications.enqueue(job, 60_000);
        if (!queued) return reply.status(429).send({ code: 'TEST_RATE_LIMITED', message: 'Wait one minute before sending another test.' });
        return reply.status(202).send({ jobId: job.id });
      });
    });
  });
  return worker;
}
