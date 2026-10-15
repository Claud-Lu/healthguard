# HealthGuard AI CLI Operations

This runbook is for AI coding agents that operate this repository from a CLI.

## Mandatory Context

Read these files before changing behavior:

```bash
sed -n '1,220p' README.md
sed -n '1,220p' README.zh-CN.md
sed -n '1,260p' docs/operator-guide.md
sed -n '1,260p' docs/ai-cli-operations.md
sed -n '1,260p' docs/decisions/业务与交互变更记录.md
```

## Documentation Sync Rule

Operational documentation has two audiences:

- `docs/operator-guide.md`: human-facing guide.
- `docs/ai-cli-operations.md`: AI CLI runbook.

If a change modifies login, registration, project creation, app key usage, SDK integration, deployment, persistence, verification, or troubleshooting, update both files in the same change. Also update `README.md`, `README.zh-CN.md`, and `docs/decisions/业务与交互变更记录.md` when the behavior is user-visible.

## Open-Source Boundary

Never commit private deployment details to this repository:

- company project names
- private domains
- public or internal IP addresses
- personal filesystem paths
- accounts, tokens, passwords, API keys
- business-specific app keys

Use placeholders in this repository. Put real values in the consuming application environment, private deployment scripts, or private knowledge base.

## Local Verification

Run the full verification set before claiming the change is complete:

```bash
yarn test
yarn type-check
yarn lint
yarn build
```

For targeted auth or localization changes, run these first:

```bash
yarn vitest run apps/server/src/app.test.ts
yarn vitest run apps/dashboard/src/i18n.test.ts
```

## Local Smoke Test

Start the collector and dashboard:

```bash
PORT=3100 HOST=127.0.0.1 yarn dev:server
VITE_HEALTHGUARD_API_BASE=http://127.0.0.1:3100/api yarn dev:dashboard --host 127.0.0.1 --port 5175
```

Then verify:

1. Dashboard opens at `http://127.0.0.1:5175/`.
2. China-area time zones default to Chinese; other time zones default to English.
3. Register with a valid email and a password of at least 8 characters.
4. Create a project.
5. Confirm the generated app key has the selected type prefix.
6. Confirm the logged-in home shows the project list, not `demo-web` detail data.
7. Select the project and confirm the detail view loads metrics, issues, and SDK setup for that project.
8. Trigger a test event from a demo or consuming app.
9. Refresh the selected project detail and confirm the event appears.

## Brand Home Navigation

The shared brand header links to `/` through Vue Router, preserving the configured deployment base path. Authenticated sessions redirect to `/projects`; logged-out sessions redirect to `/login`. Logo, title and subtitle share the link, including keyboard Enter activation.

## Rename A Project

Call `PATCH /api/apps/:appKey` using the owner's bearer session and JSON `{ "name": "Recognizable project name" }`. Only `name` is accepted. The server trims it and enforces 1–100 characters. Returns `{ "app": { "id", "name", "appKey", "type", "createdAt" } }` (field names shown; actual values are returned). Errors: `401` unauthenticated, `400 INVALID_APP_NAME` invalid input, `404 APP_NOT_FOUND` absent or not owned by the caller.

Renaming updates only `apps.name`, without a schema migration. Keep the original app key and client SDK configuration. Deploy the Collector before the Dashboard. Verify the new name after reload and that historical events, issues and notification rules remain intact. The Dashboard exposes Rename to the right of each title in both project sidebars (Chinese label: 改名); long titles truncate with an ellipsis.

## Private Deployment Pattern

Build the dashboard with deployment-specific environment variables outside tracked source files:

```bash
VITE_BASE_PATH=/healthguard/ \
VITE_HEALTHGUARD_API_BASE=/healthguard-api \
yarn workspace @healthguard/dashboard build
```

Build the collector:

```bash
yarn workspace @healthguard/server build
```

Deployment paths, hostnames, SSH aliases, and real app keys are environment-specific. Do not add them to this repository.

Configure repair-agent access with a deployment secret:

```bash
export HEALTHGUARD_AGENT_TOKEN='<STRONG_RANDOM_TOKEN>'
docker compose up -d
```

Agents must call `/api/agent/repair-tasks/*` with `Authorization: Bearer <HEALTHGUARD_AGENT_TOKEN>`. The token is for trusted repair runners only; never commit real values, paste them into issues, or add them to public examples.

## npm Publishing Pattern

Public SDK packages use the `@health-guard` npm organization scope. See `docs/npm-publishing.md` for the full publishing checklist.

Never commit npm tokens. The GitHub Actions workflow `.github/workflows/publish.yml` is designed for npm Trusted Publishing and only runs on `v*` tags from the trusted repository.

## Integration Pattern For A Consuming Web App

Use environment variables in the consuming app:

```env
VITE_HEALTHGUARD_ENDPOINT=<COLLECTOR_ENDPOINT>/api/events/batch
VITE_HEALTHGUARD_APP_KEY=<PROJECT_APP_KEY>
```

Initialize the SDK:

```ts
import { createHealthGuardClient } from '@health-guard/sdk-web';

createHealthGuardClient({
  appKey: import.meta.env.VITE_HEALTHGUARD_APP_KEY,
  endpoint: import.meta.env.VITE_HEALTHGUARD_ENDPOINT,
  environment: import.meta.env.MODE === 'production' ? 'production' : 'test',
  release: import.meta.env.VITE_APP_VERSION,
  autoCapture: true
});
```

If the consuming app is served over HTTPS, use an HTTPS collector endpoint or an HTTPS same-origin proxy. Browsers block HTTP collector calls from HTTPS pages as mixed content.

## Troubleshooting

- `Request failed: 400` during auth: read the response `code`; the dashboard should map it to a localized message.
- Agent repair APIs return `401`: confirm `HEALTHGUARD_AGENT_TOKEN` is set on the server and the agent sends the same value as a bearer token.
- Agent claim returns `409`: another agent already claimed the task or the task is no longer pending.
- Project list is empty: the logged-in user has not created a project yet, or the local in-memory collector restarted.
- Dashboard refresh shows the project list: this is expected when no project is selected. Select a project to inspect its detail data.
- No events appear: confirm endpoint, app key, browser mixed-content rules, and network requests to `/events/batch`.
- Events disappeared after restart: confirm the server was started with `DATABASE_URL`; without it, local development uses the in-memory fallback store.
- Dashboard language looks wrong: clear `healthguard_locale` from browser local storage or switch language manually.

## Email notifications

See [Email notifications](./email-notifications.md) for dashboard setup, SMTP credential handling, trigger rules, delivery history and authenticated API operations.

Alert emails include the full request URL and H5 page URL or native page route from the triggering event. Missing page data requires a client SDK upgrade (`@health-guard/sdk-uniapp@0.3.1` for the uni-app route fix) and a new client release; historical events cannot be backfilled. Authentication parameters are masked.

The triggering device model and OS version are also included when reported. Updating the collector enables these fields for existing clients that already send `deviceInfo.model` and `deviceInfo.system`; missing values are marked **Not reported**. The device describes only the occurrence that triggered the email, not all occurrences in the issue.

## Direct repair progress

Use the authenticated owner session with `PATCH /api/issues/:id/repair`. Send any subset of `cause`, `summary`, `commitSha`, `deployment`, `verification`; omitted fields remain unchanged and empty strings clear fields. Text is limited to 4000 characters. Commit SHA is empty or 7–40 hexadecimal characters. `action: "start"` moves the issue to repairing and clears fixed/verified release markers. Notes persist in PostgreSQL `issues.repair_record` (additive migration).

Write evidence at each stage; this API does not execute agents. `/fixed` records code completion and clears stale verification. `/verified` records explicit verification; never call it merely because code was edited or events stopped. PR creation is not required. The experimental repair-task queue is independent and does not automatically update these records.

Deploy the collector before the dashboard because the new UI writes to `/repair`. Keep old frontend assets during deployment for already-open sessions. Back up the collector image and dashboard before replacing them; rollback can leave the additive JSONB column in place.

## Reusable network diagnostics

See [Network diagnostics](./network-diagnostics.md) for optional event fields, SDK setup, privacy, bounded replay and rollout verification. Deploy Collector/Dashboard before new SDK consumers, then release each client. JavaScript packages are prepared at 0.4.0; Flutter source is 0.1.0 and is distributed separately from npm. Do not claim deployment, registry publication or device acceptance from a source commit or build alone.


## Flutter migration compatibility (source 0.2.0)

For manual HTTP reports, captureHttpFailure accepts occurredAt, eventEnvironment, deviceModel, deviceSystem and fingerprint. Diagnostic context retains bounded allowlisted networkDiagnostics and originalError fields; passive snapshot sampledAt records collection time separately from the original failure time.

Applications may configure additionalContextKeys for explicitly approved scalar business evidence. Credential keys and nested business payloads are excluded even when requested. Select a single manual or automatic HTTP reporting path to prevent duplicate alerts.

Existing application queues and installation IDs can be migrated through HealthGuardStorage. Persist the new queue before clearing old storage and retain original event IDs, timestamps and releases. A custom transport must throw unless the collector acknowledges the full batch.

The package is source-only, not published to pub.dev. Pin reviewed commit b9ad8bea6afcee848c99e67a8f141faa17a52fd3. Registry publication, server deployment and device acceptance are separate steps.

## Project rename verification

Run `yarn vitest run apps/server/src/project-rename.test.ts apps/server/src/store/project-rename.test.ts` for API validation and PostgreSQL WASM persistence. For browser verification, start a disposable in-memory Collector and a Dashboard proxying it, then run `RENAME_TEST_URL=http://127.0.0.1:5198 node scripts/verify-project-rename.cjs` with Playwright and Chrome available. `PLAYWRIGHT_MODULE` may point to an existing Playwright installation. The script refuses non-local hosts, creates only test data, and checks list/detail rename, blank names, failed-save retry, cancellation, reload, localization and dialog geometry at desktop/mobile widths.

## Browse Issues Before Selecting Details

The initial project view shows a full-width list with one issue per row. Detail is hidden until an issue is selected. Error messages display in full and wrap as needed; type, counts, status, platform, time and fingerprint appear in a separate metadata row. Select a card to show its details beside the list, or below it on narrow screens (automatically brought into view). **Close details** returns to the full list and restores focus to the selected card. Search/filter/project changes clear the selection. Closing also invalidates pending detail responses so an old request cannot reopen the panel. No API or storage changes are required.


## Detailed Flutter diagnostics (source 0.2.0)

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
