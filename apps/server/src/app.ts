import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { parseEventBatch, type EventBatch } from '@health-guard/core';
import type { AppType, IssueQuery, IssueStatusFilter, RepairTaskAgent, RepairTaskStatus, Store, UserRecord } from './store';

export function createServerApp(store: Store, options?: { corsOrigin?: string | boolean; agentToken?: string }): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' }
  });

  void app.register(cors, {
    origin: options?.corsOrigin ?? (process.env.CORS_ORIGIN || true)
  });

  void app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute'
  });

  const healthPayload = {
    ok: true,
    service: 'healthguard-server'
  };

  app.get('/health', async () => healthPayload);
  app.get('/api/health', async () => healthPayload);

  app.post<{ Body: { email?: string; password?: string } }>('/api/auth/register', async (request, reply) => {
    const credentials = normalizeCredentials(request.body);

    if (!credentials.valid) {
      return reply.status(400).send(authError(credentials.code));
    }

    const existing = await store.findUserByEmail(credentials.email);
    if (existing) {
      return reply.status(409).send(authError('EMAIL_ALREADY_REGISTERED'));
    }

    const user: UserRecord = {
      id: createId('user'),
      email: credentials.email,
      passwordHash: hashPassword(credentials.password),
      createdAt: Date.now()
    };
    const token = createId('session');

    await store.createUser(user);
    await store.createSession(token, user.id);

    return reply.status(201).send({ token, user: toPublicUser(user) });
  });

  app.post<{ Body: { email?: string; password?: string } }>('/api/auth/login', async (request, reply) => {
    const credentials = normalizeCredentials(request.body);

    if (!credentials.valid) {
      return reply.status(400).send(authError(credentials.code));
    }

    const user = await store.findUserByEmail(credentials.email);

    if (!user || !verifyPassword(credentials.password, user.passwordHash)) {
      return reply.status(401).send(authError('INVALID_CREDENTIALS'));
    }

    const token = createId('session');
    await store.createSession(token, user.id);

    return { token, user: toPublicUser(user) };
  });

  app.get('/api/auth/me', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);

    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    return { user: toPublicUser(user) };
  });

  app.get('/api/apps', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);

    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const apps = await store.listAppsByUser(user.id);
    return { apps: apps.map(toPublicApp) };
  });

  app.post<{ Body: { name?: string; type?: AppType } }>('/api/apps', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);

    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const name = request.body?.name?.trim();
    const type = request.body?.type ?? 'web';

    if (!name) {
      return reply.status(400).send({ message: 'App name is required' });
    }

    if (!isAppType(type)) {
      return reply.status(400).send({ message: 'Unsupported app type' });
    }

    const record = {
      id: createId('app_record'),
      name,
      type,
      ownerUserId: user.id,
      appKey: createId(type),
      createdAt: Date.now()
    };

    await store.createApp(record);

    return reply.status(201).send({ app: toPublicApp(record) });
  });

  app.post('/api/events/batch', {
    config: {
      rateLimit: {
        max: 200,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    let batch: EventBatch;

    try {
      batch = parseEventBatch(request.body);
    } catch (error) {
      return reply.status(400).send({
        message: error instanceof Error ? error.message : 'Invalid event batch'
      });
    }

    await store.ingestEvents(batch.events);

    return reply.status(202).send({
      accepted: batch.events.length
    });
  });

  app.get<{ Querystring: IssueQuerystring }>('/api/issues', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);
    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const issueQuery = parseIssueQuery(request.query);
    if (!issueQuery.valid) {
      return reply.status(400).send({ message: issueQuery.message });
    }

    const issues = await store.listIssues(issueQuery.query);
    return { issues };
  });

  app.get<{ Querystring: IssueQuerystring }>('/api/overview', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);
    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const issueQuery = parseIssueQuery(request.query);
    if (!issueQuery.valid) {
      return reply.status(400).send({ message: issueQuery.message });
    }

    const totals = await store.getOverview(issueQuery.query);
    return { totals };
  });

  app.get<{ Querystring: { appKeys?: string } }>('/api/apps/overview', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);
    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const raw = request.query.appKeys;
    const appKeys = raw ? raw.split(',').filter(Boolean) : [];
    const apps = await store.getAppsOverview(appKeys);
    return { apps };
  });

  app.patch<{ Params: { id: string } }>('/api/issues/:id/archive', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);
    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const detail = await store.getIssueDetail(request.params.id, undefined, 1);
    if (!detail.issue) {
      return reply.status(404).send({ message: 'Issue not found' });
    }
    if (detail.issue.status !== 'resolved' || !detail.issue.verifiedInRelease) {
      return reply.status(409).send({ message: 'verifiedInRelease is required before archiving' });
    }

    const issue = await store.archiveIssue(request.params.id, Date.now());
    if (!issue) {
      return reply.status(404).send({ message: 'Issue not found' });
    }

    return { issue };
  });

  app.patch<{ Params: { id: string } }>('/api/issues/:id/reopen', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);
    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const issue = await store.reopenIssue(request.params.id);
    if (!issue) {
      return reply.status(404).send({ message: 'Issue not found' });
    }

    return { issue };
  });

  app.patch<{ Params: { id: string }; Body: IssueReleaseBody }>('/api/issues/:id/fixed', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);
    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const fixedInRelease = parseReleaseBodyValue(request.body, 'fixedInRelease');
    if (!fixedInRelease) {
      return reply.status(400).send({ message: 'fixedInRelease is required' });
    }

    const issue = await store.markIssueFixed(request.params.id, fixedInRelease);
    if (!issue) {
      return reply.status(404).send({ message: 'Issue not found' });
    }

    return { issue };
  });

  app.patch<{ Params: { id: string }; Body: IssueReleaseBody }>('/api/issues/:id/verified', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);
    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const verifiedInRelease = parseReleaseBodyValue(request.body, 'verifiedInRelease');
    if (!verifiedInRelease) {
      return reply.status(400).send({ message: 'verifiedInRelease is required' });
    }

    const issue = await store.markIssueVerified(request.params.id, verifiedInRelease);
    if (!issue) {
      return reply.status(404).send({ message: 'Issue not found' });
    }

    return { issue };
  });

  app.post<{ Body: CreateRepairTaskBody }>('/api/repair-tasks', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);
    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const body = parseCreateRepairTaskBody(request.body);
    if (!body.valid) {
      return reply.status(400).send({ message: body.message });
    }

    const detail = await store.getIssueDetail(body.input.issueId, undefined, 1);
    if (!detail.issue) {
      return reply.status(404).send({ message: 'Issue not found' });
    }

    const owned = await userOwnsAppKey(store, user.id, detail.issue.appKey);
    if (!owned) {
      return reply.status(404).send({ message: 'Issue not found' });
    }

    const task = await store.createRepairTask({
      issueId: detail.issue.id,
      appKey: detail.issue.appKey,
      ownerUserId: user.id,
      agent: body.input.agent,
      repoUrl: body.input.repoUrl,
      baseBranch: body.input.baseBranch,
      createdAt: Date.now()
    });

    return reply.status(201).send({ task });
  });

  app.get<{ Querystring: { appKey?: string } }>('/api/repair-tasks', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);
    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const appKey = request.query.appKey?.trim();
    if (!appKey) {
      return reply.status(400).send({ message: 'appKey is required' });
    }

    const owned = await userOwnsAppKey(store, user.id, appKey);
    if (!owned) {
      return reply.status(404).send({ message: 'App not found' });
    }

    const tasks = await store.listRepairTasks(appKey, user.id);
    return { tasks };
  });

  app.get<{ Params: { id: string } }>('/api/repair-tasks/:id', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);
    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const detail = await store.getRepairTaskDetail(request.params.id, user.id);
    if (!detail.task) {
      return reply.status(404).send({ message: 'Repair task not found' });
    }

    return detail;
  });

  app.post<{ Params: { id: string } }>('/api/repair-tasks/:id/cancel', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);
    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const task = await store.cancelRepairTask(request.params.id, user.id, Date.now());
    if (!task) {
      return reply.status(404).send({ message: 'Repair task not found' });
    }

    return { task };
  });

  app.get<{ Querystring: AgentPendingQuerystring }>('/api/agent/repair-tasks/pending', async (request, reply) => {
    if (!authenticateAgent(request.headers.authorization, options?.agentToken)) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const query = parseAgentPendingQuery(request.query);
    if (!query.valid) {
      return reply.status(400).send({ message: query.message });
    }

    const tasks = await store.listPendingRepairTasks(query.agent, query.limit);
    return { tasks };
  });

  app.post<{ Params: { id: string }; Body: AgentClaimBody }>('/api/agent/repair-tasks/:id/claim', async (request, reply) => {
    if (!authenticateAgent(request.headers.authorization, options?.agentToken)) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const agentRunId = parseOptionalString(request.body?.agentRunId);
    const task = await store.claimRepairTask(request.params.id, agentRunId, Date.now());
    if (task) {
      return { task };
    }

    const existing = await store.getRepairTaskForAgent(request.params.id);
    if (!existing.task) {
      return reply.status(404).send({ message: 'Repair task not found' });
    }
    return reply.status(409).send({ message: 'Repair task is not pending' });
  });

  app.get<{ Params: { id: string } }>('/api/agent/repair-tasks/:id/payload', async (request, reply) => {
    if (!authenticateAgent(request.headers.authorization, options?.agentToken)) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const detail = await store.getRepairTaskForAgent(request.params.id);
    if (!detail.task) {
      return reply.status(404).send({ message: 'Repair task not found' });
    }

    const issueDetail = await store.getIssueDetail(detail.task.issueId, undefined, 5);
    if (!issueDetail.issue) {
      return reply.status(404).send({ message: 'Issue not found' });
    }

    const project = await store.findAppByKey(detail.task.appKey);
    return {
      task: detail.task,
      issue: issueDetail.issue,
      events: issueDetail.events,
      notes: detail.notes,
      project: {
        appKey: detail.task.appKey,
        name: project?.name,
        type: project?.type
      },
      instructions: {
        repoUrl: detail.task.repoUrl,
        baseBranch: detail.task.baseBranch,
        constraints: [
          'Use the repository target and branch from this payload.',
          'Run the project verification commands before marking the task closed.',
          'Update HealthGuard with a short summary, PR URL, commit SHA, or failure reason.'
        ]
      }
    };
  });

  app.post<{ Params: { id: string }; Body: AgentStatusBody }>('/api/agent/repair-tasks/:id/status', async (request, reply) => {
    if (!authenticateAgent(request.headers.authorization, options?.agentToken)) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const detail = await store.getRepairTaskForAgent(request.params.id);
    if (!detail.task) {
      return reply.status(404).send({ message: 'Repair task not found' });
    }

    const body = parseAgentStatusBody(request.body);
    if (!body.valid) {
      return reply.status(400).send({ message: body.message });
    }

    const task = await store.updateRepairTask({
      id: detail.task.id,
      status: body.input.status,
      repairBranch: body.input.repairBranch,
      prUrl: body.input.prUrl,
      commitSha: body.input.commitSha,
      summary: body.input.summary,
      failureReason: body.input.failureReason,
      updatedAt: Date.now(),
      note: {
        actor: detail.task.agent,
        message: body.input.message,
        metadata: body.input.metadata
      }
    });

    if (!task) {
      return reply.status(404).send({ message: 'Repair task not found' });
    }

    return { task };
  });

  app.get<{ Params: { id: string }; Querystring: IssueQuerystring }>('/api/issues/:id', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);
    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const issueQuery = parseIssueQuery(request.query);
    if (!issueQuery.valid) {
      return reply.status(400).send({ message: issueQuery.message });
    }

    const detail = await store.getIssueDetail(
      request.params.id,
      issueQuery.query.platform,
      undefined,
      issueQuery.query.startTime,
      issueQuery.query.endTime
    );

    if (!detail.issue) {
      return reply.status(404).send({ message: 'Issue not found' });
    }

    const visible = await userCanAccessAppKey(store, user.id, detail.issue.appKey);
    if (!visible) {
      return reply.status(404).send({ message: 'Issue not found' });
    }

    return detail;
  });

  return app;
}

async function authenticate(store: Store, authorizationHeader: string | undefined): Promise<UserRecord | null> {
  const token = authorizationHeader?.startsWith('Bearer ') ? authorizationHeader.slice('Bearer '.length) : '';
  if (!token) return null;
  return store.findUserBySessionToken(token);
}

function toPublicUser(user: UserRecord): Omit<UserRecord, 'passwordHash'> {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt
  };
}

function toPublicApp(record: { id: string; name: string; appKey: string; type: string; createdAt: number }): {
  id: string;
  name: string;
  appKey: string;
  type: string;
  createdAt: number;
} {
  return {
    id: record.id,
    name: record.name,
    appKey: record.appKey,
    type: record.type,
    createdAt: record.createdAt
  };
}

function isAppType(value: string): value is AppType {
  return ['web', 'wechat-miniprogram', 'alipay-miniprogram', 'flutter', 'uni-app', 'other'].includes(value);
}

function createId(prefix: string): string {
  return `${prefix}_${nanoid(21)}`;
}

type AuthErrorCode = 'INVALID_EMAIL' | 'PASSWORD_TOO_SHORT' | 'EMAIL_ALREADY_REGISTERED' | 'INVALID_CREDENTIALS';

interface IssueQuerystring {
  appKey?: string;
  platform?: string;
  status?: string;
  start?: string;
  end?: string;
}

interface CreateRepairTaskBody {
  issueId?: string;
  agent?: string;
  repoUrl?: string;
  baseBranch?: string;
}

interface IssueReleaseBody {
  fixedInRelease?: string;
  verifiedInRelease?: string;
}

interface AgentPendingQuerystring {
  agent?: string;
  limit?: string;
}

interface AgentClaimBody {
  agentRunId?: string;
}

interface AgentStatusBody {
  status?: string;
  message?: string;
  repairBranch?: string;
  prUrl?: string;
  commitSha?: string;
  summary?: string;
  failureReason?: string;
  metadata?: Record<string, unknown>;
}

type CredentialsResult =
  | { valid: true; email: string; password: string }
  | { valid: false; code: Extract<AuthErrorCode, 'INVALID_EMAIL' | 'PASSWORD_TOO_SHORT'>; email: string };

function normalizeCredentials(body: { email?: string; password?: string } | undefined): CredentialsResult {
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, code: 'INVALID_EMAIL', email: email ?? '' };
  }

  if (!password || password.length < 8) {
    return { valid: false, code: 'PASSWORD_TOO_SHORT', email };
  }

  return { valid: true, email, password };
}

function authError(code: AuthErrorCode): { code: AuthErrorCode; message: string } {
  const messages: Record<AuthErrorCode, string> = {
    INVALID_EMAIL: 'Please enter a valid email address.',
    PASSWORD_TOO_SHORT: 'Password must be at least 8 characters.',
    EMAIL_ALREADY_REGISTERED: 'Email is already registered.',
    INVALID_CREDENTIALS: 'Email or password is incorrect.'
  };

  return { code, message: messages[code] };
}

function parseIssueQuery(query: IssueQuerystring): { valid: true; query: IssueQuery } | { valid: false; message: string } {
  const status = query.status ?? 'open';
  if (!isIssueStatus(status)) {
    return { valid: false, message: 'Unsupported issue status' };
  }

  const startTime = parseOptionalTimestamp(query.start);
  const endTime = parseOptionalTimestamp(query.end);
  if (startTime === 'invalid' || endTime === 'invalid') {
    return { valid: false, message: 'Invalid time range' };
  }
  if (startTime !== undefined && endTime !== undefined && startTime > endTime) {
    return { valid: false, message: 'Invalid time range' };
  }

  return {
    valid: true,
    query: {
      appKey: query.appKey,
      platform: query.platform,
      status,
      startTime,
      endTime
    }
  };
}

function parseCreateRepairTaskBody(body: CreateRepairTaskBody | undefined): { valid: true; input: { issueId: string; agent: RepairTaskAgent; repoUrl: string; baseBranch: string } } | { valid: false; message: string } {
  const issueId = body?.issueId?.trim();
  const agent = body?.agent?.trim() || 'hermes';
  const repoUrl = body?.repoUrl?.trim();
  const baseBranch = body?.baseBranch?.trim() || 'main';

  if (!issueId) return { valid: false, message: 'issueId is required' };
  if (!isRepairTaskAgent(agent)) return { valid: false, message: 'Unsupported repair agent' };
  if (!repoUrl) return { valid: false, message: 'repoUrl is required' };
  if (!baseBranch) return { valid: false, message: 'baseBranch is required' };

  return {
    valid: true,
    input: {
      issueId,
      agent,
      repoUrl,
      baseBranch
    }
  };
}

function isRepairTaskAgent(value: string): value is RepairTaskAgent {
  return value === 'hermes' || value === 'codex' || value === 'claude-code' || value === 'manual';
}

function isAgentWritableRepairTaskStatus(value: string): value is RepairTaskStatus {
  return value === 'running' || value === 'pr_created' || value === 'failed' || value === 'closed';
}

function parseAgentPendingQuery(query: AgentPendingQuerystring): { valid: true; agent?: RepairTaskAgent; limit?: number } | { valid: false; message: string } {
  const agent = query.agent?.trim();
  if (agent && !isRepairTaskAgent(agent)) {
    return { valid: false, message: 'Unsupported repair agent' };
  }

  const limit = query.limit === undefined ? undefined : Number(query.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    return { valid: false, message: 'limit must be an integer between 1 and 100' };
  }

  return { valid: true, agent: agent as RepairTaskAgent | undefined, limit };
}

function parseAgentStatusBody(body: AgentStatusBody | undefined): {
  valid: true;
  input: {
    status: RepairTaskStatus;
    message: string;
    repairBranch?: string;
    prUrl?: string;
    commitSha?: string;
    summary?: string;
    failureReason?: string;
    metadata?: Record<string, unknown>;
  };
} | { valid: false; message: string } {
  const status = body?.status?.trim();
  const message = body?.message?.trim();

  if (!status || !isAgentWritableRepairTaskStatus(status)) {
    return { valid: false, message: 'Unsupported repair task status' };
  }
  if (!message) {
    return { valid: false, message: 'message is required' };
  }

  return {
    valid: true,
    input: {
      status,
      message,
      repairBranch: parseOptionalString(body?.repairBranch),
      prUrl: parseOptionalString(body?.prUrl),
      commitSha: parseOptionalString(body?.commitSha),
      summary: parseOptionalString(body?.summary),
      failureReason: parseOptionalString(body?.failureReason),
      metadata: body?.metadata
    }
  };
}

function parseOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseReleaseBodyValue(body: IssueReleaseBody | undefined, key: keyof IssueReleaseBody): string | undefined {
  return parseOptionalString(body?.[key]);
}

async function userOwnsAppKey(store: Store, userId: string, appKey: string): Promise<boolean> {
  const app = await store.findAppByKey(appKey);
  return app?.ownerUserId === userId;
}

async function userCanAccessAppKey(store: Store, userId: string, appKey: string): Promise<boolean> {
  const app = await store.findAppByKey(appKey);
  return !app || app.ownerUserId === userId;
}

function authenticateAgent(authorizationHeader: string | undefined, configuredToken?: string): boolean {
  const expected = configuredToken ?? process.env.HEALTHGUARD_AGENT_TOKEN;
  const token = authorizationHeader?.startsWith('Bearer ') ? authorizationHeader.slice('Bearer '.length) : '';
  if (!expected || !token) return false;

  const expectedBuffer = Buffer.from(expected);
  const tokenBuffer = Buffer.from(token);
  return expectedBuffer.length === tokenBuffer.length && timingSafeEqual(expectedBuffer, tokenBuffer);
}

function isIssueStatus(value: string): value is IssueStatusFilter {
  return value === 'open' || value === 'archived' || value === 'all';
}

function parseOptionalTimestamp(value: string | undefined): number | undefined | 'invalid' {
  if (value === undefined || value === '') return undefined;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : 'invalid';
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');

  if (!salt || !hash) {
    return false;
  }

  const candidate = pbkdf2Sync(password, salt, 120000, 32, 'sha256');
  const expected = Buffer.from(hash, 'hex');

  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
