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

## Return To The Project Home

Click the HealthGuard brand area (logo, title or account) at the top of the sidebar to return to the project list. It is also a keyboard-accessible link: focus it with Tab and press Enter. Logged-out users stay on the login page.

## Rename A Project

Select **Rename** to the right of a project title in the sidebar, either from the project list or project detail. Long titles use an ellipsis and show the full name on hover. Enter a recognizable name (Chinese is supported), then save. Names are trimmed and must contain 1–100 characters. Cancel or Escape leaves the name unchanged; failed saves keep the dialog open for retry.

Only the display name changes. The app key, SDK settings, event/issue history and notification rules remain attached to the same project. The new name appears immediately and persists after refresh in PostgreSQL deployments. Only the project owner may rename it.

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

Event details and AI handoff separate the client-reported occurrence from server receipt. Delivery history shows occurrence, receipt, job creation, processing start and SMTP acceptance. Unknown historical fields are not inferred; receipt time requires the updated Collector, with a nullable additive database column. See the event/delivery clock semantics in the linked notification guide before diagnosing delayed reports.

Automatic alert subjects begin with `[HealthGuard][<full Issue ID>]`, followed by the alert type and project name. Use this stable issue ID to distinguish errors directly in the inbox; it matches `Issue ID` in the body and the existing issue API. A Collector update affects newly generated alerts only; queued/history messages and test subjects retain their content. No SDK or application release is needed.

See [Email notifications](./email-notifications.md) for dashboard setup, SMTP credential handling, trigger rules, delivery history and authenticated API operations.

Alert emails include the full request URL and H5 page URL or native page route from the triggering event. Missing page data requires a client SDK upgrade (`@health-guard/sdk-uniapp@0.3.1` for the uni-app route fix) and a new client release; historical events cannot be backfilled. Authentication parameters are masked.

The triggering device model and OS version are also included when reported. Updating the collector enables these fields for existing clients that already send `deviceInfo.model` and `deviceInfo.system`; missing values are marked **Not reported**. The device describes only the occurrence that triggered the email, not all occurrences in the issue.

## Reusable network diagnostics

See [Network diagnostics](./network-diagnostics.md) for optional event fields, SDK setup, privacy, bounded replay and rollout verification. Deploy Collector/Dashboard before new SDK consumers, then release each client. JavaScript packages are prepared at 0.4.0; Flutter source is 0.1.0 and is distributed separately from npm. Do not claim deployment, registry publication or device acceptance from a source commit or build alone.


## Flutter migration compatibility (source 0.2.1)

For manual HTTP reports, captureHttpFailure accepts occurredAt, eventEnvironment, deviceModel, deviceSystem and fingerprint. Diagnostic context retains bounded allowlisted networkDiagnostics and originalError fields; passive snapshot sampledAt records collection time separately from the original failure time.

Applications may configure additionalContextKeys for explicitly approved scalar business evidence. Credential keys and nested business payloads are excluded even when requested. Select a single manual or automatic HTTP reporting path to prevent duplicate alerts.

Existing application queues and installation IDs can be migrated through HealthGuardStorage. Persist the new queue before clearing old storage and retain original event IDs, timestamps and releases. A custom transport must throw unless the collector acknowledges the full batch.

The package is source-only, not published to pub.dev. Pin reviewed commit 792e323348083657ae519cabac104479314d9cfd. Registry publication, server deployment and device acceptance are separate steps.


## Confirmed manual archive and notes

The Dashboard is a monitoring and archive workspace, not an automatic repair executor. Use Copy for AI to hand off diagnostics to your development tool. Repair-stage controls, version verification forms and PR editing are no longer shown; existing records and legacy APIs remain intact for compatibility.

Click Archive to open a confirmation dialog with an optional note (up to 4000 characters). Cancel or Escape makes no request. Confirm archives directly, without a fixed/verified release prerequisite. Errors preserve the draft for retry. Archived details display the saved note and timestamp as plain text. Restore returns the issue to Current issues and retains the last archive note.

Only the project owner can archive or restore an issue. PATCH /api/issues/:id/archive accepts an optional JSON object { "note": "Server-side fix or another reason" }; omitted/blank notes are allowed, unknown fields and notes over 4000 characters are rejected. The archive record and timestamp are saved atomically; retries do not replace an existing archive record. New occurrences still increment counts but keep manually archived issues archived until explicitly restored. This is organization, not proof of a fix or recovery.

Deploy Collector before Dashboard. PostgreSQL adds issues.archive_record JSONB without deleting historical events, repair records, versions or PR links. Back up the database/image/frontend and verify owner-only archive, note readback, incoming-event behavior and restore. No SDK or consuming App upgrade is needed.

## Browse Issues Before Selecting Details

The initial project view shows a full-width list with one issue per row. Detail is hidden until an issue is selected. Error messages display in full and wrap as needed; type, counts, platform and time appear in a separate metadata row. Select a card to show its details beside the list, or below it on narrow screens (automatically brought into view). **Close details** returns to the full list and restores focus to the selected card. Search/filter/project changes clear the selection. Closing also invalidates pending detail responses so an old request cannot reopen the panel. No API or storage changes are required.


## Detailed Flutter diagnostics (source 0.2.1)

NetworkDiagnostics now lives in the SDK. It provides beginRequest, endRequest,
collect and dispose; applications supply allowedHosts and healthPath and connect
these hooks to their single existing HTTP reporting path. Retain business
configuration, handled-error reporting and legacy-storage migration adapters;
remove duplicated native observers and application probe implementations only
after migrating all call sites.

The Android client and detailed event stream share one reference-counted observer.
Network evidence includes request IDs, start/failure snapshots, observed changes,
in-flight counts, last successful response and original Dio/OS errors. It does
not confirm which peer caused a failure. Non-Android native evidence remains
explicitly unavailable.

Active probes require a non-empty HTTPS/443 host allowlist. healthPath must be a
relative absolute path without authority, scheme, query or fragment. Each stage
and the whole group have bounded timeouts; per-host single-flight and a 60-second
cache bound probe traffic. Probe results are collected after failure and retain
their actual sampling time. They are separate requests and never reproduce the
original business connection. No authentication, business queries, redirects or
TLS bypass are used. Manual and interceptor cancellation creates no alert.

## HTTP occurrence evidence (unreleased)

New HTTP issues separate target origin, environment and original failure phase. Alerts lead with the triggering event, with historical summaries explicitly labeled; late events cannot overwrite newer summaries/releases. Historical Issue IDs and repair links remain intact and may coexist with v2 groups. Flutter 0.2.1 optionally uses HealthGuardIoHttpClientAdapter; manual reporters forward context.requestTrace without a duplicate HTTP interceptor. Original DNS/TCP/TLS subphases remain unavailable; independent probes retain separate sample times and never establish the original root cause. See [network diagnostics](./network-diagnostics.md) for configuration and deployment boundaries.

## Full request URLs in issue titles

Opening a historical HTTP issue replaces its path-only display title with the newest matching event’s recorded absolute request URL, retaining the complete error text. The selected list row and Copy to AI report use the same display title. Matching requires the same method and path; absent, relative or mismatched evidence leaves the stored summary visible without inventing a domain. Authentication query parameters remain masked and URL credentials are omitted. Titles wrap without truncation; stored messages, grouping and repair state are unchanged.

Issue row metadata keeps type and event count on the left, with platform and timestamps grouped on the right. The group wraps within narrow rows while the full error title remains on its own line.

## Compact project detail layout

The active project is identified in the sidebar; its duplicate main heading and description are omitted. Filters and actions share a wrapping toolbar, and all five metrics remain in one compact horizontal row with label and value on the same line (scrollable on narrow screens). The current/archive switch controls visibility; misleading repair-stage tabs are removed. Filtering, detail selection, request titles and repair actions retain their existing behavior.

The Issue heading and search field share one row; the redundant group total is omitted; the compact Issues metric still shows the count. Filter chevrons are inset 12px with 36px reserved for text, and selectors/date fields share a 38px height. Keyboard focus remains visible.
