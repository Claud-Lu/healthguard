import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { parseEventBatch, type ErrorEvent, type EventBatch, type HealthGuardEvent } from '@healthguard/core';

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

  return app;
}

export function createMemoryStore(): HealthGuardStore {
  return {
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
