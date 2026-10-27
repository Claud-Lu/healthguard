import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from './store';

const querySchema = z.object({
  appKey: z.string().min(1).max(64), platform: z.string().max(32).optional(),
  start: z.coerce.number().int().min(0).max(8640000000000000).optional(),
  end: z.coerce.number().int().min(0).max(8640000000000000).optional(),
  kind: z.enum(['stable', 'installation', 'unknown']).optional(), search: z.string().trim().max(128).optional(),
  key: z.string().min(1).max(512).optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1000000).default(0)
}).strict().refine(q => q.start === undefined || q.end === undefined || q.start <= q.end);

export function registerDeviceRoutes(app: FastifyInstance, store: Store): void {
  for (const history of [false, true]) app.get(history ? '/api/devices/events' : '/api/devices', async (request, reply) => {
    const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
    const user = token ? await store.findUserBySessionToken(token) : null;
    if (!user) return reply.status(401).send({ message: 'Unauthorized' });
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success || (history && !parsed.data.key)) return reply.status(400).send({ message: 'Invalid device query' });
    const q = parsed.data;
    const project = await store.findAppByKey(q.appKey);
    if (!project || project.ownerUserId !== user.id) return reply.status(404).send({ message: 'App not found' });
    const query = { ...q, startTime: q.start, endTime: q.end };
    return history ? store.listDeviceEvents(query) : store.listDevices(query);
  });
}
