import type { HealthGuardClient } from './index';

interface VueErrorHandlerHost {
  config: { errorHandler?: (error: unknown, instance: any, info: string) => any };
}

const installed = new WeakMap<VueErrorHandlerHost, WeakMap<HealthGuardClient, () => void>>();

/** Optional Vue integration without a Vue runtime dependency. Returns a cleanup. */
export function installVueErrorHandler(app: VueErrorHandlerHost, client: HealthGuardClient): () => void {
  let clients = installed.get(app);
  if (!clients) { clients = new WeakMap(); installed.set(app, clients); }
  const existing = clients.get(client);
  if (existing) return existing;
  const previous = app.config.errorHandler;
  const handler = (error: unknown, instance: any, info: string) => {
    let component: string | undefined;
    try { component = instance?.$options?.name || instance?.$options?.__name; } catch { /* Component metadata is optional. */ }
    try { client.captureException(error, { component, phase: info }); } catch { /* Preserve the original handler even when monitoring fails. */ }
    if (previous) return previous(error, instance, info);
    console.error(error);
  };
  app.config.errorHandler = handler;
  const cleanup = () => {
    if (app.config.errorHandler === handler) app.config.errorHandler = previous;
    clients?.delete(client);
  };
  clients.set(client, cleanup);
  return cleanup;
}
