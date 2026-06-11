# @health-guard/sdk-uniapp

HealthGuard SDK for uni-app projects.

## Install

```bash
npm install @health-guard/sdk-uniapp
```

## Usage

```ts
import { createUniAppClient } from '@health-guard/sdk-uniapp';

const healthguard = createUniAppClient({
  appKey: '<PROJECT_APP_KEY>',
  endpoint: 'https://your-server.com/api/events/batch',
  environment: 'test',
  release: '<APP_VERSION>',
  autoCapture: true
});

export default healthguard;
```

Call `flush()` during app background or hide hooks when you need to send queued events immediately.

Mini program targets require a full HTTPS endpoint, and the collector domain must be added to the platform request allowlist.

