import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from './store';

export function registerProjectRoutes(app: FastifyInstance, store: Store): void {
  app.patch<{ Params: { appKey: string } }>('/api/apps/:appKey', async (request, reply) => {
    const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
    const user = token ? await store.findUserBySessionToken(token) : null;
    if (!user) return reply.status(401).send({ message: 'Unauthorized' });

    const parsed = z.object({ name: z.string().trim().min(1).max(100) }).strict().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_APP_NAME', message: 'App name must be between 1 and 100 characters' });
    }
    const record = await store.renameApp(request.params.appKey, user.id, parsed.data.name);
    if (!record) return reply.status(404).send({ code: 'APP_NOT_FOUND', message: 'App not found' });
    return { app: ((({ id, name, appKey, type, createdAt }) => ({ id, name, appKey, type, createdAt }))(record)) };
  });

}
