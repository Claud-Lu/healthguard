import { createApp, h, ref } from 'vue';
import { createHealthGuardClient } from '@healthguard/sdk-web';
import './style.css';

const appKey = 'demo-web';
const client = createHealthGuardClient({
  appKey,
  endpoint: '/api/events/batch',
  autoCapture: true
});

client.addBreadcrumb({
  type: 'manual',
  message: 'Vue3 demo loaded'
});

const App = {
  setup() {
    const lastAction = ref('Demo ready. Trigger an event to see it in the dashboard.');
    const pending = ref(false);

    function triggerJsError(): void {
      client.addBreadcrumb({ type: 'click', message: 'Trigger JS error button clicked' });
      lastAction.value = 'A JavaScript error was captured and queued.';
      window.dispatchEvent(
        new ErrorEvent('error', {
          message: 'HealthGuard demo JavaScript error',
          error: new Error('HealthGuard demo JavaScript error'),
          filename: 'examples/vue3-demo/src/main.ts',
          lineno: 24,
          colno: 9
        })
      );
    }

    function triggerPromiseError(): void {
      client.addBreadcrumb({ type: 'click', message: 'Trigger Promise error button clicked' });
      lastAction.value = 'An unhandled promise rejection was captured and queued.';
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: Promise.resolve(),
          reason: new Error('HealthGuard demo promise rejection')
        })
      );
    }

    async function triggerFailedRequest(): Promise<void> {
      pending.value = true;
      client.addBreadcrumb({ type: 'click', message: 'Trigger failed request button clicked' });

      try {
        await fetch('/api/not-found-demo?token=demo-secret', { method: 'GET' });
        lastAction.value = 'A failed request was captured with sanitized URL data.';
      } finally {
        pending.value = false;
      }
    }

    async function flushNow(): Promise<void> {
      pending.value = true;
      await client.flush();
      pending.value = false;
      lastAction.value = 'Queued events flushed to the local collector.';
    }

    return () =>
      h('main', { class: 'shell' }, [
        h('section', { class: 'hero' }, [
          h('div', [
            h('p', { class: 'eyebrow' }, 'HealthGuard H5 Demo'),
            h('h1', 'Capture real browser failures'),
            h(
              'p',
              { class: 'intro' },
              'This demo sends JavaScript errors, promise rejections, and failed requests to the local collector through the web SDK.'
            )
          ]),
          h('div', { class: 'status' }, [
            h('span', 'App Key'),
            h('strong', appKey),
            h('small', lastAction.value)
          ])
        ]),
        h('section', { class: 'actions', 'aria-label': 'Demo actions' }, [
          h('button', { type: 'button', onClick: triggerJsError }, 'Trigger JS Error'),
          h('button', { type: 'button', onClick: triggerPromiseError }, 'Trigger Promise Error'),
          h('button', { type: 'button', onClick: triggerFailedRequest, disabled: pending.value }, 'Trigger Failed Request'),
          h('button', { type: 'button', class: 'secondary', onClick: flushNow, disabled: pending.value }, 'Flush Events')
        ])
      ]);
  }
};

createApp(App).mount('#app');
