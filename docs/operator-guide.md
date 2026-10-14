# HealthGuard Operator Guide

> **Project website:** https://hg.chathappy.cn/

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

Docker Compose deployments use PostgreSQL persistence by default. Local development can still run without `DATABASE_URL`; in that mode the server falls back to the in-memory store and data is lost on restart.

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

Install `@health-guard/sdk-web`, then initialize the client in the target web application:

```ts
import { createHealthGuardClient } from '@health-guard/sdk-web';

createHealthGuardClient({
  appKey: '<PROJECT_APP_KEY>',
  endpoint: '<COLLECTOR_ENDPOINT>/api/events/batch',
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

## Track Direct Repairs

The project view uses two columns: issues and issue details. Filter by investigation, repairing, awaiting verification or verified. A PR is optional and collapsed inside the detail view.

1. Copy an issue report for your AI or inspect it in your repository.
2. Record the root cause, repair summary and optional commit SHA. **Start repair** marks the issue as repairing; recurring events continue to count without stopping that work.
3. Record the fixed release after the code change. This clears the previous verification marker and means **awaiting verification**, not deployed or recovered.
4. Save the deployment location/version/time and verification results separately. After checking the deployed version, confirm verification passed with the verified release.
5. Archive only after verification. Events from the fixed or a newer release reopen the issue; old-release events do not invalidate the fix. Lack of events alone is not proof of recovery.

Repair notes must be saved explicitly. They are the latest editable record, not an audit history; starting another round retains the notes for context while clearing old release markers. The dashboard does not run coding agents or automatically deploy software. Existing external agents must explicitly write progress back to the API; there is no inferred synchronization from Git or the experimental task queue.

The optional PR URL still uses `PATCH /api/issues/:id/fix-pr` and accepts an HTTP(S) URL or an empty string to clear it.

## Configure Repair Agents (experimental)

The agent repair-task queue (`/api/agent/repair-tasks/*`) is **experimental**: nothing in this repository consumes it yet, and the recommended workflow is the lightweight path above — copy the issue report for your AI (or use `@health-guard/repair-agent`) and record the repair evidence on the issue. The queue APIs remain available for self-hosted experiments.

Repair agent APIs use a separate server-side bearer token instead of a dashboard session token.

1. Generate a strong random token in your private deployment secret store.
2. Set `HEALTHGUARD_AGENT_TOKEN` in the server environment.
3. Configure Hermes, Codex, or another trusted agent runner to call `/api/agent/repair-tasks/*` with `Authorization: Bearer <HEALTHGUARD_AGENT_TOKEN>`.

Do not commit the real token. The repository `docker-compose.yml` reads `HEALTHGUARD_AGENT_TOKEN` from the shell environment and leaves it blank when unset.

## Current Limitations

- There is no password reset flow yet.
- There is no role or team management yet.
- Admin-user seeding is not implemented yet; create the first account through registration.
- WeChat mini program and Flutter demo apps are not included yet.
- Production private deployment should use PostgreSQL with strong credentials and a restricted CORS origin.

## Security Notes

- The default `docker-compose.yml` uses hardcoded database credentials (`healthguard:healthguard`) for development convenience. **Before deploying to production, change `POSTGRES_PASSWORD` and the corresponding `DATABASE_URL` to strong, unique passwords.**
- `CORS_ORIGIN` is set to `*` by default. Restrict it to your actual domain in production.
- `HEALTHGUARD_AGENT_TOKEN` protects repair-agent polling, claim, payload, and status update APIs. Keep it in deployment secrets and rotate it if an agent machine is compromised.

## Email notifications

See [Email notifications](./email-notifications.md) for dashboard setup, SMTP credential handling, trigger rules, delivery history and authenticated API operations.

Alert emails include the full request URL and H5 page URL or native page route from the triggering event. Missing page data requires a client SDK upgrade (`@health-guard/sdk-uniapp@0.3.1` for the uni-app route fix) and a new client release; historical events cannot be backfilled. Authentication parameters are masked.

The triggering device model and OS version are also included when reported. Updating the collector enables these fields for existing clients that already send `deviceInfo.model` and `deviceInfo.system`; missing values are marked **Not reported**. The device describes only the occurrence that triggered the email, not all occurrences in the issue.

## Reusable network diagnostics

See [Network diagnostics](./network-diagnostics.md) for optional event fields, SDK setup, privacy, bounded replay and rollout verification. Deploy Collector/Dashboard before new SDK consumers, then release each client. JavaScript packages are prepared at 0.4.0; Flutter source is 0.1.0 and is distributed separately from npm. Do not claim deployment, registry publication or device acceptance from a source commit or build alone.
