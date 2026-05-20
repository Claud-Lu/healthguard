# Next-Step Prompt

把下面这段交给下一轮 Codex / Claude Code / Kimi CLI 继续开发：

```text
你现在接手 HealthGuard 开源项目，请在仓库根目录执行后续操作。

先阅读：
- README.md
- docs/HealthGuard_MVP_技术方案.md
- docs/roadmap.md
- docs/decisions/业务与交互变更记录.md

项目当前已完成 MVP 本地闭环雏形：已初始化 yarn workspace monorepo，并新增 `packages/core`、`packages/sdk-web`、`packages/sdk-miniprogram`、`apps/server`、`apps/dashboard`、`examples/vue3-demo`。

开发原则：
- 先跑通 H5 端到端闭环，再扩展微信小程序。
- 不要第一版引入 Android/iOS、Kafka、Redis、MinIO、Grafana、Session Replay。
- 默认使用 yarn。
- Dashboard 优先 Vue 3 + Vite + Element Plus + Pinia + Axios + ECharts。
- 所有需求、接口、交互和架构决策都同步写入 docs/decisions/业务与交互变更记录.md。
- 写功能前先补测试或最小验证脚本。
- 每一步完成后必须运行对应验证命令，不要只口头说完成。

当前已完成：
- `packages/core`：事件 schema、batch 校验、敏感 query 脱敏、issue fingerprint。
- `packages/sdk-web`：手动捕获、自动 `error` / `unhandledrejection` / 资源错误 / fetch / XHR、性能事件、breadcrumb 队列、batch flush 和失败重试。
- `packages/sdk-miniprogram`：`wx.onError`、`wx.onUnhandledRejection`、`wx.request` 和 App/Page 生命周期 breadcrumb。
- `apps/server`：Fastify `/health`、`POST /api/events/batch`、`GET /api/issues`、`GET /api/issues/:id`、`GET /api/overview`、`GET/POST /api/apps`，当前为内存存储。
- `examples/vue3-demo`：接入 web SDK，可触发 JS 错误、Promise 异常和失败请求。
- `apps/dashboard`：Vue dashboard，可查看 app key、概览、issue 列表、issue 详情和 SDK snippet。
- `scripts/dev-local.sh` / `yarn dev:local`：同时启动 collector、demo、dashboard。
- 验证命令：`yarn test`、`yarn type-check`、`yarn lint`、`yarn build`。

建议下一步：
1. 在一个真实业务应用的 H5 管理端、微信小程序、支付宝小程序做引入测试，先验证不污染业务数据、不上报敏感字段。
2. 将 `apps/server` 内存存储替换为 SQLite 或 PostgreSQL。
3. 补 `examples/wechat-mini-demo`。
4. 再补 Docker Compose 和持久化部署说明。
```
