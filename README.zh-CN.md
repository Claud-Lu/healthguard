# HealthGuard

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/docker-ready-blue" alt="Docker">
</p>

[English](./README.md) | [中文](./README.zh-CN.md)

> **面向 H5、小程序与跨端应用的开源自托管健康监控平台。**

HealthGuard 是一个轻量级、隐私优先的 Sentry 替代方案，适合需要完全掌控监控数据的团队。一条命令即可部署到你自己的服务器上。

**🌐 在线体验：** https://hg.chathappy.cn/

---

## 为什么做 HealthGuard

前端监控常常在两个极端之间摇摆：要么能力很重、接入和维护成本高；要么只适合单项目临时排查，无法支撑 H5、小程序、uni-app 等多端项目的持续运营。HealthGuard 聚焦中间那块最实用的场景：采集可行动的错误和请求失败信号，按项目和平台归类，并把数据留在自己的部署环境里。

它适合正在交付浏览器、小程序和 uni-app 体验的团队，在引入更重的可观测性体系之前，先拥有一个够轻、可私有化、能真实落地的应用健康看板。

---

## ✨ 核心特性

- **🔌 多平台 SDK** — H5、微信小程序、支付宝小程序、uni-app、Flutter
- **📊 实时看板** — 错误追踪、HTTP 请求监控、性能指标、面包屑回溯
- **🐳 一键部署** — Docker Compose 搭配 PostgreSQL 持久化存储
- **🌍 双语界面** — 中英文自动识别，支持手动切换
- **🔐 默认私有** — 本地认证、按用户隔离项目、数据完全自主可控
- **📱 平台分布** — 查看 Issue 在各端（H5、微信等）的分布情况

---

## 🚀 快速开始

```bash
git clone https://github.com/Claud-Lu/healthguard.git
cd healthguard
docker-compose up -d
```

然后浏览器打开 **http://localhost**，注册账号即可开始使用。

> 完整部署文档：[docs/operator-guide.md](./docs/operator-guide.md)

---

## 📦 SDK 接入

### H5 / 浏览器

```bash
npm install @health-guard/sdk-web
```

```ts
import { createHealthGuardClient } from '@health-guard/sdk-web';

const client = createHealthGuardClient({
  appKey: 'your-app-key',
  endpoint: 'https://your-server.com/api/events/batch',
  autoCapture: true
});
```

### 微信小程序

```ts
import { createMiniProgramClient } from '@health-guard/sdk-miniprogram';

const client = createMiniProgramClient({
  appKey: 'your-app-key',
  endpoint: 'https://your-server.com/api/events/batch',
  wx: wx,
  autoCapture: true
});
```

### uni-app（一端接入，多端运行）

```ts
import { createUniAppClient } from '@health-guard/sdk-uniapp';

const client = createUniAppClient({
  appKey: 'your-app-key',
  endpoint: 'https://your-server.com/api/events/batch',
  autoCapture: true
});
```

---

## 🏗️ 架构概览

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   SDK 层    │──────│   服务端    │──────│   数据库    │
│ (H5/小程序/  │      │  (Fastify)  │      │ (PostgreSQL)│
│  uni-app)   │      │             │      │             │
└─────────────┘      └─────────────┘      └─────────────┘
                            │
                     ┌──────┴──────┐
                     │   看板      │
                     │  (Vue 3)    │
                     └─────────────┘
```

| 层级 | 技术栈 |
|------|--------|
| SDK | TypeScript, tsup |
| 服务端 | Node.js + Fastify |
| 数据库 | PostgreSQL 16 |
| 看板 | Vue 3 + Vite |
| 部署 | Docker + Docker Compose |

---

## 📁 仓库目录

```text
healthguard/
├── apps/
│   ├── dashboard/          # Vue 3 监控看板
│   └── server/             # Fastify 采集服务端
├── packages/
│   ├── core/               # 共享事件协议与工具
│   ├── sdk-web/            # 浏览器 SDK
│   ├── sdk-miniprogram/    # 微信小程序 SDK
│   └── sdk-uniapp/         # uni-app 多端 SDK
├── examples/
│   └── vue3-demo/          # H5 示例应用
├── docker-compose.yml      # 一键部署配置
├── Dockerfile              # 服务端镜像
└── docs/                   # 运维文档与决策记录
```

---

## 🛠️ 本地开发

```bash
yarn install
yarn test
yarn type-check
yarn build
yarn dev:local    # 本地同时启动服务端、看板与示例
```

本地地址：
- 采集 API：`http://127.0.0.1:3100/health`
- 监控看板：`http://127.0.0.1:5175/`
- 示例应用：`http://127.0.0.1:5174/`

---

## 🗺️ 路线图

- [x] H5 SDK
- [x] 微信小程序 SDK
- [x] uni-app SDK
- [x] PostgreSQL 持久化
- [x] Docker 一键部署
- [x] 限流与 CORS 配置
- [ ] Android SDK
- [ ] iOS SDK
- [ ] 录屏回放（Session Replay）
- [ ] Grafana / Prometheus 集成

---

## 📄 许可证

MIT License © [Claud-Lu](https://github.com/Claud-Lu)
