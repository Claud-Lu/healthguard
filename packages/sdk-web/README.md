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


## Network diagnostics (0.4.0)

Enable `networkDiagnostics: true` on the platform client for request-failure evidence and bounded persistent retry. See [Network diagnostics](../../docs/network-diagnostics.md) for configuration, platform limits and rollout order. SDK source version does not imply registry publication.
