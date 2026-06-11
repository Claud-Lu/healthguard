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

