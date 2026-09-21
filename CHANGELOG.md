# Changelog

本文件记录 HealthGuard 的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增
- 敏感信息扫描防线：`yarn check:sensitive` 脚本、pre-commit 钩子（`.githooks/`，`yarn install` 时自动启用）与 GitHub Actions 工作流三层共用同一扫描逻辑；内置通用规则（数字个人邮箱、真实形态 appKey、个人域名白名单、CGNAT 内网 IP 段），真实敏感词经 gitignore 的 `.sensitive-deny-list` 本地文件或 `SENSITIVE_DENY_LIST` Secret 注入，不进仓库。

### 修复
- 移除小程序 SDK 测试夹具中的真实第三方接口域名与项目名，替换为 `example.com` 通用占位。
- 邮件通知自动跳过明确的本地开发环境及 localhost、IPv4/IPv6 回环地址上的 Web/H5 页面；本地错误仍保留在监控记录中，且不占用告警间隔。
- 本地事件先创建或重开异常时，保留首次/复发通知条件给后续部署环境事件，避免关闭次数阈值后漏报；条件持久化并在关闭对应通知规则时清理。
- 保留已部署的测试/预发布/内网站点及正式 App 的告警，避免仅凭请求地址或原生 WebView 的 localhost 误判本地开发；补充内存与 PostgreSQL 回归验证。

## [0.4.1] - 2026-09-10

### 改进
- 告警邮件增加完整请求地址、H5 页面完整地址、App/小程序页面路由，以及平台、环境、状态码、耗时和触发事件标识。
- 通知保存触发事件的地址、页面、版本和时间，避免同一聚合异常在不同域名、页面或乱序上报时混用上下文；URL 的认证参数和用户凭据脱敏。

### 修复
- `@health-guard/sdk-uniapp@0.3.1` 修复 App/小程序当前页面采集：使用全局 `getCurrentPages()`，支持 `$page.fullPath` 与标准页面路由，兼容旧适配器。
- SDK 上报版本对齐包版本。旧客户端需升级 SDK 并重新发布后才能采集此前缺失的页面路由；历史事件不回填。

## [0.4.0] - 2026-09-09

### 新增
- 页面配置 SMTP 发件邮箱、授权码和各项目收件邮箱；支持保存配置、发送测试邮件及查看发送记录。
- 新异常、异常再次出现、累计次数阈值和同异常通知间隔；默认关闭通知。
- PostgreSQL 持久化通知队列与并发防重，授权码加密保存、接口脱敏及账号/项目隔离。
- 补充通知部署与操作文档 `docs/email-notifications.md`。

## [0.3.0] - 2026-06-18

### 新增
- 新增 `@health-guard/repair-agent` 包：扫描项目 SDK 配置，登录 HealthGuard 并拉取 issue 列表/详情，支持本地源码关键词匹配。

### 修复
- SDK transport 失败后增加退避重试（`transportFailureRetryDelayMs`，默认 30s），失败事件回队并支持手动 `flush()` 强制上报。
- `sdk-uniapp` 与 `sdk-miniprogram` 对齐 `sdk-web` 的退避重试行为。

### 变更
- 公共 npm 包版本统一提升至 `0.3.0`。

## [0.2.0] - 2026-06-09

### 新增
- 手动修复任务功能（Repair Task Phase 1）
  - 支持从 Issue 创建修复任务，选择 Agent（Hermes / Codex / Claude Code / 手动）
  - 任务状态流转：pending → claimed → running → pr_created → closed
  - Dashboard 修复任务列表、详情页、取消操作
  - PostgreSQL 持久化修复任务数据和进度笔记
  - 认证 API 和 Agent API 分离设计
- Issue 管理和筛选功能
- Issue ID 缩短显示 + 复制给 AI 按钮
- Dashboard 侧边栏显示版本号
- 支付宝小程序监控上下文补全
- Issue 详情页缺失的 CSS 样式和国际化文案

### 修复
- 防止 SDK transport 失败时的无限递归错误循环
- 移除未使用的 reactive import

### 文档
- 修复任务工作流设计文档（中英文）
- 修复任务 Phase 1 实施计划

## [0.1.0] - 2026-05-01

### 新增
- H5/Web SDK（`@health-guard/sdk-web`）
  - JavaScript 错误自动捕获
  - HTTP 请求失败监控（fetch + XHR）
  - Promise rejection 捕获
  - 性能指标采集
- 微信小程序 SDK（`@health-guard/sdk-miniprogram`）
  - 运行时错误捕获
  - Promise rejection 捕获
  - `wx.request` 请求监控
  - 页面生命周期面包屑
- uni-app 多端 SDK（`@health-guard/sdk-uniapp`）
  - 支持 H5、微信、支付宝、抖音、App 等平台
  - 自动检测运行环境并适配
  - 设备信息和页面 URL 检测
- Dashboard 前端（Vue 3 + Vite）
  - 项目管理（创建、查看、SDK 接入指南）
  - 总览页面（事件统计、错误率、失败请求）
  - Issue 列表（聚合去重、平台筛选、时间筛选）
  - Issue 详情（堆栈跟踪、面包屑、事件时间线）
  - 中英文自动检测 + 手动切换
- Server 后端（Node.js + Fastify）
  - 事件批量采集 API
  - Issue 聚合和分页查询
  - 本地认证（注册/登录，会话 Token）
  - 用户级项目隔离
- PostgreSQL 持久化
  - 连接池（pg.Pool）
  - 批量 INSERT 优化
  - 时间戳索引
  - 自动数据清理
- Docker 一键部署
  - docker-compose.yml（PostgreSQL + Server + Dashboard）
  - 健康检查端点
  - 部署文档
- 安全加固
  - 所有查询端点认证保护
  - nanoid ID 生成
  - 优雅关闭（SIGTERM/SIGINT）
  - 速率限制和 CORS

### 文档
- README（中英文）
- 运维指南
- AI CLI 操作手册
- 运营商指南

[0.3.0]: https://github.com/Claud-Lu/healthguard/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Claud-Lu/healthguard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Claud-Lu/healthguard/releases/tag/v0.1.0
