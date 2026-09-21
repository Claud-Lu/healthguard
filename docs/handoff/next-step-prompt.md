# Next-Step Prompt

把下面这段交给下一轮 Codex / Claude Code / Kimi CLI 继续开发：

```text
你现在接手 HealthGuard 开源项目，请在仓库根目录执行后续操作。

先阅读：
- README.md
- docs/HealthGuard_MVP_技术方案.md
- docs/roadmap.md
- docs/operator-guide.md
- docs/ai-cli-operations.md
- docs/decisions/业务与交互变更记录.md

项目当前已发布到 `v0.3.0`：已完成 H5 / 微信小程序 / uni-app SDK、Dashboard、Fastify Server、PostgreSQL 持久化、Docker Compose 部署、认证隔离、Issue 管理、Repair Task Phase 1，以及 `@health-guard/repair-agent`。

开发原则：
- 先跑通 H5 端到端闭环，再扩展微信小程序。
- 不要第一版引入 Android/iOS、Kafka、Redis、MinIO、Grafana、Session Replay。
- 默认使用 yarn。
- Dashboard 优先 Vue 3 + Vite + Element Plus + Pinia + Axios + ECharts。
- 所有需求、接口、交互和架构决策都同步写入 docs/decisions/业务与交互变更记录.md。
- 登录、注册、项目创建、app key、SDK 接入、部署、持久化或验证流程变化时，必须同时更新 `docs/operator-guide.md` 和 `docs/ai-cli-operations.md`。
- 开源仓库不得提交公司项目名、公司域名、IP、个人路径、密钥、业务账号或业务专用 app key；这些真实值只放到消费方应用环境、私有部署配置或知识库。
- 写功能前先补测试或最小验证脚本。
- 每一步完成后必须运行对应验证命令，不要只口头说完成。

当前已完成：
- `packages/core`：事件 schema、batch 校验、敏感 query 脱敏、issue fingerprint。
- `packages/sdk-web`：手动捕获、自动 `error` / `unhandledrejection` / 资源错误 / fetch / XHR、性能事件、breadcrumb 队列、batch flush、失败回队和退避重试。
- `packages/sdk-miniprogram`：`wx.onError`、`wx.onUnhandledRejection`、`wx.request` 和 App/Page 生命周期 breadcrumb。
- `packages/sdk-uniapp`：H5、微信、支付宝、抖音、App 等运行时检测和多端采集。
- `packages/repair-agent`：扫描本地 SDK 配置，登录 HealthGuard 拉取 issue 列表/详情，并做本地源码关键词匹配。
- `apps/server`：Fastify 采集、认证、项目、Issue、归档/重开、Repair Task、Agent API；支持 PostgreSQL 持久化和无 `DATABASE_URL` 时的内存 fallback。
- `examples/vue3-demo`：接入 web SDK，可触发 JS 错误、Promise 异常和失败请求。
- `apps/dashboard`：Vue dashboard，可查看项目列表、app key、概览、issue 列表、issue 详情、修复任务和 SDK snippet。
- `scripts/dev-local.sh` / `yarn dev:local`：同时启动 collector、demo、dashboard。
- 验证命令：`yarn test`、`yarn type-check`、`yarn lint`、`yarn build`。

建议下一步：
1. 补 `examples/wechat-mini-demo`，验证微信小程序 SDK 的真实 demo 闭环。
2. 增加管理员 seed 脚本或部署初始化流程。
3. 启动告警通知 Phase：阈值规则、Webhook、通知历史。
4. 启动 SourceMap / release tracking Phase：上传、堆栈反解和 release 维度健康度。
5. Flutter SDK 仍是计划项；不要在 README 或官网中把它描述为已完成能力。
```
