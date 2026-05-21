import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { parseEventBatch, type ErrorEvent, type EventBatch, type HealthGuardEvent } from '@healthguard/core';

export type AppType = 'web' | 'wechat-miniprogram' | 'alipay-miniprogram' | 'flutter' | 'other';

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
  errorType: ErrorEvent['errorType'];
  eventCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface HealthGuardStore {
  users: UserRecord[];
  sessions: Map<string, string>;
  apps: AppRecord[];
  events: HealthGuardEvent[];
  issues: Map<string, IssueSummary>;
}

export function createServerApp(store: HealthGuardStore = createMemoryStore()): FastifyInstance {
  const app = Fastify({
    logger: false
  });

  void app.register(cors, {
    origin: true
  });

  app.get('/health', async () => ({
    ok: true,
    service: 'healthguard-server'
  }));

  app.get('/api/health', async () => ({
    ok: true,
    service: 'healthguard-server'
  }));

  app.post<{ Body: { email?: string; password?: string } }>('/api/auth/register', async (request, reply) => {
    const credentials = normalizeCredentials(request.body);

    if (!credentials.valid) {
      return reply.status(400).send(authError(credentials.code));
    }

    if (store.users.some((user) => user.email === credentials.email)) {
      return reply.status(409).send(authError('EMAIL_ALREADY_REGISTERED'));
    }

    const user: UserRecord = {
      id: createId('user'),
      email: credentials.email,
      passwordHash: hashPassword(credentials.password),
      createdAt: Date.now()
    };
    const token = createId('session');

    store.users.push(user);
    store.sessions.set(token, user.id);

    return reply.status(201).send({ token, user: toPublicUser(user) });
  });

  app.post<{ Body: { email?: string; password?: string } }>('/api/auth/login', async (request, reply) => {
    const credentials = normalizeCredentials(request.body);

    if (!credentials.valid) {
      return reply.status(400).send(authError(credentials.code));
    }

    const user = store.users.find((item) => item.email === credentials.email);

    if (!user || !verifyPassword(credentials.password, user.passwordHash)) {
      return reply.status(401).send(authError('INVALID_CREDENTIALS'));
    }

    const token = createId('session');
    store.sessions.set(token, user.id);

    return { token, user: toPublicUser(user) };
  });

  app.get('/api/auth/me', async (request, reply) => {
    const user = authenticate(store, request.headers.authorization);

    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    return { user: toPublicUser(user) };
  });

  app.get('/api/apps', async (request, reply) => {
    const user = authenticate(store, request.headers.authorization);

    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    return {
      apps: store.apps
        .filter((record) => record.ownerUserId === user.id)
        .sort((left, right) => right.createdAt - left.createdAt)
        .map(toPublicApp)
    };
  });

  app.post<{ Body: { name?: string; type?: AppType } }>('/api/apps', async (request, reply) => {
    const user = authenticate(store, request.headers.authorization);

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

    const record: AppRecord = {
      id: createId('app_record'),
      name,
      type,
      ownerUserId: user.id,
      appKey: createId(type),
      createdAt: Date.now()
    };

    store.apps.push(record);

    return reply.status(201).send({ app: toPublicApp(record) });
  });

  app.post('/api/events/batch', async (request, reply) => {
    let batch: EventBatch;

    try {
      batch = parseEventBatch(request.body);
    } catch (error) {
      return reply.status(400).send({
        message: error instanceof Error ? error.message : 'Invalid event batch'
      });
    }

    store.events.push(...batch.events);

    for (const event of batch.events) {
      if (event.type === 'error') {
        aggregateIssue(store, event);
      }
    }

    return reply.status(202).send({
      accepted: batch.events.length
    });
  });

  app.get<{ Querystring: { appKey?: string } }>('/api/issues', async (request) => {
    const issues = Array.from(store.issues.values())
      .filter((issue) => (request.query.appKey ? issue.appKey === request.query.appKey : true))
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt);

    return { issues };
  });

  app.get<{ Querystring: { appKey?: string } }>('/api/overview', async (request) => {
    const events = filterEvents(store.events, request.query.appKey);
    const issues = Array.from(store.issues.values()).filter((issue) =>
      request.query.appKey ? issue.appKey === request.query.appKey : true
    );
    const affectedUsers = new Set(events.map((event) => event.userId ?? event.anonymousId));

    return {
      totals: {
        events: events.length,
        errors: events.filter((event) => event.type === 'error').length,
        failedRequests: events.filter((event) => event.type === 'http' && !event.success).length,
        affectedUsers: affectedUsers.size,
        issues: issues.length
      }
    };
  });

  app.get<{ Params: { id: string } }>('/api/issues/:id', async (request, reply) => {
    const issue = store.issues.get(request.params.id);

    if (!issue) {
      return reply.status(404).send({ message: 'Issue not found' });
    }

    const events = store.events
      .filter((event) => event.type === 'error' && event.appKey === issue.appKey && event.fingerprint === issue.fingerprint)
      .sort((left, right) => right.timestamp - left.timestamp);

    return {
      issue,
      events
    };
  });

  return app;
}

export function createMemoryStore(): HealthGuardStore {
  return {
    users: [],
    sessions: new Map(),
    apps: [],
    events: [],
    issues: new Map()
  };
}

function aggregateIssue(store: HealthGuardStore, event: ErrorEvent): void {
  const key = `${event.appKey}:${event.fingerprint}`;
  const existing = store.issues.get(key);

  if (existing) {
    existing.eventCount += 1;
    existing.lastSeenAt = Math.max(existing.lastSeenAt, event.timestamp);
    return;
  }

  store.issues.set(key, {
    id: key,
    appKey: event.appKey,
    fingerprint: event.fingerprint,
    message: event.message,
    errorType: event.errorType,
    eventCount: 1,
    firstSeenAt: event.timestamp,
    lastSeenAt: event.timestamp
  });
}

function filterEvents(events: HealthGuardEvent[], appKey?: string): HealthGuardEvent[] {
  return events.filter((event) => (appKey ? event.appKey === appKey : true));
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

type AuthErrorCode = 'INVALID_EMAIL' | 'PASSWORD_TOO_SHORT' | 'EMAIL_ALREADY_REGISTERED' | 'INVALID_CREDENTIALS';

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

function authenticate(store: HealthGuardStore, authorizationHeader: string | undefined): UserRecord | null {
  const token = authorizationHeader?.startsWith('Bearer ') ? authorizationHeader.slice('Bearer '.length) : '';
  const userId = token ? store.sessions.get(token) : undefined;

  return userId ? (store.users.find((user) => user.id === userId) ?? null) : null;
}

function toPublicUser(user: UserRecord): Omit<UserRecord, 'passwordHash'> {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt
  };
}

function toPublicApp(record: AppRecord): Omit<AppRecord, 'ownerUserId'> {
  return {
    id: record.id,
    name: record.name,
    appKey: record.appKey,
    type: record.type,
    createdAt: record.createdAt
  };
}

function isAppType(value: string): value is AppType {
  return ['web', 'wechat-miniprogram', 'alipay-miniprogram', 'flutter', 'other'].includes(value);
}
