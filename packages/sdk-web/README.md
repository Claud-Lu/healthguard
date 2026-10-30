# @health-guard/sdk-web

HealthGuard SDK for H5 and browser applications.

## Install

```bash
npm install @health-guard/sdk-web
```

## Usage

```ts
import { createHealthGuardClient } from '@health-guard/sdk-web';

createHealthGuardClient({
  appKey: '<PROJECT_APP_KEY>',
  endpoint: 'https://your-server.com/api/events/batch',
  environment: 'test',
  release: '<APP_VERSION>',
  autoCapture: true
});
```

Use an HTTPS collector endpoint when the monitored page is served over HTTPS.

## Browser error diagnostics (0.4.0 source, unreleased)

Browser error snapshots, UA-derived model/OS, loaded script inventory, bounded navigation/action/HTTP breadcrumbs, and recursive diagnostic redaction are SDK features. Configure `autoCapture: true`, `release` and optionally `buildRelease`; no application-owned browser monitoring wrapper is needed. `webDiagnostics: false` disables the passive context/trail. A stackless cross-origin `Script error.` remains explicitly opaque; loaded scripts are candidates, not a proven cause.

Vue applications can use `installVueErrorHandler(app, client)` from this package to retain component stacks and existing handlers. Other framework handlers can call `client.captureException(error, { component, phase })`. Builds remain responsible for exact release IDs and private sourcemaps. See [Browser diagnostics](../../docs/web-diagnostics.md) for limits, privacy, cleanup and rollout status. Source completion is not npm publication or a consuming-app upgrade.


## Network diagnostics (0.4.0)

Enable `networkDiagnostics: true` on the platform client for request-failure evidence and bounded persistent retry. See [Network diagnostics](../../docs/network-diagnostics.md) for configuration, platform limits and rollout order. SDK source version does not imply registry publication.
