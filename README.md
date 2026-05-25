# HealthGuard

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/docker-ready-blue" alt="Docker">
</p>

[English](./README.md) | [中文](./README.zh-CN.md)

> **Open-source, self-hosted application health monitoring for H5, mini-programs, and cross-platform apps.**

HealthGuard is a lightweight, privacy-first alternative to Sentry for teams who need full control over their monitoring data. Deploy it on your own infrastructure with a single command.

**🌐 Live Demo:** https://hg.chathappy.cn/

---

## Why HealthGuard

Frontend monitoring is often either too heavy for small teams or too expensive to run across many H5 and mini-program projects. HealthGuard focuses on the practical middle ground: collect actionable error and request-failure signals, separate them by project and platform, and keep all data inside your own deployment.

It is designed for teams shipping browser, mini-program, and uni-app experiences that need a simple operational dashboard before adopting a larger observability stack.

---

## ✨ Features

- **🔌 Multi-Platform SDKs** — H5, WeChat Mini Program, Alipay, uni-app, Flutter
- **📊 Real-time Dashboard** — Error tracking, HTTP request monitoring, performance metrics, breadcrumbs
- **🐳 One-Command Deploy** — Docker Compose with PostgreSQL persistence
- **🌍 Bilingual UI** — English / Chinese auto-detect with manual override
- **🔐 Private by Default** — Local auth, per-user project isolation, data stays on your servers
- **📱 Platform Distribution** — See which platform (H5, WeChat, etc.) an issue affects most

---

## 🚀 Quick Start

```bash
git clone https://github.com/Claud-Lu/healthguard.git
cd healthguard
docker-compose up -d
```

Then open **http://localhost** in your browser and register an account.

> Full deployment guide: [docs/operator-guide.md](./docs/operator-guide.md)

---

## 📦 SDK Integration

### H5 / Browser

```bash
npm install @healthguard/sdk-web
```

```ts
import { createHealthGuardClient } from '@healthguard/sdk-web';

const client = createHealthGuardClient({
  appKey: 'your-app-key',
  endpoint: 'https://your-server.com/api/events/batch',
  autoCapture: true
});
```

### WeChat Mini Program

```ts
import { createMiniProgramClient } from '@healthguard/sdk-miniprogram';

const client = createMiniProgramClient({
  appKey: 'your-app-key',
  endpoint: 'https://your-server.com/api/events/batch',
  wx: wx,
  autoCapture: true
});
```

### uni-app (Multi-end)

```ts
import { createUniAppClient } from '@healthguard/sdk-uniapp';

const client = createUniAppClient({
  appKey: 'your-app-key',
  endpoint: 'https://your-server.com/api/events/batch',
  autoCapture: true
});
```

---

## 🏗️ Architecture

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   SDKs      │──────│   Server    │──────│  PostgreSQL │
│  (H5/MP/    │      │  (Fastify)  │      │  (Persist)  │
│   uni-app)  │      │             │      │             │
└─────────────┘      └─────────────┘      └─────────────┘
                            │
                     ┌──────┴──────┐
                     │  Dashboard  │
                     │  (Vue 3)    │
                     └─────────────┘
```

| Layer | Tech |
|-------|------|
| SDKs | TypeScript, tsup |
| Server | Node.js + Fastify |
| Database | PostgreSQL 16 |
| Dashboard | Vue 3 + Vite |
| Deploy | Docker + Docker Compose |

---

## 📁 Repository Layout

```text
healthguard/
├── apps/
│   ├── dashboard/          # Vue 3 dashboard
│   └── server/             # Fastify collector API
├── packages/
│   ├── core/               # Shared event schemas & utilities
│   ├── sdk-web/            # Browser SDK
│   ├── sdk-miniprogram/    # WeChat mini program SDK
│   └── sdk-uniapp/         # uni-app multi-end SDK
├── examples/
│   └── vue3-demo/          # H5 demo app
├── docker-compose.yml      # One-click deployment
├── Dockerfile              # Server image
└── docs/                   # Operator guides & decisions
```

---

## 🛠️ Development

```bash
yarn install
yarn test
yarn type-check
yarn build
yarn dev:local    # Start server + dashboard + demo locally
```

Local URLs:
- Collector API: `http://127.0.0.1:3100/health`
- Dashboard: `http://127.0.0.1:5175/`
- Demo: `http://127.0.0.1:5174/`

---

## 🗺️ Roadmap

- [x] H5 SDK
- [x] WeChat Mini Program SDK
- [x] uni-app SDK
- [x] PostgreSQL persistence
- [x] Docker deployment
- [x] Rate limiting & CORS
- [ ] Android SDK
- [ ] iOS SDK
- [ ] Session Replay
- [ ] Grafana / Prometheus integration

---

## 📄 License

MIT License © [Claud-Lu](https://github.com/Claud-Lu)
