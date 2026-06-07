# HealthGuard Repair Task Design

## Background

HealthGuard already groups runtime errors and failed requests into issues. The dashboard can also produce a human-readable AI report from an issue detail view. The next step is to turn that manual copy flow into a first-class repair workflow:

```text
HealthGuard issue -> Repair Task -> Hermes/Codex/Claude Code -> draft PR -> HealthGuard status update
```

This design keeps HealthGuard as the monitoring and orchestration console. Code agents remain responsible for repository checkout, code changes, verification, commit, push, and pull request creation.

## Goals

- Let a user create a repair task from an existing HealthGuard issue.
- Let alert rules create repair tasks automatically in a later phase.
- Let Hermes or another agent runner poll pending tasks or receive webhook events.
- Let the agent update task status, attach repair summaries, and write back the PR URL.
- Show the repair lifecycle in the dashboard so the user can track "error found -> fix attempted -> PR created".

## Non-Goals

- HealthGuard will not edit source code.
- HealthGuard will not create empty pull requests.
- HealthGuard will not merge pull requests or deploy production builds.
- HealthGuard will not store GitHub tokens for arbitrary write access in the MVP.
- HealthGuard will not solve sourcemap de-minification in this feature; it should consume release and stack data that already exists.

## Product Model

An issue is a grouped runtime problem. A repair task is one attempt to investigate and fix that issue.

```text
Issue
  - fingerprint
  - message
  - event count
  - recent events

Repair Task
  - issue reference
  - repository target
  - selected agent
  - repair status
  - PR/result details
```

The dashboard should expose two entry points:

- Issue detail: "Create repair task" button.
- Project detail: "Repair Tasks" section or tab listing recent tasks.

## Task States

The MVP state machine is intentionally small:

```text
pending -> claimed -> running -> pr_created -> closed
        -> failed
        -> canceled
```

State meanings:

- `pending`: Created and waiting for an agent.
- `claimed`: An agent has reserved the task and should start soon.
- `running`: The agent is actively diagnosing or modifying code.
- `pr_created`: A draft or ready PR exists.
- `failed`: The agent could not complete the repair.
- `canceled`: The user canceled the task before completion.
- `closed`: The user closed the task manually after review.

Agents update the task with short, append-only progress notes. The latest status is shown in lists; the full note timeline is shown in task detail.

## Data Model

Add repair task storage to the server store layer.

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

For PostgreSQL, add `repair_tasks` and `repair_task_notes` tables. The memory store should implement the same methods for tests and local development.

## Repair Payload

Agents need a structured payload, not scraped dashboard text.

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

The payload should include only the most recent sample events by default, for example the latest 5 matching events. Sensitive request keys must continue to be filtered by the SDK/core sanitization rules before reaching this payload.

## API Design

Authenticated dashboard APIs:

- `POST /api/repair-tasks`
  - Creates a task from an issue.
  - Body: `{ issueId, agent, repoUrl, baseBranch, expectedCommands? }`
  - Returns: `{ task }`

- `GET /api/repair-tasks?appKey=...`
  - Lists repair tasks for one project.
  - Returns: `{ tasks }`

- `GET /api/repair-tasks/:id`
  - Returns task detail plus notes.
  - Returns: `{ task, notes }`

- `POST /api/repair-tasks/:id/cancel`
  - User cancels a pending, claimed, or running task.
  - Returns: `{ task }`

Agent APIs:

- `GET /api/agent/repair-tasks/pending?agent=hermes`
  - Returns a limited list of pending tasks.

- `POST /api/agent/repair-tasks/:id/claim`
  - Atomically claims one pending task.
  - Body: `{ agentRunId }`

- `GET /api/agent/repair-tasks/:id/payload`
  - Returns the structured repair payload.

- `POST /api/agent/repair-tasks/:id/status`
  - Updates task status and appends a note.
  - Body: `{ status, message, repairBranch?, prUrl?, commitSha?, summary?, failureReason?, metadata? }`

Agent APIs should use a separate server-side token, not a user session token. Store the token in deployment secrets, not in the repository.

## Dashboard UX

Issue detail should add a compact repair action area:

- Button: "Create repair task".
- Fields when creating:
  - Agent: Hermes by default.
  - Repository URL.
  - Base branch, default `main`.
  - Optional test/build commands.

Project detail should add a "Repair Tasks" view:

- Status chips for pending/running/PR created/failed.
- Linked issue message.
- Last update time.
- PR link when available.
- Failure reason when failed.

Task detail should show:

- Issue summary.
- Agent and repository target.
- Timeline notes.
- PR URL and verification summary.

## Hermes Integration

The first integration can use polling:

```text
Hermes watchdog
  -> GET pending tasks
  -> claim task
  -> fetch payload
  -> run configured code agent
  -> update status notes
  -> create draft PR
  -> write PR URL back
```

Polling is simpler and safer than webhooks for the first version because Hermes can control concurrency, retries, and local machine availability.

A later version can add outgoing webhooks from HealthGuard:

```text
repair_task.created
repair_task.status_changed
repair_task.pr_created
repair_task.failed
```

## Security And Permissions

- Repair task creation requires the same authenticated user ownership checks as issue detail.
- Agent APIs require `HEALTHGUARD_AGENT_TOKEN`.
- Agent tokens can only read and update repair tasks, not manage users or apps.
- Repository URLs and commands are project configuration, not hardcoded source constants.
- HealthGuard stores PR metadata, not GitHub write tokens.
- The default agent output should be draft PRs, not direct merges.

## Testing Strategy

Server tests:

- Creating a task requires authentication.
- A task can only be created for an issue owned by the user.
- Pending tasks can be claimed atomically once.
- Agent status updates append notes and update timestamps.
- Invalid state transitions are rejected.

Store tests:

- Memory and PostgreSQL stores implement the same repair task methods.
- PostgreSQL migrations create required tables and indexes.

Dashboard tests:

- Issue detail renders the create repair task action.
- Repair task list renders status, linked issue, and PR link.
- Failed task renders failure reason.

Integration smoke test:

- Create test issue.
- Create repair task.
- Claim it through agent API.
- Update status to `pr_created`.
- Confirm dashboard API returns the PR URL.

## Implementation Phases

### Phase 1: Manual Repair Tasks

- Add store types and persistence for repair tasks.
- Add authenticated dashboard APIs.
- Add dashboard create/list/detail UI.
- No Hermes automation yet.

### Phase 2: Agent Polling API

- Add token-protected agent endpoints.
- Add structured payload generation from issue detail data.
- Add status update and note timeline.

### Phase 3: Hermes Runner

- Configure Hermes watchdog to poll pending tasks.
- Run Codex or Claude Code with the repair payload.
- Push branch and create draft PR.
- Write PR result back to HealthGuard.

### Phase 4: Automatic Task Creation

- Add alert rules for new issue, count threshold, or production release regression.
- Let rules create pending repair tasks automatically with rate limits.

## Open Decisions

- Where project-level repository configuration should live: app settings table or a dedicated integration table.
- Whether expected commands should be stored per project or per task.
- Whether Hermes should call Codex directly or create an intermediate local queue.
- How much source map support is needed before enabling production auto-repair tasks.

## Recommended MVP Decision

Start with manual task creation from issue detail and Hermes polling. This gives a visible end-to-end workflow without giving HealthGuard code-writing responsibility or GitHub write credentials.
