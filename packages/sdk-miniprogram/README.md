# @health-guard/sdk-miniprogram

HealthGuard SDK for WeChat-style mini program runtimes.

## Install

```bash
npm install @health-guard/sdk-miniprogram
```

## Usage

```ts
import { createMiniProgramClient } from '@health-guard/sdk-miniprogram';

createMiniProgramClient({
  appKey: '<PROJECT_APP_KEY>',
  endpoint: 'https://your-server.com/api/events/batch',
  wx,
  autoCapture: true
});
```

Mini programs require a full HTTPS endpoint, and the collector domain must be added to the platform request allowlist.


## Network diagnostics (0.4.0)

Enable `networkDiagnostics: true` on the platform client for request-failure evidence and bounded persistent retry. See [Network diagnostics](../../docs/network-diagnostics.md) for configuration, platform limits and rollout order. SDK source version does not imply registry publication.
