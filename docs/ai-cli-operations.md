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

Event details and AI handoff separate the client-reported occurrence from server receipt. Delivery history shows occurrence, receipt, job creation, processing start and SMTP acceptance. Unknown historical fields are not inferred; receipt time requires the updated Collector, with a nullable additive database column. See the event/delivery clock semantics in the linked notification guide before diagnosing delayed reports.

Automatic alert subjects begin with `[HealthGuard][<full Issue ID>]`, followed by the alert type and project name. Use this stable issue ID to distinguish errors directly in the inbox; it matches `Issue ID` in the body and the existing issue API. A Collector update affects newly generated alerts only; queued/history messages and test subjects retain their content. No SDK or application release is needed.

See [Email notifications](./email-notifications.md) for dashboard setup, SMTP credential handling, trigger rules, delivery history and authenticated API operations.

Alert emails include the full request URL and H5 page URL or native page route from the triggering event. Missing page data requires a client SDK upgrade (`@health-guard/sdk-uniapp@0.3.1` for the uni-app route fix) and a new client release; historical events cannot be backfilled. Authentication parameters are masked.

The triggering device model and OS version are also included when reported. Updating the collector enables these fields for existing clients that already send `deviceInfo.model` and `deviceInfo.system`; missing values are marked **Not reported**. The device describes only the occurrence that triggered the email, not all occurrences in the issue.

## Legacy repair APIs

The /repair, /fixed, /verified and optional PR endpoints remain available for existing integrations, but the Dashboard no longer exposes those manual workflows. They do not execute an AI or modify a repository. Do not call them merely to permit archiving; manual archive is independent of repair/version metadata.

## Reusable network diagnostics

See [Network diagnostics](./network-diagnostics.md) for optional event fields, SDK setup, privacy, bounded replay and rollout verification. Deploy Collector/Dashboard before new SDK consumers, then release each client. JavaScript core/Web/miniprogram/uni-app packages 0.4.0 were published to npm on 2026-10-30; Flutter is distributed separately from npm and retains its own release status. Do not claim deployment, registry publication or device acceptance from a source commit or build alone.


## Flutter migration compatibility (source 0.2.1)

For manual HTTP reports, captureHttpFailure accepts occurredAt, eventEnvironment, deviceModel, deviceSystem and fingerprint. Diagnostic context retains bounded allowlisted networkDiagnostics and originalError fields; passive snapshot sampledAt records collection time separately from the original failure time.

Applications may configure additionalContextKeys for explicitly approved scalar business evidence. Credential keys and nested business payloads are excluded even when requested. Select a single manual or automatic HTTP reporting path to prevent duplicate alerts.

Existing application queues and installation IDs can be migrated through HealthGuardStorage. Persist the new queue before clearing old storage and retain original event IDs, timestamps and releases. A custom transport must throw unless the collector acknowledges the full batch.

The package is source-only, not published to pub.dev. Pin reviewed commit 792e323348083657ae519cabac104479314d9cfd. Registry publication, server deployment and device acceptance are separate steps.

## Project rename verification

Run `yarn vitest run apps/server/src/project-rename.test.ts apps/server/src/store/project-rename.test.ts` for API validation and PostgreSQL WASM persistence. For browser verification, start a disposable in-memory Collector and a Dashboard proxying it, then run `RENAME_TEST_URL=http://127.0.0.1:5198 node scripts/verify-project-rename.cjs` with Playwright and Chrome available. `PLAYWRIGHT_MODULE` may point to an existing Playwright installation. The script refuses non-local hosts, creates only test data, and checks list/detail rename, blank names, failed-save retry, cancellation, reload, localization and dialog geometry at desktop/mobile widths.


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


## Scoped device identities (Unreleased)

Android/Flutter 0.3.0 source adds native-side pseudonymization, uniform event metadata and an embeddable App debug page. The project device panel separates stable device identities, installation IDs and unidentified records; it never groups by model. New emails carry the triggering shortcode and App release. Deploy Collector/Dashboard before SDK consumers; preserve project, package and signing scope. No historical IDs are backfilled. Follow [the device identity protocol, owner-only APIs and target-tablet acceptance matrix](./device-identity.md). Source/build checks do not establish publication, deployment, email delivery or target-device lifecycle behavior.
