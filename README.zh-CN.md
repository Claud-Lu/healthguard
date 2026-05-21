# HealthGuard

[English](./README.md) | [中文](./README.zh-CN.md)

HealthGuard 是一款开源、可自托管的应用健康监控系统，面向 H5 与小程序场景。

长期目标是覆盖 H5、小程序、Android 和 iOS。首个版本刻意保持精简：先做一个对独立开发者友好的 MVP，采集前端错误、性能指标、请求失败和面包屑信息，并在私有看板中展示。

## MVP 范围

- H5 SDK：JavaScript 错误、未处理的 Promise、资源加载错误、请求失败、基础 Web Vitals、面包屑。
- 微信小程序 SDK：运行时错误、未处理的 Promise、请求失败、页面生命周期耗时、面包屑。
- Collector 服务：接收 SDK 上报事件、校验数据格式、写入事件并聚合问题。
- Dashboard：本地注册与登录、按用户隔离的项目列表、按应用类型生成不同 app key、总览、问题列表、问题详情、SDK 接入指引、中英文界面。
- 部署：Docker Compose 最小化私有部署。
- 文档：事件协议、路线图、决策日志、以及供 AI 辅助续写的 handoff 提示词。

## 延后计划

以下属于路线图项，不属于首个版本的承诺：

- Android 与 iOS 原生 SDK。
- ANR 与 Native Crash 符号化解析。
- Kafka、Redis、MinIO、Grafana、Elasticsearch、Flink。
- Session Replay。
- 多租户计费或 SaaS 托管。

## 推荐技术栈

- SDK：TypeScript，Vite library mode 或 tsup。
- Dashboard：Vue 3、Vite、Element Plus、Pinia、Axios、ECharts。
- Server：MVP 阶段使用 Node.js + Fastify；若项目后期侧重基础设施品牌，可转向 Go。
- Storage：事件数据使用 ClickHouse；元数据根据部署需要选用 SQLite / PostgreSQL / MySQL。
- Package manager：yarn。

## 首个验证目标

第一个可用的里程碑是完成一个完整的本地闭环：

1. 使用 Docker Compose 或本地脚本启动 collector、数据库和 dashboard。
2. 打开一个示例 H5 应用。
3. 触发一次 JavaScript 错误和一次 HTTP 请求失败。
4. 在数秒内于 dashboard 中看到上报的事件。
5. 通过 fingerprint 将重复错误归并为同一个 issue。

## 仓库目录

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

下一阶段的计划目录：

```text
examples/wechat-mini-demo/
deploy/
```

## 当前开发快照

第一阶段的实现已初始化 yarn workspace monorepo，并开始构建可测试的 H5 闭环模块：

- `packages/core`：共享的事件 schema、批量校验、URL 脱敏、issue fingerprint 辅助工具。
- `packages/sdk-web`：浏览器 SDK，支持错误、资源加载失败、性能指标、fetch/XHR 事件、URL 脱敏和失败重试。
- `packages/sdk-miniprogram`：微信小程序 SDK，支持 `wx.onError`、`wx.onUnhandledRejection`、`wx.request` 和 App/Page 生命周期面包屑。
- `apps/server`：基于 Fastify 的 collector，提供本地认证、按用户隔离的应用管理、概览、事件上报、issue 聚合、issue 详情和内存存储。
- `examples/vue3-demo`：H5 示例应用，可触发 JavaScript 错误、Promise 异常和失败请求。
- `apps/dashboard`：Vue dashboard，用于登录 / 注册、切换语言、查看 app key、概览指标、issue 列表、issue 详情和 SDK 接入说明。

## Dashboard 登录与国际化

- 私有部署首次使用时通过本地注册和登录进入系统，每个用户只看到自己的项目列表。
- 项目包含 `type` 字段，可选值为 `web`、`wechat-miniprogram`、`alipay-miniprogram`、`flutter`、`other`，创建后会生成带类型前缀的 app key。
- Dashboard 会根据浏览器系统时区选择默认语言：中国相关时区默认中文，其他时区默认英文；用户也可以手动切换语言，选择会保存在浏览器本地。
- 后续 Dashboard 和文档改动必须同步维护英文与中文文案，避免只更新单一语言。

当前 MVP 的用户、会话、项目、事件和 issue 都使用内存存储，方便快速打通本地闭环。正式私有部署如果需要长期保存数据，后续应替换为持久化数据库。

常用命令：

```bash
yarn install
yarn test
yarn type-check
yarn lint
yarn dev:local
yarn dev:server
```

本地 MVP 地址：

- Collector：`http://127.0.0.1:3100/health`
- H5 demo：`http://127.0.0.1:5174/`
- Dashboard：`http://127.0.0.1:5175/`
