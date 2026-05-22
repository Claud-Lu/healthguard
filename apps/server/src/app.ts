import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { parseEventBatch, type ErrorEvent, type EventBatch } from '@healthguard/core';
import type { AppType, IssueSummary, Store, UserRecord } from './store';

export function createServerApp(store: Store, options?: { corsOrigin?: string | boolean }): FastifyInstance {
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

  app.get<{ Querystring: { appKey?: string; platform?: string } }>('/api/issues', async (request) => {
    const issues = await store.listIssues(request.query.appKey, request.query.platform);
    return { issues };
  });

  app.get<{ Querystring: { appKey?: string; platform?: string } }>('/api/overview', async (request) => {
    const totals = await store.getOverview(request.query.appKey, request.query.platform);
    return { totals };
  });

  app.get<{ Params: { id: string }; Querystring: { platform?: string } }>('/api/issues/:id', async (request, reply) => {
    const detail = await store.getIssueDetail(request.params.id, request.query.platform);

    if (!detail.issue) {
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
