# Roadmap

## Phase 0: Project Foundation

- Create public GitHub repository.
- Add README, license, MVP technical plan, and decision log.
- Decide final backend stack for MVP.
- Initialize monorepo only after the MVP scope is reviewed.

## Phase 1: H5 End-to-End Loop

- Define event schema.
- Build `packages/sdk-web`.
- Build collector API.
- Build `examples/vue3-demo`.
- Show captured errors in a minimal dashboard.

Acceptance:

- A JavaScript error in the demo appears in the dashboard.
- A failed request appears with URL, method, status, and duration.
- Repeated errors aggregate into one issue.

## Phase 2: Dashboard MVP

- App management.
- SDK integration guide.
- Overview page.
- Issue list.
- Issue detail with stack and breadcrumbs.

Acceptance:

- A user can create an app, copy the app key, integrate the SDK, and inspect errors without reading source code.

## Phase 3: WeChat Mini Program SDK

- Runtime error capture.
- Promise rejection capture.
- `wx.request` monitoring.
- Page lifecycle breadcrumbs.
- Mini program demo.

Acceptance:

- A mini program runtime error appears in the same issue system as H5 events.

## Phase 4: Deployment

- Minimal Docker Compose.
- Seed script for admin user.
- Health check endpoint.
- Deployment guide.

Acceptance:

- A clean machine can start the MVP with one documented command sequence.

## Later

- SourceMap upload and stack restoration.
- Alert rules and webhook notifications.
- Android SDK.
- iOS SDK.
- Kafka and distributed ingestion.
- Session Replay.
