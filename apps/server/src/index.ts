import { createServerApp } from './app';

const port = Number(process.env.PORT ?? 3100);
const host = process.env.HOST ?? '0.0.0.0';

const app = createServerApp();

app
  .listen({ port, host })
  .then((address) => {
    app.log.info(`HealthGuard server listening at ${address}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });

export { createServerApp } from './app';
