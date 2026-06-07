# Repair Tasks Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first manual Repair Task workflow so authenticated users can create, list, inspect, and cancel repair tasks from HealthGuard issues.

**Architecture:** Add Repair Task types and persistence to the existing Store abstraction, then expose authenticated dashboard APIs from the Fastify app. Add a compact dashboard surface in `ProjectDetailPage.ts` that creates tasks from the selected issue and lists task state for the current project.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, in-memory store, Vue 3 render functions, Vitest, Yarn workspaces.

---

## File Structure

- `apps/server/src/store/types.ts`: Add `RepairTask`, `RepairTaskNote`, `RepairTaskStatus`, request input, and Store methods.
- `apps/server/src/store/memory.ts`: Add in-memory task/note arrays and task methods.
- `apps/server/src/store/postgres.ts`: Add tables, row mappers, and PostgreSQL task methods.
- `apps/server/src/app.ts`: Add authenticated Repair Task API endpoints and validation helpers.
- `apps/server/src/app.test.ts`: Add endpoint tests for auth, ownership, create/list/detail/cancel.
- `apps/dashboard/src/globalStore.ts`: Add frontend Repair Task types.
- `apps/dashboard/src/pages/ProjectDetailPage.ts`: Add task state, API calls, create action, and task list rendering.
- `apps/dashboard/src/project-detail-context.test.ts`: Add source-level regression checks for the dashboard repair task UI.

## Task 1: Server Store Contract

**Files:**
- Modify: `apps/server/src/store/types.ts`
- Modify: `apps/server/src/store/memory.ts`
- Test: `apps/server/src/app.test.ts`

- [ ] **Step 1: Write a failing API test for creating and listing a repair task**

Add a test that registers a user, ingests an issue, creates a repair task, and lists it by `appKey`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `yarn vitest run apps/server/src/app.test.ts -t "creates and lists repair tasks"`

Expected: fail with `404` or missing endpoint.

- [ ] **Step 3: Add Repair Task types to the Store contract**

Add:

```ts
export type RepairTaskStatus = 'pending' | 'claimed' | 'running' | 'pr_created' | 'failed' | 'canceled' | 'closed';
export type RepairTaskAgent = 'hermes' | 'codex' | 'claude-code' | 'manual';

export interface RepairTask {
  id: string;
  issueId: string;
  appKey: string;
  ownerUserId: string;
  status: RepairTaskStatus;
  agent: RepairTaskAgent;
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

export interface RepairTaskNote {
  id: string;
  taskId: string;
  actor: 'healthguard' | 'hermes' | 'codex' | 'claude-code' | 'user';
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface CreateRepairTaskInput {
  issueId: string;
  appKey: string;
  ownerUserId: string;
  agent: RepairTaskAgent;
  repoUrl: string;
  baseBranch: string;
  createdAt: number;
}
```

Add Store methods:

```ts
createRepairTask(input: CreateRepairTaskInput): Promise<RepairTask>;
listRepairTasks(appKey: string, ownerUserId: string): Promise<RepairTask[]>;
getRepairTaskDetail(id: string, ownerUserId: string): Promise<{ task: RepairTask | null; notes: RepairTaskNote[] }>;
cancelRepairTask(id: string, ownerUserId: string, canceledAt: number): Promise<RepairTask | null>;
```

- [ ] **Step 4: Implement memory store methods**

Store tasks and notes in arrays. Create IDs with deterministic prefixes using current array length, for example `repair_1` and `repair_note_1`.

- [ ] **Step 5: Run the focused test and verify remaining failures are API-only**

Run: `yarn vitest run apps/server/src/app.test.ts -t "creates and lists repair tasks"`

Expected: still fail until API routes exist.

## Task 2: Dashboard Repair Task APIs

**Files:**
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/app.test.ts`

- [ ] **Step 1: Implement authenticated routes**

Add:

- `POST /api/repair-tasks`
- `GET /api/repair-tasks?appKey=...`
- `GET /api/repair-tasks/:id`
- `POST /api/repair-tasks/:id/cancel`

Rules:

- All routes require `Authorization: Bearer <token>`.
- Create validates `issueId`, `repoUrl`, and `baseBranch`.
- Create checks the issue exists and belongs to an app owned by the user.
- List returns only tasks owned by the user for the supplied app key.
- Cancel only works for `pending`, `claimed`, or `running`; otherwise return current task unchanged.

- [ ] **Step 2: Run focused server test**

Run: `yarn vitest run apps/server/src/app.test.ts -t "repair tasks"`

Expected: pass.

- [ ] **Step 3: Add tests for ownership and cancel behavior**

Add tests that another user cannot create a task for someone else's app issue, and that cancel moves a pending task to `canceled`.

- [ ] **Step 4: Run focused server tests again**

Run: `yarn vitest run apps/server/src/app.test.ts -t "repair tasks"`

Expected: pass.

## Task 3: PostgreSQL Persistence

**Files:**
- Modify: `apps/server/src/store/postgres.ts`
- Test: `apps/server/src/store/postgres.test.ts`

- [ ] **Step 1: Write a failing PostgreSQL store test**

Add a test that creates a user/app, inserts an issue-producing event, creates a repair task, lists it, fetches detail, and cancels it.

- [ ] **Step 2: Run the focused PostgreSQL test and verify it fails**

Run: `yarn vitest run apps/server/src/store/postgres.test.ts -t "repair tasks"`

Expected: fail because PostgreSQL store methods are missing.

- [ ] **Step 3: Add schema and row mappers**

Create `repair_tasks` and `repair_task_notes` tables in `ensureSchema`, plus indexes on `app_key`, `owner_user_id`, and `status`.

- [ ] **Step 4: Implement PostgreSQL task methods**

Use SQL inserts/selects/updates matching the Store contract. `createRepairTask` should insert the task and an initial note in one transaction.

- [ ] **Step 5: Run PostgreSQL tests**

Run: `yarn vitest run apps/server/src/store/postgres.test.ts`

Expected: pass.

## Task 4: Dashboard UI

**Files:**
- Modify: `apps/dashboard/src/globalStore.ts`
- Modify: `apps/dashboard/src/pages/ProjectDetailPage.ts`
- Test: `apps/dashboard/src/project-detail-context.test.ts`

- [ ] **Step 1: Write source-level dashboard regression checks**

Check that `ProjectDetailPage.ts` contains repair task state, create/list API calls, and a `Create repair task` action.

- [ ] **Step 2: Run the focused dashboard test and verify it fails**

Run: `yarn vitest run apps/dashboard/src/project-detail-context.test.ts -t "repair task"`

Expected: fail because UI code is absent.

- [ ] **Step 3: Add frontend types**

Add `RepairTaskStatus`, `RepairTaskAgent`, and `RepairTask` to `globalStore.ts`.

- [ ] **Step 4: Add ProjectDetailPage state and methods**

Add:

- `repairTasks = ref<RepairTask[]>([])`
- `repairRepoUrl = ref('')`
- `repairBaseBranch = ref('main')`
- `repairAgent = ref<RepairTaskAgent>('hermes')`
- `loadRepairTasks()`
- `createRepairTask(issue)`
- `cancelRepairTask(task)`

- [ ] **Step 5: Render UI**

Add a compact create form in the selected issue detail and a task list panel near the issue list/detail area.

- [ ] **Step 6: Run dashboard test**

Run: `yarn vitest run apps/dashboard/src/project-detail-context.test.ts`

Expected: pass.

## Task 5: Full Verification

**Files:**
- All changed files

- [ ] **Step 1: Run all tests**

Run: `yarn test`

Expected: all tests pass.

- [ ] **Step 2: Run type check**

Run: `yarn type-check`

Expected: exit 0.

- [ ] **Step 3: Commit implementation**

Commit message:

```bash
git add apps/server/src apps/dashboard/src docs/superpowers/plans/2026-06-07-repair-tasks-phase-1.md
git commit -m "feat: add manual repair tasks"
```
