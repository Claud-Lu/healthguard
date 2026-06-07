# HealthGuard 修复任务设计

## 背景

HealthGuard 现在已经能把运行时错误和失败请求聚合成 issue。Dashboard 的 issue 详情页也已经能生成一份适合复制给 AI 的错误报告。下一步，是把这个人工复制流程升级成一条正式的修复任务流：

```text
HealthGuard issue -> 修复任务 -> Hermes/Codex/Claude Code -> draft PR -> HealthGuard 状态回写
```

这个设计里，HealthGuard 继续作为监控和编排控制台。代码 Agent 负责拉仓库、改代码、验证、提交、推送和创建 Pull Request。

## 目标

- 用户可以从已有 HealthGuard issue 创建修复任务。
- 后续告警规则可以自动创建修复任务。
- Hermes 或其他 Agent Runner 可以轮询待处理任务，后续也可以接 webhook。
- Agent 可以更新任务状态、写入修复摘要、回写 PR 地址。
- Dashboard 展示完整生命周期，让用户看到“发现错误 -> 开始修复 -> 已创建 PR”的过程。

## 非目标

- HealthGuard 不直接编辑源码。
- HealthGuard 不创建空 PR。
- HealthGuard 不合并 PR，也不部署生产环境。
- MVP 阶段 HealthGuard 不保存拥有任意写权限的 GitHub token。
- 本功能不解决 sourcemap 反混淆；它只消费当前已有的 release 和 stack 数据。

## 产品模型

Issue 是一组被聚合的运行时问题。修复任务是针对某个 issue 发起的一次调查和修复尝试。

```text
Issue
  - fingerprint
  - 错误信息
  - 出现次数
  - 最近事件

修复任务
  - 关联 issue
  - 目标代码仓库
  - 指定 Agent
  - 修复状态
  - PR / 修复结果
```

Dashboard 提供两个入口：

- Issue 详情页：“创建修复任务”按钮。
- 项目详情页：“修复任务”列表或 tab，展示近期任务。

## 任务状态

MVP 的状态机保持克制：

```text
pending -> claimed -> running -> pr_created -> closed
        -> failed
        -> canceled
```

状态含义：

- `pending`：任务已创建，等待 Agent 处理。
- `claimed`：Agent 已领取任务，即将开始。
- `running`：Agent 正在诊断或修改代码。
- `pr_created`：已经创建 draft PR 或普通 PR。
- `failed`：Agent 无法完成修复。
- `canceled`：用户在任务完成前取消。
- `closed`：用户 review 后手动关闭任务。

Agent 每次更新状态时追加一条进度记录。列表展示最新状态，任务详情展示完整时间线。

## 数据模型

在服务端 Store 层新增修复任务存储。

```ts
type RepairTaskStatus =
  | 'pending'
  | 'claimed'
  | 'running'
  | 'pr_created'
  | 'failed'
  | 'canceled'
  | 'closed';

interface RepairTask {
  id: string;
  issueId: string;
  appKey: string;
  ownerUserId: string;
  status: RepairTaskStatus;
  agent: 'hermes' | 'codex' | 'claude-code' | 'manual';
  repoUrl: string;
  baseBranch: string;
  repairBranch?: string;
  prUrl?: string;
  commitSha?: string;
  summary?: string;
  failureReason?: string;
  createdAt: number;
  updatedAt: number;
  claimedAt?: number;
  completedAt?: number;
}

interface RepairTaskNote {
  id: string;
  taskId: string;
  actor: 'healthguard' | 'hermes' | 'codex' | 'claude-code' | 'user';
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}
```

PostgreSQL 新增 `repair_tasks` 和 `repair_task_notes` 表。Memory Store 也实现同样方法，方便测试和本地开发。

## 修复 Payload

Agent 需要结构化数据，不能靠抓取 Dashboard 文本。

```ts
interface RepairTaskPayload {
  task: RepairTask;
  issue: IssueSummary;
  events: HealthGuardEvent[];
  project: {
    appKey: string;
    name?: string;
    type?: string;
  };
  instructions: {
    repoUrl: string;
    baseBranch: string;
    expectedCommands?: {
      install?: string;
      test?: string;
      build?: string;
    };
    constraints: string[];
  };
}
```

默认只携带最近的样本事件，例如最近 5 条匹配事件。敏感请求字段继续沿用 SDK/core 现有脱敏规则，进入 payload 前必须已经过滤。

## API 设计

Dashboard 鉴权 API：

- `POST /api/repair-tasks`
  - 从 issue 创建修复任务。
  - Body：`{ issueId, agent, repoUrl, baseBranch, expectedCommands? }`
  - 返回：`{ task }`

- `GET /api/repair-tasks?appKey=...`
  - 列出某个项目的修复任务。
  - 返回：`{ tasks }`

- `GET /api/repair-tasks/:id`
  - 返回任务详情和进度记录。
  - 返回：`{ task, notes }`

- `POST /api/repair-tasks/:id/cancel`
  - 用户取消 `pending`、`claimed` 或 `running` 状态的任务。
  - 返回：`{ task }`

Agent API：

- `GET /api/agent/repair-tasks/pending?agent=hermes`
  - 返回有限数量的待处理任务。

- `POST /api/agent/repair-tasks/:id/claim`
  - 原子领取一个待处理任务。
  - Body：`{ agentRunId }`

- `GET /api/agent/repair-tasks/:id/payload`
  - 返回结构化修复 payload。

- `POST /api/agent/repair-tasks/:id/status`
  - 更新任务状态，并追加一条进度记录。
  - Body：`{ status, message, repairBranch?, prUrl?, commitSha?, summary?, failureReason?, metadata? }`

Agent API 使用独立的服务端 token，不使用用户 session token。token 存在部署环境密钥里，不写进仓库。

## Dashboard 交互

Issue 详情页增加一个紧凑的修复操作区：

- 按钮：“创建修复任务”。
- 创建时填写：
  - Agent：默认 Hermes。
  - 仓库 URL。
  - 基准分支：默认 `main`。
  - 可选 test/build 命令。

项目详情页增加“修复任务”视图：

- pending/running/PR created/failed 等状态标签。
- 关联 issue 信息。
- 最近更新时间。
- 有 PR 时展示 PR 链接。
- 失败时展示失败原因。

任务详情页展示：

- Issue 摘要。
- Agent 和仓库目标。
- 进度时间线。
- PR 地址和验证摘要。

## Hermes 集成

第一版建议用轮询：

```text
Hermes watchdog
  -> 获取待处理任务
  -> 领取任务
  -> 获取 payload
  -> 运行配置好的代码 Agent
  -> 更新任务进度
  -> 创建 draft PR
  -> 回写 PR 地址
```

第一版用轮询比 webhook 更简单、更安全，因为 Hermes 可以自己控制并发、重试和本机可用状态。

后续再给 HealthGuard 增加出站 webhook：

```text
repair_task.created
repair_task.status_changed
repair_task.pr_created
repair_task.failed
```

## 安全与权限

- 创建修复任务需要和 issue 详情一样的用户归属校验。
- Agent API 需要 `HEALTHGUARD_AGENT_TOKEN`。
- Agent token 只能读取和更新修复任务，不能管理用户或项目。
- 仓库 URL 和命令属于项目配置，不硬编码进源码。
- HealthGuard 只保存 PR 元数据，不保存 GitHub 写权限 token。
- 默认输出 draft PR，不直接合并。

## 测试策略

服务端测试：

- 创建任务必须鉴权。
- 用户只能给自己拥有的 issue 创建任务。
- 待处理任务只能被原子领取一次。
- Agent 状态更新会追加 note 并更新时间戳。
- 非法状态流转会被拒绝。

Store 测试：

- Memory 和 PostgreSQL Store 都实现同样的修复任务方法。
- PostgreSQL migration 创建必要表和索引。

Dashboard 测试：

- Issue 详情页渲染创建修复任务入口。
- 修复任务列表展示状态、关联 issue 和 PR 链接。
- 失败任务展示失败原因。

集成冒烟测试：

- 创建测试 issue。
- 创建修复任务。
- 通过 Agent API 领取任务。
- 更新状态为 `pr_created`。
- 确认 Dashboard API 返回 PR 地址。

## 实施阶段

### Phase 1：手动修复任务

- 增加修复任务 Store 类型和持久化。
- 增加 Dashboard 鉴权 API。
- 增加 Dashboard 创建、列表、详情 UI。
- 暂不接 Hermes 自动化。

### Phase 2：Agent 轮询 API

- 增加 token 保护的 Agent API。
- 从 issue 详情数据生成结构化 payload。
- 增加状态更新和 note 时间线。

### Phase 3：Hermes Runner

- 配置 Hermes watchdog 轮询待处理任务。
- 用 payload 调用 Codex 或 Claude Code。
- 推送修复分支并创建 draft PR。
- 将 PR 结果回写 HealthGuard。

### Phase 4：自动创建任务

- 增加告警规则，例如新 issue、次数阈值、生产 release 回归。
- 规则命中后自动创建 pending 修复任务，并加频率限制。

## 待决策项

- 项目级仓库配置放在 app settings 表，还是单独的 integration 表。
- expected commands 是按项目保存，还是每次任务单独保存。
- Hermes 直接调用 Codex，还是先创建本地中间队列。
- 开启生产环境自动修复任务前，需要做到多完整的 sourcemap 支持。

## 推荐 MVP 决策

先从 issue 详情页手动创建修复任务，再接 Hermes 轮询。这样可以先跑通可见的端到端流程，同时不让 HealthGuard 承担写代码职责，也不需要给 HealthGuard GitHub 写权限。
