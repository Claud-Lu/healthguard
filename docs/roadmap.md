# Roadmap

> **Project website:** https://hg.chathappy.cn/

## Phase 0: Project Foundation ✅

- [x] Create public GitHub repository.
- [x] Add README, license, MVP technical plan, and decision log.
- [x] Decide final backend stack for MVP.
- [x] Initialize monorepo only after the MVP scope is reviewed.

## Phase 1: H5 End-to-End Loop ✅

- [x] Define event schema.
- [x] Build `packages/sdk-web`.
- [x] Build collector API.
- [x] Build `examples/vue3-demo`.
- [x] Show captured errors in a minimal dashboard.

Acceptance:

- [x] A JavaScript error in the demo appears in the dashboard.
- [x] A failed request appears with URL, method, status, and duration.
- [x] Repeated errors aggregate into one issue.

## Phase 2: Dashboard MVP ✅

- [x] App management.
- [x] SDK integration guide.
- [x] Overview page.
- [x] Issue list.
- [x] Issue detail with stack and breadcrumbs.

Acceptance:

- [x] A user can create an app, copy the app key, integrate the SDK, and inspect errors without reading source code.

## Phase 3: WeChat Mini Program SDK ✅

- [x] Runtime error capture.
- [x] Promise rejection capture.
- [x] `wx.request` monitoring.
- [x] Page lifecycle breadcrumbs.
- [ ] Mini program demo.

Acceptance:

- [x] A mini program runtime error appears in the same issue system as H5 events.

## Phase 4: Deployment ✅

- [x] Minimal Docker Compose.
- [ ] Seed script for admin user.
- [x] Health check endpoint.
- [x] Deployment guide.

Acceptance:

- [x] A clean machine can start the MVP with one documented command sequence.

## Phase 5: Auth & Internationalization ✅

- [x] Local registration and login.
- [x] Per-user project isolation.
- [x] English / Chinese auto-detect with manual override.
- [x] Session token authentication.
- [x] Session expiry (7-day TTL with configurable `SESSION_TTL_MS`).

## Phase 6: uni-app SDK ✅

- [x] `packages/sdk-uniapp` with multi-platform detection (H5, WeChat, Alipay, Douyin, App).
- [x] Auto-capture errors, unhandled rejections, fetch, XHR, and `uni.request`.
- [x] Device info and page URL detection per platform.

## Phase 7: Flutter SDK (In Progress)

- [x] `apps/driver-flutter` directory initialized.
- [ ] Flutter SDK implementation.
- [ ] Flutter demo app.

## Phase 8: Security & Performance Hardening ✅

- [x] All query endpoints (`/api/issues`, `/api/overview`, `/api/issues/:id`) require authentication.
- [x] Use `nanoid` for ID generation (replaces `Math.random()`).
- [x] PostgreSQL connection pooling (`pg.Pool` instead of `pg.Client`).
- [x] Batch INSERT for event ingestion (single query instead of per-row).
- [x] `timestamp` index on events table for faster queries.
- [x] Pagination support on `listIssues` and `getIssueDetail`.
- [x] Automatic data retention cleanup (configurable `CLEANUP_INTERVAL_MS` and retention period).
- [x] Graceful shutdown on SIGTERM/SIGINT.

## Phase 9: Alert & Notification (Planned)

- [ ] Alert rules: configure error rate / count thresholds per project.
- [ ] Webhook notifications (Slack, DingTalk, Feishu, custom HTTP).
- [ ] Email notifications.
- [ ] Alert history and status tracking.

## Phase 10: SourceMap & Release Tracking (Planned)

- [ ] SourceMap upload via dashboard or CLI.
- [ ] Stack trace de-minification for production errors.
- [ ] Release version tagging in SDK.
- [ ] Error rate comparison across releases.
- [ ] Release health score.

## Phase 11: Dashboard Enhancements (Planned)

- [ ] Trend charts (error rate, request failure rate over time) with ECharts.
- [ ] Performance metrics visualization (Web Vitals: LCP, FCP, CLS, TTFB).
- [ ] Real-time updates via WebSocket or polling.
- [ ] Dark mode.
- [ ] Mobile responsive layout.
- [ ] Event export (CSV/JSON).
- [ ] Full-text search across events.
- [ ] Breadcrumb timeline visualization in issue detail.

## Phase 12: Team & Access Management (Planned)

- [ ] Invite team members to a project.
- [ ] Role-based access (admin, editor, viewer).
- [ ] Password reset flow.
- [ ] API key management (generate/revoke per project).

## Phase 13: Mobile SDKs (Planned)

- [ ] Android SDK (Java crash + ANR).
- [ ] iOS SDK (crash + symbolication).
- [ ] React Native SDK.
- [ ] Flutter SDK completion.

## Phase 14: Advanced Backend (Planned)

- [ ] Kafka message queue for distributed ingestion.
- [ ] Redis caching and rate limiting.
- [ ] ClickHouse for event analytics.
- [ ] Horizontal scaling support.
- [ ] Per-app rate limiting.

## Phase 15: Observability Integration (Planned)

- [ ] Grafana dashboard export.
- [ ] Prometheus metrics endpoint.
- [ ] OpenTelemetry integration.
- [ ] Session Replay.
