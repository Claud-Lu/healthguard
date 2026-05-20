# Next-Step Prompt

把下面这段交给下一轮 Codex / Claude Code / Kimi CLI 继续开发：

```text
你现在接手 HealthGuard 开源项目，路径是 /Users/claudlu/Desktop/public-pro/healthguard。

先阅读：
- README.md
- docs/HealthGuard_MVP_技术方案.md
- docs/roadmap.md
- docs/decisions/业务与交互变更记录.md

项目当前已从 Phase 0 进入 Phase 1：已初始化 yarn workspace monorepo，并新增 `packages/core`、`packages/sdk-web`、`apps/server`。

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
- `packages/sdk-web`：手动 `captureException`、`captureHttp`、breadcrumb 队列和 batch flush。
- `apps/server`：Fastify `/health`、`POST /api/events/batch`、`GET /api/issues`，当前为内存存储。
- 验证命令：`yarn test`、`yarn type-check`、`yarn lint`、`yarn build`。

建议下一步：
1. 给 `packages/sdk-web` 增加 `window.onerror`、`unhandledrejection`、资源加载错误和 fetch/XHR 自动 hook。
2. 初始化 `examples/vue3-demo`，接入 SDK 并提供“触发 JS 错误 / 触发失败请求”按钮。
3. 初始化 `apps/dashboard` 的 Vue 3 + Element Plus 骨架，先做 issue 列表读取。
4. 将 `apps/server` 内存存储替换为 SQLite 或 PostgreSQL 前，先用端到端 demo 验证事件协议是否稳定。
```
