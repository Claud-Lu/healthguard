# Changelog

本文件记录 HealthGuard 的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 修复
- 补充 `/api/health` 兼容健康检查端点，适配公司 21 环境的 `/healthguard-api/health` 反向代理。

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

[0.2.0]: https://github.com/Claud-Lu/healthguard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Claud-Lu/healthguard/releases/tag/v0.1.0
