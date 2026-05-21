import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { parseEventBatch, type ErrorEvent, type EventBatch, type HealthGuardEvent } from '@healthguard/core';

export interface AppRecord {
  id: string;
  name: string;
  appKey: string;
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

  app.get('/api/apps', async () => ({
    apps: store.apps.sort((left, right) => right.createdAt - left.createdAt)
  }));

  app.post<{ Body: { name?: string } }>('/api/apps', async (request, reply) => {
    const name = request.body?.name?.trim();

    if (!name) {
      return reply.status(400).send({ message: 'App name is required' });
    }

    const record: AppRecord = {
      id: createId('app_record'),
      name,
      appKey: createId('app'),
      createdAt: Date.now()
    };

    store.apps.push(record);

    return reply.status(201).send({ app: record });
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
