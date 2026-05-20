# Next-Step Prompt

把下面这段交给下一轮 Codex / Claude Code / Kimi CLI 继续开发：

```text
你现在接手 HealthGuard 开源项目，路径是 /Users/claudlu/Desktop/public-pro/healthguard。

先阅读：
- README.md
- docs/HealthGuard_MVP_技术方案.md
- docs/roadmap.md
- docs/decisions/业务与交互变更记录.md

项目当前处于 Phase 0：只有文档和开源骨架，还没有初始化代码。

开发原则：
- 先跑通 H5 端到端闭环，再扩展微信小程序。
- 不要第一版引入 Android/iOS、Kafka、Redis、MinIO、Grafana、Session Replay。
- 默认使用 yarn。
- Dashboard 优先 Vue 3 + Vite + Element Plus + Pinia + Axios + ECharts。
- 所有需求、接口、交互和架构决策都同步写入 docs/decisions/业务与交互变更记录.md。
- 写功能前先补测试或最小验证脚本。
- 每一步完成后必须运行对应验证命令，不要只口头说完成。

建议下一步：
1. 确认后端 MVP 使用 Node.js/Fastify 还是 Go 单体。
2. 初始化 monorepo。
3. 定义事件 schema。
4. 先实现 packages/sdk-web 的最小错误采集和单测。
5. 再实现 collector API，让 examples/vue3-demo 抛错后可以在服务端看到事件。
```
