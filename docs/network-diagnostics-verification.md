# 网络诊断补全验收记录（2026-10-14）

## 交付范围

HealthGuard 主仓库 `master`：统一诊断契约和规则，Web / 小程序 / uni-app 诊断与持久补传，独立 Flutter/Dio SDK 和 Android 网络状态插件，Collector 回放去重，Dashboard / AI 报告 / 邮件摘要，以及接入文档。业务应用迁移和外部发布不包含在此验收结果中。

## 已验证

| 检查 | 结果 |
| --- | --- |
| `yarn build` | 所有工作区构建通过 |
| `yarn test` | 183 通过，2 项服务级数据库测试跳过 |
| `yarn test:network` | 44 通过，统一诊断模块行/语句/函数 100%，分支 89.85% |
| TypeScript / ESLint / 敏感扫描 / diff 格式 | 通过 |
| Flutter 3.41 | 4 项测试通过，analyze 无问题，客户端行覆盖率 191/234（81.62%） |
| Flutter 3.27 | 4 项测试通过，Dart analyze 无问题 |
| Android 原生插件 | 使用 Android API 35 与 Flutter embedding 的 Java 编译通过；API 21/22 回退分支有正常的弃用 API 编译提示 |
| npm pack dry-run | core / Web / 小程序 / uni-app 0.4.0 包检查通过 |
| Flutter publish dry-run | 0 警告；未执行发布 |
| 临时 Collector + Dashboard | 模拟事件 accepted=1；浏览器实际详情显示目标域、离线状态、近期状态通知和 unavailable 耗时；SDK 接入区域显示 Flutter 初始化与 Dio 挂载 |
| PostgreSQL 引擎回放 | PGlite 执行真实 SQL；重复批内/批间回放和重建 Store 后回放均不重复聚合，原事件 ID、时间、版本及诊断保留 |

旧 Flutter SDK 的 `flutter analyze` 命令因其分发目录缺少工具自身的 `dev/` 目录而退出；使用同一旧 SDK 的 `dart analyze lib test` 通过。旧版测试实际编译并执行成功，未把工具环境异常记为源码失败或忽略。

浏览器点击「复制给 AI」有成功提示；当前浏览器控制通道不能读回实际系统剪贴板内容，因此剪贴板内容未独立验收。诊断摘要函数和报告接入已有自动化验证。

## 验收边界

- PGlite 不是独立 PostgreSQL 服务，不能替代连接池或多进程锁并发验收。两项既有服务集成测试未提供 `TEST_DATABASE_URL`，保持跳过。
- Android 编译和模拟事件不等于真机切网、断网重启、VPN、旧 Android 安装或实际邮件告警验证。
- 版本号和 package dry-run 不代表 npm/pub.dev 已发布；源码推送不代表 Collector/Dashboard 已部署或业务 App 已升级。
- 当前只有被动证据采集，不包含主动 DNS/TCP/任意地址探测。网络分类仍需结合请求、服务端和现场证据判断根因。

后续接入与发布步骤见 [网络诊断指南](./network-diagnostics.md)。
