import { Pool } from 'pg';
import { createServerApp } from './app';
import { createMemoryStore, createPostgresStore, type Store } from './store';

const port = Number(process.env.PORT ?? 3100);
const host = process.env.HOST ?? '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL;
const sessionTtlMs = Number(process.env.SESSION_TTL_MS ?? 7 * 24 * 60 * 60 * 1000);
const cleanupIntervalMs = Number(process.env.CLEANUP_INTERVAL_MS ?? 60 * 60 * 1000);

async function bootstrap(): Promise<void> {
  let store: Store;

  let pool: Pool | undefined;

  if (databaseUrl) {
    pool = new Pool({ connectionString: databaseUrl });
    store = await createPostgresStore({ pool, sessionTtlMs });
    console.log('Connected to PostgreSQL');

    if (store.cleanup) {
      setInterval(() => {
        store.cleanup!().catch((err: unknown) => {
          console.error('Cleanup task failed:', err);
        });
      }, cleanupIntervalMs);
    }
  } else {
    store = createMemoryStore();
    console.log('Using in-memory store (data will be lost on restart)');
  }

  const app = createServerApp(store, {
    corsOrigin: process.env.CORS_ORIGIN
  });

  const shutdown = async (): Promise<void> => {
    console.log('Shutting down...');
    await app.close();
    if (pool) await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port, host });
  app.log.info(`HealthGuard server listening at ${host}:${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

export { createServerApp } from './app';
