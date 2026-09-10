# @health-guard/sdk-uniapp

Page context: H5 events include the full browser URL. Version 0.3.1 fixes App/mini-program page capture through the global `getCurrentPages()` API, using `$page.fullPath` or the page route. Upgrade the package and rebuild/release your client for this change to take effect; the collector cannot recover pages missing from older events.

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
