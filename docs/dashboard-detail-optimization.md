# Dashboard 项目详情页优化方案

## 背景
当前 `ProjectDetailPage` 信息展示较为单薄，用户在排查问题时效率不高。本次优化围绕"快速定位活跃问题、减少信息噪音、增强交互能力"三个目标展开。

## 优化项清单

### 1. Issues 列表增强（高优先级）
**问题**：列表中每个 issue 只展示 message + eventCount + fingerprint，缺少活跃度和严重程度信息。

**优化内容**：
- 增加 `lastSeenAt` 展示（如"2 小时前"），让用户一眼识别活跃问题
- 按 eventCount 增加严重程度色标：
  - `> 20`：红色高亮（严重）
  - `> 5`：橙色（警告）
  - `≤ 5`：灰色（一般）
- 增加简单搜索框：按 issue.message 关键字过滤

**涉及文件**：
- `apps/dashboard/src/pages/ProjectDetailPage.ts`（Issues 列表渲染）
- `apps/dashboard/src/style.css`（issue-row 样式、搜索框样式）
- `apps/dashboard/src/i18n.ts`（新增 search 文案）

### 2. Metric Cards 点击筛选（高优先级）
**问题**：顶部 5 个指标卡片只是静态数字，无法联动下方 Issues 列表。

**优化内容**：
- 点击"错误数"卡片 → 过滤 Issues 列表只展示 `errorType = 'error'` 的 issue
- 点击"失败请求"卡片 → 过滤只展示 `errorType = 'http'` 的 issue
- 点击"Issues"卡片 → 取消过滤，展示全部
- 点击后卡片增加 active 态样式（边框高亮）

**涉及文件**：
- `apps/dashboard/src/pages/ProjectDetailPage.ts`（metrics 渲染 + 过滤状态）
- `apps/dashboard/src/style.css`（metric active 态）

### 3. SDK 接入代码可折叠（中优先级）
**问题**：sidebar 底部 SDK 代码块常驻展示，占用大量空间，不是每次都要看。

**优化内容**：
- SDK 区域默认折叠，只显示标题栏
- 点击标题栏展开/收起
- 收起时显示一个"展开 SDK 接入代码"的提示按钮

**涉及文件**：
- `apps/dashboard/src/pages/ProjectDetailPage.ts`（sdk-sidebar 渲染）
- `apps/dashboard/src/style.css`（折叠动画/样式）

### 4. Issue 详情头部信息补充（中优先级）
**问题**：右侧详情面板头部只展示 message + eventCount，缺少 issue 元信息。

**优化内容**：
- 增加 errorType 标签（带颜色）
- 增加"首次发生"和"最近发生"时间
- 增加涉及的平台分布小标签
- fingerprint 用可复制的小字展示（方便排查）

**涉及文件**：
- `apps/dashboard/src/pages/ProjectDetailPage.ts`（detail-body 头部渲染）
- `apps/dashboard/src/style.css`（详情头部样式）

## 分工建议

| Agent | 负责项 | 主要修改区域 |
|-------|--------|-------------|
| Agent A | Issues 列表增强 | Issues 列表渲染、搜索过滤、样式 |
| Agent B | Metric Cards 交互 + Issue 详情头部 | metrics 区域、detail-body 头部、样式 |
| Agent C | SDK 折叠 | sdk-sidebar 区域、样式 |

> 注：三个 Agent 修改集中在同一文件的不同区域，需避免冲突。建议各自使用 `StrReplaceFile` 精准替换，不整文件覆盖。
