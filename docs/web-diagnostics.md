# Browser error diagnostics (Web SDK 0.4.0 source, unreleased)

The Web SDK owns browser error evidence. Applications configure a project, collector and release; they do not need to implement their own window error listeners, browser parsers, script inventories or diagnostic redaction.

```ts
const client = createHealthGuardClient({
  appKey: '<PROJECT_APP_KEY>',
  endpoint: 'https://collector.example.com/api/events/batch',
  release: '<APP_VERSION>',
  buildRelease: '<EXACT_BUILD_ID>',
  autoCapture: true
});
```

With automatic capture enabled, the SDK records hash/popstate navigation, actionable clicks, and HTTP method/URL/status/duration. Clicks use a static `data-healthguard-action` when provided, otherwise a generic `ui.click` with the tag. Input values, visible text, component state, request/response bodies and headers are not read. No active network probe is enabled by this feature. `webDiagnostics: false` disables browser context and automatic breadcrumbs while preserving configured error/request monitoring.

Each global error, unhandled rejection and `captureException` call receives its own `web.error-context` breadcrumb inside the SDK's capture function. This snapshot is independent of upload time and other errors. It includes the captured page, product/build releases, browser parsed from UA, online/visibility state and up to 12 loaded script URLs. The per-event trail is capped at 30 entries including the context. Device model/OS are inferred only where the event's UA provides them; unknown models remain unknown, and these values are not stable device identities.

The SDK preserves available message, stack, filename and line/column evidence. An opaque `Script error.` without a stack is labeled `errorVisibility: opaque`. Its script list is an inventory, not proof of which script failed. Browsers can withhold cross-origin details; the SDK cannot invent a stack or bypass browser security. Configure CORS and `crossorigin` only for scripts whose origin and response policy you control. Other browser-injected scripts may remain unidentifiable.

All new events are recursively redacted before queue storage and custom/default transports. URL authentication values, URL userinfo, nested credential fields and credential-bearing stack URLs are filtered; random SDK session IDs remain available for correlation. Error objects and application request objects are not mutated. Restored events are redacted again before transport. An application error that happens during a different upload is queued normally.

## Framework integration

Vue catches component errors before they reach a global browser listener. Use the SDK's optional adapter after installing other app plugins and before mounting:

```ts
import { installVueErrorHandler } from '@health-guard/sdk-web';

const restoreVueHandler = installVueErrorHandler(app, client);
app.mount('#app');
```

The adapter adds only component name and lifecycle phase, retains the original Error stack, calls the existing error handler, and avoids duplicate installation for the same client/app. It has no Vue runtime dependency. Call `restoreVueHandler()` when removing the integration and `client.dispose()` when removing monitoring. Browser listeners and owned fetch/XHR hooks are released without overwriting a later third-party hook.

Other frameworks can forward caught errors with `client.captureException(error, { component: 'ExampleView', phase: 'mount' })`. They still receive the same SDK-owned browser snapshot.

## Build integration and rollout

An SDK running in a browser cannot discover a Git commit or generate a build's sourcemaps. The application build supplies `release`/`buildRelease` and retains the exact private maps and JS hashes. Use matching maps to symbolicate available stacks; never rebuild a newer map for an older event or expose private maps in the public web root.

This browser feature reuses `deviceInfo` and breadcrumb data supported by existing event schemas. Other optional 0.4.0 features have their own collector requirements; follow their rollout instructions separately. This document describes unreleased source. npm publication, upgrading/rebuilding consuming applications, production deployment, real browser/device testing and actual inbox checks remain separate steps. Existing deployed clients do not acquire new code automatically, and historical events are not backfilled.

## Reproducible browser verification

After building packages, run `yarn test:web:browser` with Node.js 22+ and Chrome (`CHROME_BIN` can select the executable). The verifier serves an independent local page that only imports the built SDK, triggers global/Promise/Vue/real cross-origin exceptions, receives batches on a local collector, checks redaction and cleanup, and writes `coverage/web-diagnostics-browser.json`. It sends no event to a production collector. Chrome with a simulated UA is not acceptance in the actual browser or on a physical device.
