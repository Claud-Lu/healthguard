import { Client } from 'pg';
import { createServerApp } from './app';
import { createMemoryStore, createPostgresStore } from './store';

const port = Number(process.env.PORT ?? 3100);
const host = process.env.HOST ?? '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL;

async function bootstrap(): Promise<void> {
  let store;

  if (databaseUrl) {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    store = await createPostgresStore({ client });
    console.log('Connected to PostgreSQL');
  } else {
    store = createMemoryStore();
    console.log('Using in-memory store (data will be lost on restart)');
  }

  const app = createServerApp(store, {
    corsOrigin: process.env.CORS_ORIGIN
  });

  await app.listen({ port, host });
  app.log.info(`HealthGuard server listening at ${host}:${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

export { createServerApp } from './app';
