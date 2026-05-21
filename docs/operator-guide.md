# HealthGuard Operator Guide

This guide is for people running a private HealthGuard deployment.

## What To Keep In Sync

HealthGuard keeps two operational guides:

- `docs/operator-guide.md`: human-facing operating guide.
- `docs/ai-cli-operations.md`: AI CLI runbook for agent-driven maintenance.

When login, project setup, SDK integration, deployment, storage, or verification steps change, update both files in the same change.

## First Login

1. Open the dashboard.
2. Choose the display language if the default is not what you want.
3. Select register.
4. Enter a valid email address.
5. Enter a password with at least 8 characters.
6. Submit the form, then continue in the dashboard.

The current MVP stores users, sessions, projects, events, and issues in memory. Restarting the collector clears this data. Use a persistent database before relying on the deployment for long-running data retention.

## Create A Project

1. In the sidebar, find the project creation form.
2. Enter a project name that identifies the monitored application.
3. Pick the project type:
   - `web`
   - `wechat-miniprogram`
   - `alipay-miniprogram`
   - `flutter`
   - `other`
4. Create the project.
5. Copy the generated app key.

Each project has its own app key. Use a separate key for each application or runtime that should be tracked independently.

## Dashboard Navigation

After login, the dashboard home shows the project list. It does not load `demo-web` or any single default project.

1. Open the dashboard home to review available projects.
2. Select a project card or a project in the sidebar.
3. Inspect metrics, issues, issue detail, and SDK setup for that project.
4. Use the project list button to return to the project list.

Refreshing the dashboard keeps the current project detail only when a project is selected. If no project is selected, refresh reloads the project list only.

## Integrate The Web SDK

Install or link `@healthguard/sdk-web`, then initialize the client in the target web application:

```ts
import { createHealthGuardClient } from '@healthguard/sdk-web';

createHealthGuardClient({
  appKey: '<PROJECT_APP_KEY>',
  endpoint: '<COLLECTOR_ENDPOINT>/events/batch',
  environment: 'test',
  release: '<APP_VERSION>',
  autoCapture: true
});
```

Do not hard-code private company domains, internal IPs, business project names, personal paths, accounts, tokens, or passwords in the open-source HealthGuard repository. Put deployment-specific values in the consuming application environment or private deployment configuration.

## Validate An Integration

1. Open the monitored application.
2. Trigger a harmless JavaScript error or a failed request in a test environment.
3. Return to the dashboard.
4. Select the project from the project list.
5. Refresh the dashboard.
6. Confirm that event, error, failed request, or issue counts update.

## Current Limitations

- Metadata and events are in-memory only.
- There is no password reset flow yet.
- There is no session expiry policy yet.
- There is no role or team management yet.
- Production private deployment should add persistent storage before real use.
