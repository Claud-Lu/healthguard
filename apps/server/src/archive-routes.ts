import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from './store';

export function registerArchiveRoutes(app: FastifyInstance, store: Store): void {
  app.patch<{ Params: { id: string }; Body: unknown }>('/api/issues/:id/archive', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);
    if (!user) return reply.status(401).send({ message: 'Unauthorized' });
    const detail = await store.getIssueDetail(request.params.id, undefined, 1);
    if (!detail.issue || !(await userOwnsAppKey(store, user.id, detail.issue.appKey))) {
      return reply.status(404).send({ message: 'Issue not found' });
    }
    const parsed = z.object({ note: z.string().trim().max(4000).optional() }).strict().default({}).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid archive note' });
    const issue = await store.archiveIssue(request.params.id, Date.now(), parsed.data.note ?? '');
    if (!issue) return reply.status(404).send({ message: 'Issue not found' });
    return { issue };
  });

  app.patch<{ Params: { id: string } }>('/api/issues/:id/reopen', async (request, reply) => {
    const user = await authenticate(store, request.headers.authorization);
    if (!user) return reply.status(401).send({ message: 'Unauthorized' });
    const detail = await store.getIssueDetail(request.params.id, undefined, 1);
    if (!detail.issue || !(await userOwnsAppKey(store, user.id, detail.issue.appKey))) {
      return reply.status(404).send({ message: 'Issue not found' });
    }
    const issue = await store.reopenIssue(request.params.id);
    if (!issue) return reply.status(404).send({ message: 'Issue not found' });
    return { issue };
  });

}

async function authenticate(store: Store, authorization?: string) {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  return token ? store.findUserBySessionToken(token) : null;
}

async function userOwnsAppKey(store: Store, userId: string, appKey: string): Promise<boolean> {
  return (await store.findAppByKey(appKey))?.ownerUserId === userId;
}
