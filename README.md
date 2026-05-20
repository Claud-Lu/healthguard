# HealthGuard

[English](./README.md) | [中文](./README.zh-CN.md)

HealthGuard is an open-source, self-hosted application health monitoring system for H5 and mini program applications.

The long-term vision is to cover H5, mini programs, Android, and iOS. The first version is intentionally smaller: a personal-developer-friendly MVP that can collect frontend errors, performance metrics, request failures, and breadcrumbs, then show them in a private dashboard.

## MVP Scope

- H5 SDK: JavaScript errors, unhandled promises, resource errors, request failures, basic Web Vitals, breadcrumbs.
- WeChat mini program SDK: runtime errors, unhandled promises, request failures, page lifecycle timing, breadcrumbs.
- Collector service: receives SDK events, validates schema, writes events, and aggregates issues.
- Dashboard: app management, overview, issue list, issue detail, SDK integration guide.
- Deployment: Docker Compose for a minimal private deployment.
- Documentation: event protocol, roadmap, decision log, and handoff prompt for AI-assisted continuation.

## Deferred

- Android and iOS native SDKs.
- ANR and native crash symbolication.
- Kafka, Redis, MinIO, Grafana, Elasticsearch, Flink.
- Session Replay.
- Multi-tenant billing or SaaS hosting.

These are roadmap items, not first-version commitments.

## Recommended Stack

- SDK: TypeScript, Vite library mode or tsup.
- Dashboard: Vue 3, Vite, Element Plus, Pinia, Axios, ECharts.
- Server: Node.js with Fastify for MVP, or Go if the project later prioritizes infrastructure branding.
- Storage: ClickHouse for event data, SQLite/PostgreSQL/MySQL for metadata depending on deployment needs.
- Package manager: yarn.

## First Validation Target

The first useful milestone is a complete local loop:

1. Start the collector, database, and dashboard with Docker Compose or local scripts.
2. Open an example H5 app.
3. Trigger a JavaScript error and a failed HTTP request.
4. See the events appear in the dashboard within a few seconds.
5. Group repeated errors into one issue by fingerprint.

## Repository Layout

```text
healthguard/
├── apps/
│   ├── dashboard/
│   └── server/
├── examples/
│   └── vue3-demo/
├── packages/
│   ├── core/
│   ├── sdk-miniprogram/
│   └── sdk-web/
├── scripts/
│   └── dev-local.sh
├── docs/
│   ├── HealthGuard_MVP_技术方案.md
│   ├── roadmap.md
│   ├── decisions/
│   │   └── 业务与交互变更记录.md
│   └── handoff/
│       └── next-step-prompt.md
├── LICENSE
└── README.md
```

Planned folders for the next milestones:

```text
examples/wechat-mini-demo/
deploy/
```

## Current Development Snapshot

The first implementation pass initializes a yarn workspace monorepo and starts the H5 loop with testable building blocks:

- `packages/core`: shared event schemas, batch validation, URL sanitization, and issue fingerprint helpers.
- `packages/sdk-web`: browser SDK client that queues errors, resource failures, performance metrics, fetch/XHR events, sanitizes URLs, retries failed flushes, and sends batches to a collector.
- `packages/sdk-miniprogram`: WeChat mini program SDK client for `wx.onError`, `wx.onUnhandledRejection`, `wx.request`, and App/Page lifecycle breadcrumbs.
- `apps/server`: Fastify collector with app management, overview, event ingestion, issue aggregation, issue detail, and in-memory storage for the first local loop.
- `examples/vue3-demo`: H5 demo that triggers JavaScript errors, promise rejections, and failed requests through the SDK.
- `apps/dashboard`: Vue dashboard for app keys, overview metrics, issue lists, issue details, and SDK integration guidance.

Useful commands:

```bash
yarn install
yarn test
yarn type-check
yarn lint
yarn dev:local
yarn dev:server
```

Local MVP URLs:

- Collector: `http://127.0.0.1:3100/health`
- H5 demo: `http://127.0.0.1:5174/`
- Dashboard: `http://127.0.0.1:5175/`
