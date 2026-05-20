# HealthGuard

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
│   └── server/
├── packages/
│   ├── core/
│   └── sdk-web/
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
apps/dashboard/
packages/sdk-miniprogram/
examples/vue3-demo/
examples/wechat-mini-demo/
deploy/
```

## Current Development Snapshot

The first implementation pass initializes a yarn workspace monorepo and starts the H5 loop with testable building blocks:

- `packages/core`: shared event schemas, batch validation, URL sanitization, and issue fingerprint helpers.
- `packages/sdk-web`: minimal browser SDK client that queues error and HTTP events, sanitizes URLs, and flushes batches to a collector.
- `apps/server`: Fastify collector with `/health`, `POST /api/events/batch`, and `GET /api/issues`, backed by an in-memory store for the first local loop.

Useful commands:

```bash
yarn install
yarn test
yarn type-check
yarn lint
yarn dev:server
```
