import { computed, h, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store, messages, loadApps } from '../globalStore';
import { apiUrl, formatTime, requestJson } from '../api';
import { extractPathname } from '@health-guard/core';
import type { IssueSummary, OverviewTotals, RepairTask, RepairTaskAgent } from '../globalStore';

const platforms = ['web', 'wechat-miniprogram', 'alipay-miniprogram', 'flutter', 'uniapp-h5', 'uniapp-wechat', 'uniapp-alipay', 'uniapp-douyin', 'uniapp-app', 'uniapp'];

interface IssueDetailResponse {
  issue: IssueSummary;
  events: Array<Record<string, unknown>>;
}

type IssueStatus = 'open' | 'archived';
type TimePreset = 'all' | '1d' | '7d' | '30d' | 'custom';

export default {
  setup() {
    const route = useRoute();
    const router = useRouter();
    const appKey = ref(String(route.params.appKey));

    const overview = ref<OverviewTotals>({ events: 0, errors: 0, failedRequests: 0, affectedUsers: 0, issues: 0 });
    const issues = ref<IssueSummary[]>([]);
    const selectedIssue = ref<IssueDetailResponse | null>(null);
    const selectedPlatform = ref('');
    const searchQuery = ref('');
    const selectedMetricFilter = ref<'all' | 'error' | 'http'>('all');
    const issueStatus = ref<IssueStatus>('open');
    const timePreset = ref<TimePreset>('all');
    const customStartDate = ref('');
    const customEndDate = ref('');
    const repairTasks = ref<RepairTask[]>([]);
    const repairRepoUrl = ref('');
    const repairBaseBranch = ref('main');
    const repairAgent = ref<RepairTaskAgent>('hermes');
    const fixedReleaseInput = ref('');
    const verifiedReleaseInput = ref('');

    const selectedApp = computed(() => store.apps.find((item) => item.appKey === appKey.value) ?? null);

    const sdkSnippet = computed(() => {
      const endpoint = apiUrl('/events/batch');
      if (selectedApp.value?.type === 'uni-app') {
        return `import { createUniAppClient } from '@health-guard/sdk-uniapp';\n\nconst client = createUniAppClient({\n  appKey: '${appKey.value}',\n  endpoint: '${endpoint}',\n  autoCapture: true\n});`;
      }
      if (selectedApp.value?.type === 'flutter') {
        return `flutter build apk --release \\\n  --dart-define=HEALTHGUARD_ENDPOINT=${endpoint} \\\n  --dart-define=HEALTHGUARD_APP_KEY=${appKey.value} \\\n  --dart-define=HEALTHGUARD_ENV=production`;
      }
      return `const client = createHealthGuardClient({\n  appKey: '${appKey.value}',\n  endpoint: '${endpoint}',\n  autoCapture: true\n});`;
    });

    watch(() => route.params.appKey, (newKey) => {
      appKey.value = String(newKey);
      selectedIssue.value = null;
      repairTasks.value = [];
      void loadProjectData();
    });

    watch([selectedPlatform, issueStatus, timePreset, customStartDate, customEndDate], () => {
      void loadProjectData();
      if (selectedIssue.value) {
        void openIssue(selectedIssue.value.issue);
      }
    });

    onMounted(() => {
      void loadApps().then(() => {
        if (!selectedApp.value) {
          void router.push('/projects');
          return;
        }
        void loadProjectData();
      });
    });

    async function loadProjectData(): Promise<void> {
      if (!store.token || !appKey.value) return;
      const query = buildIssueQuery();
      try {
        const [overviewResponse, issueResponse] = await Promise.all([
          requestJson<{ totals: OverviewTotals }>(apiUrl(`/overview?${query}`), undefined, store.token),
          requestJson<{ issues: IssueSummary[] }>(apiUrl(`/issues?${query}`), undefined, store.token)
        ]);
        overview.value = overviewResponse.totals;
        issues.value = issueResponse.issues;
        await loadRepairTasks();
        if (selectedIssue.value && !issues.value.some((issue) => issue.id === selectedIssue.value?.issue.id)) {
          selectedIssue.value = null;
        }
      } catch (error) {
        store.errorMessage = (error as Error).message;
      }
    }

    async function openIssue(issue: IssueSummary): Promise<void> {
      selectedIssue.value = await requestJson<IssueDetailResponse>(apiUrl(`/issues/${encodeURIComponent(issue.id)}?${buildIssueQuery(false)}`), undefined, store.token);
      fixedReleaseInput.value = selectedIssue.value.issue.fixedInRelease ?? selectedIssue.value.issue.lastSeenRelease ?? '';
      verifiedReleaseInput.value = selectedIssue.value.issue.verifiedInRelease ?? selectedIssue.value.issue.fixedInRelease ?? '';
    }

    async function archiveIssue(issue: IssueSummary): Promise<void> {
      if (!issue.verifiedInRelease) {
        store.errorMessage = 'verifiedInRelease is required before archiving.';
        return;
      }
      await requestJson<{ issue: IssueSummary }>(apiUrl(`/issues/${encodeURIComponent(issue.id)}/archive`), { method: 'PATCH', body: JSON.stringify({}) }, store.token);
      selectedIssue.value = null;
      await loadProjectData();
    }

    async function reopenIssue(issue: IssueSummary): Promise<void> {
      await requestJson<{ issue: IssueSummary }>(apiUrl(`/issues/${encodeURIComponent(issue.id)}/reopen`), { method: 'PATCH', body: JSON.stringify({}) }, store.token);
      issueStatus.value = 'open';
      selectedIssue.value = null;
      await loadProjectData();
    }

    async function markIssueFixed(issue: IssueSummary): Promise<void> {
      const fixedInRelease = fixedReleaseInput.value.trim();
      if (!fixedInRelease) {
        store.errorMessage = 'Fixed release is required.';
        return;
      }
      const response = await requestJson<{ issue: IssueSummary }>(
        apiUrl(`/issues/${encodeURIComponent(issue.id)}/fixed`),
        { method: 'PATCH', body: JSON.stringify({ fixedInRelease }) },
        store.token
      );
      selectedIssue.value = { ...(selectedIssue.value as IssueDetailResponse), issue: response.issue };
      verifiedReleaseInput.value = response.issue.verifiedInRelease ?? response.issue.fixedInRelease ?? verifiedReleaseInput.value;
      await loadProjectData();
    }

    async function markIssueVerified(issue: IssueSummary): Promise<void> {
      const verifiedInRelease = verifiedReleaseInput.value.trim();
      if (!verifiedInRelease) {
        store.errorMessage = 'Verified release is required.';
        return;
      }
      const response = await requestJson<{ issue: IssueSummary }>(
        apiUrl(`/issues/${encodeURIComponent(issue.id)}/verified`),
        { method: 'PATCH', body: JSON.stringify({ verifiedInRelease }) },
        store.token
      );
      selectedIssue.value = { ...(selectedIssue.value as IssueDetailResponse), issue: response.issue };
      await loadProjectData();
    }

    async function loadRepairTasks(): Promise<void> {
      if (!store.token || !appKey.value) return;
      const response = await requestJson<{ tasks: RepairTask[] }>(
        apiUrl(`/repair-tasks?appKey=${encodeURIComponent(appKey.value)}`),
        undefined,
        store.token
      );
      repairTasks.value = response.tasks;
    }

    async function createRepairTask(issue: IssueSummary): Promise<void> {
      if (!repairRepoUrl.value.trim()) {
        store.errorMessage = 'Repository URL is required.';
        return;
      }

      const response = await requestJson<{ task: RepairTask }>(
        apiUrl('/repair-tasks'),
        {
          method: 'POST',
          body: JSON.stringify({
            issueId: issue.id,
            agent: repairAgent.value,
            repoUrl: repairRepoUrl.value.trim(),
            baseBranch: repairBaseBranch.value.trim() || 'main'
          })
        },
        store.token
      );
      repairTasks.value = [response.task, ...repairTasks.value.filter((task) => task.id !== response.task.id)];
    }

    async function cancelRepairTask(task: RepairTask): Promise<void> {
      const response = await requestJson<{ task: RepairTask }>(
        apiUrl(`/repair-tasks/${encodeURIComponent(task.id)}/cancel`),
        { method: 'POST', body: JSON.stringify({}) },
        store.token
      );
      repairTasks.value = repairTasks.value.map((item) => (item.id === response.task.id ? response.task : item));
    }

    function buildIssueQuery(includeAppKey = true): string {
      const params: string[] = [];
      if (includeAppKey) params.push(`appKey=${encodeURIComponent(appKey.value)}`);
      if (selectedPlatform.value) params.push(`platform=${encodeURIComponent(selectedPlatform.value)}`);
      params.push(`status=${encodeURIComponent(issueStatus.value)}`);
      const range = getSelectedTimeRange();
      if (range.start !== undefined) params.push(`start=${encodeURIComponent(String(range.start))}`);
      if (range.end !== undefined) params.push(`end=${encodeURIComponent(String(range.end))}`);
      return params.join('&');
    }

    function getSelectedTimeRange(): { start?: number; end?: number } {
      const now = Date.now();
      if (timePreset.value === '1d') return { start: now - 24 * 60 * 60 * 1000, end: now };
      if (timePreset.value === '7d') return { start: now - 7 * 24 * 60 * 60 * 1000, end: now };
      if (timePreset.value === '30d') return { start: now - 30 * 24 * 60 * 60 * 1000, end: now };
      if (timePreset.value !== 'custom') return {};

      return {
        start: customStartDate.value ? new Date(`${customStartDate.value}T00:00:00`).getTime() : undefined,
        end: customEndDate.value ? new Date(`${customEndDate.value}T23:59:59.999`).getTime() : undefined
      };
    }

    function metricCard(label: string, value: number, filterType?: 'error' | 'http') {
      const isActive = filterType ? selectedMetricFilter.value === filterType : false;
      return h('article', {
        class: isActive ? 'metric active' : 'metric',
        onClick: filterType
          ? () => {
              selectedMetricFilter.value = filterType;
            }
          : undefined
      }, [h('span', label), h('strong', value.toLocaleString())]);
    }

    function groupEventsByType(events: Array<Record<string, unknown>>) {
      const groups: Record<string, Array<Record<string, unknown>>> = {};
      for (const evt of events) {
        const type = String(evt.type ?? 'unknown');
        groups[type] = groups[type] ?? [];
        groups[type].push(evt);
      }
      return groups;
    }

    function renderErrorEvent(evt: Record<string, unknown>) {
      const parsed = parseErrorPayload(evt);
      const context = getEventContext(evt);

      return h('div', { class: 'event-card error-card' }, [
        h('div', { class: 'event-header' }, [
          h('span', { class: 'event-badge error' }, 'ERROR'),
          h('strong', parsed.title)
        ]),
        parsed.url ? h('p', { class: 'event-url' }, `${String(parsed.method ?? 'GET')} ${String(parsed.url)}`) : null,
        h('div', { class: 'event-meta-row' }, [
          parsed.statusCode ? h('span', `Status: ${String(parsed.statusCode)}`) : null,
          parsed.errorCode ? h('span', `Code: ${String(parsed.errorCode)}`) : null,
          evt.errorType ? h('span', `Type: ${String(evt.errorType)}`) : null
        ]),
        h('div', { class: 'event-context-row' }, [
          getEventPage(evt, context) ? h('span', { class: 'context-tag' }, `Page: ${String(getEventPage(evt, context))}`) : null,
          getEventScene(evt, context) ? h('span', { class: 'context-tag' }, `Scene: ${String(getEventScene(evt, context))}`) : null,
          evt.platform ? h('span', { class: 'context-tag' }, `Platform: ${String(evt.platform)}`) : null
        ]),
        evt.filename ? h('p', { class: 'event-meta' }, `${String(evt.filename)}:${String(evt.lineno ?? '-')}:${String(evt.colno ?? '-')}`) : null,
        evt.stack ? h('pre', { class: 'event-stack' }, String(evt.stack)) : null,
        renderRequestData(getEventRequestData(evt, context)),
        renderBreadcrumbs(evt.breadcrumbs as Array<Record<string, unknown>> | undefined),
        renderOriginalJson(evt)
      ]);
    }

    function parseErrorPayload(evt: Record<string, unknown>) {
      let title = String(evt.message ?? '-');
      let url: string | undefined;
      let method: string | undefined;
      let statusCode: unknown;
      let errorCode: unknown;
      const context = getEventContext(evt);

      // If message is a JSON string, try to extract structured fields
      if (typeof evt.message === 'string' && evt.message.startsWith('{')) {
        try {
          const obj = JSON.parse(evt.message) as Record<string, unknown>;
          if (obj.errorMessage) title = String(obj.errorMessage);
          else if (obj.message) title = String(obj.message);
          if (obj.url) url = String(obj.url);
          if (obj.method) method = String(obj.method);
          if (obj.statusCode !== undefined) statusCode = obj.statusCode;
          else if (obj.status !== undefined) statusCode = obj.status;
          if (obj.error !== undefined) errorCode = obj.error;
          else if (obj.code !== undefined) errorCode = obj.code;
        } catch {
          // ignore parse error
        }
      }

      // Top-level fields take priority over parsed message JSON
      if (evt.errorMessage && typeof evt.errorMessage === 'string') title = evt.errorMessage;
      if (context.errorMessage && typeof context.errorMessage === 'string') title = context.errorMessage;
      if (context.url && typeof context.url === 'string') url = context.url;
      if (evt.url && typeof evt.url === 'string') url = evt.url;
      if (context.method && typeof context.method === 'string') method = context.method;
      if (evt.method && typeof evt.method === 'string') method = evt.method;
      if (context.statusCode !== undefined) statusCode = context.statusCode;
      if (context.status !== undefined) statusCode = context.status;
      if (evt.statusCode !== undefined) statusCode = evt.statusCode;
      if (evt.error !== undefined) errorCode = evt.error;
      if (context.error !== undefined) errorCode = context.error;
      if (context.code !== undefined) errorCode = context.code;

      return {
        title,
        url,
        method,
        statusCode: statusCode !== null ? statusCode : undefined,
        errorCode: errorCode !== null ? errorCode : undefined
      };
    }

    function renderHttpEvent(evt: Record<string, unknown>) {
      const pathname = extractPathname(String(evt.url ?? '-'));
      const context = getEventContext(evt);

      return h('div', { class: 'event-card http-card' }, [
        h('div', { class: 'event-header' }, [
          h('span', { class: 'event-badge http' }, `${String(evt.method ?? 'GET')}`),
          h('strong', pathname),
          h('span', { class: 'event-status' }, `Status ${String(evt.status ?? '-')}`)
        ]),
        h('p', { class: 'event-url' }, String(evt.url ?? '-')),
        h('div', { class: 'event-context-row' }, [
          getEventPage(evt, context) ? h('span', { class: 'context-tag' }, `Page: ${String(getEventPage(evt, context))}`) : null,
          getEventScene(evt, context) ? h('span', { class: 'context-tag' }, `Scene: ${String(getEventScene(evt, context))}`) : null,
          evt.platform ? h('span', { class: 'context-tag' }, `Platform: ${String(evt.platform)}`) : null
        ]),
        h('div', { class: 'event-meta-row' }, [
          h('span', `Duration: ${String(evt.duration ?? '-')}ms`),
          evt.errorMessage ? h('span', { class: 'event-error-msg' }, String(evt.errorMessage)) : null
        ]),
        renderRequestData(getEventRequestData(evt, context)),
        renderBreadcrumbs(evt.breadcrumbs as Array<Record<string, unknown>> | undefined),
        renderOriginalJson(evt)
      ]);
    }

    function getEventContext(evt: Record<string, unknown>): Record<string, unknown> {
      const context = evt.context;
      if (!context || typeof context !== 'object' || Array.isArray(context)) return {};
      return context as Record<string, unknown>;
    }

    function getEventPage(evt: Record<string, unknown>, context: Record<string, unknown>): unknown {
      return evt.page ?? context.page;
    }

    function getEventScene(evt: Record<string, unknown>, context: Record<string, unknown>): unknown {
      return evt.scene ?? context.scene;
    }

    function getEventRequestData(evt: Record<string, unknown>, context: Record<string, unknown>): Record<string, unknown> | undefined {
      const requestData = evt.requestData ?? context.requestData;
      if (!requestData || typeof requestData !== 'object' || Array.isArray(requestData)) return undefined;
      return requestData as Record<string, unknown>;
    }

    function renderRequestData(data: Record<string, unknown> | undefined) {
      if (!data || Object.keys(data).length === 0) return null;
      return h('div', { class: 'event-request-data' }, [
        h('span', { class: 'event-request-data-label' }, 'Request Data:'),
        h('pre', { class: 'event-request-data-content' }, JSON.stringify(data, null, 2))
      ]);
    }

    function renderBreadcrumbs(breadcrumbs: Array<Record<string, unknown>> | undefined) {
      if (!breadcrumbs || breadcrumbs.length === 0) return null;
      const recent = breadcrumbs.slice(-10);
      return h('div', { class: 'event-breadcrumbs' }, [
        h('span', { class: 'event-breadcrumbs-label' }, 'Breadcrumbs:'),
        h('ul', { class: 'event-breadcrumbs-list' },
          recent.map((bc) =>
            h('li', { class: 'breadcrumb-item' }, [
              h('span', { class: 'breadcrumb-type' }, String(bc.type ?? '-')),
              h('span', { class: 'breadcrumb-message' }, String(bc.message ?? '-'))
            ])
          )
        )
      ]);
    }

    function renderOriginalJson(evt: Record<string, unknown>) {
      return h('pre', { class: 'event-raw' }, JSON.stringify(evt, null, 2));
    }

    function renderEventGroup(type: string, events: Array<Record<string, unknown>>) {
      const SAMPLE = 3;
      const samples = events.slice(0, SAMPLE);
      const remainder = events.length - SAMPLE;

      const renderers: Record<string, (e: Record<string, unknown>) => ReturnType<typeof h>> = {
        error: renderErrorEvent,
        http: renderHttpEvent
      };

      return h('div', { class: 'event-group' }, [
        h('h4', { class: 'event-group-title' }, [`${type.toUpperCase()} (${events.length})`]),
        ...samples.map((evt) => (renderers[type] ?? renderRawEvent)(evt)),
        remainder > 0 ? h('p', { class: 'event-more' }, `+ ${remainder} more events`) : null
      ]);
    }

    function renderRawEvent(evt: Record<string, unknown>) {
      return h('pre', { class: 'event-raw' }, JSON.stringify(evt, null, 2));
    }

    function renderRepairTaskList() {
      return h('div', { class: 'repair-task-panel' }, [
        h('div', { class: 'panel-head' }, [h('h2', 'Repair Tasks'), h('span', `${repairTasks.value.length}`)]),
        repairTasks.value.length === 0
          ? h('p', { class: 'empty' }, 'No repair tasks yet.')
          : h(
              'div',
              { class: 'repair-task-list' },
              repairTasks.value.map((task) =>
                h('article', { class: 'repair-task-row' }, [
                  h('div', { class: 'repair-task-main' }, [
                    h('strong', task.issueId),
                    h('span', `${task.agent} / ${task.baseBranch}`),
                    task.summary ? h('p', { class: 'repair-task-summary' }, task.summary) : null,
                    task.failureReason ? h('p', { class: 'repair-task-failure' }, task.failureReason) : null,
                    h('small', formatTime(task.updatedAt))
                  ]),
                  h('span', { class: `repair-status repair-status-${task.status}` }, task.status),
                  task.prUrl ? h('a', { href: task.prUrl, target: '_blank', rel: 'noreferrer' }, 'PR') : null,
                  ['pending', 'claimed', 'running'].includes(task.status)
                    ? h('button', { type: 'button', class: 'outline-button detail-action-button', onClick: () => void cancelRepairTask(task) }, 'Cancel')
                    : null
                ])
              )
            )
      ]);
    }

    function renderRepairTaskCreator(issue: IssueSummary) {
      return h('section', { class: 'repair-task-create' }, [
        h('h4', 'Create repair task'),
        h('div', { class: 'repair-task-form' }, [
          h('label', { class: 'field' }, [
            h('span', 'Agent'),
            h('select', {
              value: repairAgent.value,
              onChange: (event: Event) => {
                repairAgent.value = (event.target as HTMLSelectElement).value as RepairTaskAgent;
              }
            }, [
              h('option', { value: 'hermes' }, 'Hermes'),
              h('option', { value: 'codex' }, 'Codex'),
              h('option', { value: 'claude-code' }, 'Claude Code'),
              h('option', { value: 'manual' }, 'Manual')
            ])
          ]),
          h('label', { class: 'field' }, [
            h('span', 'Repository URL'),
            h('input', {
              type: 'text',
              placeholder: 'git@github.com:owner/repo.git',
              value: repairRepoUrl.value,
              onInput: (event: Event) => {
                repairRepoUrl.value = (event.target as HTMLInputElement).value;
              }
            })
          ]),
          h('label', { class: 'field compact-field' }, [
            h('span', 'Base branch'),
            h('input', {
              type: 'text',
              value: repairBaseBranch.value,
              onInput: (event: Event) => {
                repairBaseBranch.value = (event.target as HTMLInputElement).value;
              }
            })
          ]),
          h('button', { type: 'button', class: 'copy-for-ai-button', onClick: () => void createRepairTask(issue) }, 'Create repair task')
        ])
      ]);
    }

    function renderIssueReleaseWorkflow(issue: IssueSummary) {
      return h('section', { class: 'issue-release-workflow' }, [
        h('h4', 'Issue status'),
        h('div', { class: 'release-status-grid' }, [
          renderReleaseItem('Status', issue.status),
          renderReleaseItem('First seen release', issue.firstSeenRelease ?? '-'),
          renderReleaseItem('Last seen release', issue.lastSeenRelease ?? '-'),
          renderReleaseItem('Fixed in release', issue.fixedInRelease ?? '-'),
          renderReleaseItem('Verified in release', issue.verifiedInRelease ?? '-')
        ]),
        issue.status === 'fixed_pending_release' && issue.fixedInRelease
          ? h('p', { class: 'release-note' }, `Fixed, waiting for release ${issue.fixedInRelease} to be published and verified.`)
          : null,
        issue.fixedInRelease && issue.lastSeenRelease && compareRelease(issue.lastSeenRelease, issue.fixedInRelease) < 0
          ? h('p', { class: 'release-note muted' }, 'Old releases are still reporting. This does not mean the new release failed verification.')
          : null,
        h('div', { class: 'release-action-row' }, [
          h('label', { class: 'field compact-field' }, [
            h('span', 'Fixed release'),
            h('input', {
              type: 'text',
              placeholder: '1.1.12',
              value: fixedReleaseInput.value,
              onInput: (event: Event) => {
                fixedReleaseInput.value = (event.target as HTMLInputElement).value;
              }
            })
          ]),
          h('button', { type: 'button', class: 'outline-button detail-action-button', onClick: () => void markIssueFixed(issue) }, 'Mark fixed')
        ]),
        h('div', { class: 'release-action-row' }, [
          h('label', { class: 'field compact-field' }, [
            h('span', 'Verified release'),
            h('input', {
              type: 'text',
              placeholder: issue.fixedInRelease ?? '1.1.12',
              value: verifiedReleaseInput.value,
              onInput: (event: Event) => {
                verifiedReleaseInput.value = (event.target as HTMLInputElement).value;
              }
            })
          ]),
          h('button', { type: 'button', class: 'copy-for-ai-button', onClick: () => void markIssueVerified(issue) }, 'Test passed')
        ])
      ]);
    }

    function renderReleaseItem(label: string, value: string) {
      return h('div', { class: 'release-status-item' }, [
        h('span', label),
        h('strong', value)
      ]);
    }

    function getSeverityClass(count: number) {
      if (count > 20) return 'severity-critical';
      if (count > 5) return 'severity-warning';
      return 'severity-normal';
    }

    function compareRelease(left: string, right: string): number {
      const leftParts = parseRelease(left);
      const rightParts = parseRelease(right);
      const max = Math.max(leftParts.length, rightParts.length);
      for (let index = 0; index < max; index++) {
        const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
        if (diff !== 0) return diff;
      }
      return left.localeCompare(right);
    }

    function parseRelease(value: string): number[] {
      return value
        .replace(/^[^\d]*/, '')
        .split(/[.-]/)
        .map((part) => Number(part))
        .filter((part) => Number.isFinite(part));
    }

    function buildCopyForAI(issue: IssueSummary, events: Array<Record<string, unknown>>): string {
      const lines: string[] = [];
      lines.push('## 错误报告');
      lines.push('');
      lines.push(`**Issue ID:** ${issue.id}`);
      lines.push(`**错误类型:** ${issue.errorType}`);
      lines.push(`**错误信息:** ${issue.message}`);
      lines.push(`**出现次数:** ${issue.eventCount}`);
      lines.push(`**首次出现:** ${formatTime(issue.firstSeenAt)}`);
      lines.push(`**最近出现:** ${formatTime(issue.lastSeenAt)}`);
      lines.push(`**平台分布:** ${Object.entries(issue.platformDistribution).map(([p, c]) => `${p}(${c})`).join(', ')}`);
      lines.push('');
      lines.push('## 错误事件详情');
      lines.push('');

      const sampleEvents = events.slice(0, 3);
      for (let i = 0; i < sampleEvents.length; i++) {
        const evt = sampleEvents[i];
        const context = getEventContext(evt);
        const requestData = getEventRequestData(evt, context);
        const method = String(evt.method ?? context.method ?? 'GET');
        const url = evt.url ?? context.url;
        const status = evt.status ?? evt.statusCode ?? context.statusCode ?? context.status;
        const page = getEventPage(evt, context);
        const scene = getEventScene(evt, context);
        lines.push(`### 事件 ${i + 1}`);
        lines.push(`- **平台:** ${String(evt.platform ?? '-')}`);
        lines.push(`- **时间:** ${formatTime(Number(evt.timestamp ?? 0))}`);

        if (evt.type === 'http' || url) {
          lines.push(`- **接口:** ${method} ${String(url ?? '-')}`);
          lines.push(`- **状态码:** ${String(status ?? '-')}`);
          lines.push(`- **耗时:** ${String(evt.duration ?? '-')}ms`);
        }

        if (page) lines.push(`- **页面:** ${String(page)}`);
        if (scene) lines.push(`- **场景:** ${String(scene)}`);
        if (evt.errorMessage ?? context.errorMessage) lines.push(`- **错误信息:** ${String(evt.errorMessage ?? context.errorMessage)}`);
        if (evt.errorCode !== undefined || context.error !== undefined || context.code !== undefined) lines.push(`- **错误码:** ${String(evt.errorCode ?? context.error ?? context.code)}`);

        if (evt.stack) {
          lines.push('');
          lines.push('**调用栈:**');
          lines.push('```');
          lines.push(String(evt.stack));
          lines.push('```');
        }

        if (requestData && Object.keys(requestData).length > 0) {
          lines.push('');
          lines.push('**请求参数:**');
          lines.push('```json');
          lines.push(JSON.stringify(requestData, null, 2));
          lines.push('```');
        }

        if (evt.breadcrumbs && Array.isArray(evt.breadcrumbs) && evt.breadcrumbs.length > 0) {
          lines.push('');
          lines.push('**操作轨迹:**');
          const recent = evt.breadcrumbs.slice(-10);
          for (const bc of recent) {
            const bcObj = bc as Record<string, unknown>;
            lines.push(`- [${String(bcObj.type ?? '-')}] ${String(bcObj.message ?? '-')}`);
          }
        }

        lines.push('');
      }

      lines.push('## 请帮我分析');
      lines.push('');
      lines.push('1. 这个错误的根本原因是什么？');
      lines.push('2. 如何修复这个问题？');
      lines.push('3. 有什么预防措施可以避免类似问题？');

      return lines.join('\n');
    }

    async function copyToClipboard(text: string): Promise<void> {
      try {
        await navigator.clipboard.writeText(text);
        alert('已复制到剪贴板，可直接粘贴给 AI');
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        alert('已复制到剪贴板，可直接粘贴给 AI');
      }
    }

    return () => {
      const t = messages.value;

      if (!selectedApp.value) {
        return h('div', { class: 'content' }, [h('p', { class: 'empty' }, 'Loading...')]);
      }

      return h('main', { class: 'layout' }, [
        h('aside', { class: 'sidebar detail-sidebar' }, [
          h('div', { class: 'brand' }, [h('strong', 'HealthGuard'), h('span', store.user?.email ?? '')]),
          h('div', { class: 'panel-title' }, t.projectList),
          h(
            'div',
            { class: 'app-list' },
            store.apps.map((item) =>
              h(
                'button',
                {
                  type: 'button',
                  class: item.appKey === appKey.value ? 'app-row active' : 'app-row',
                  onClick: () => router.push(`/projects/${item.appKey}`)
                },
                [h('span', item.name), h('small', item.type), h('small', item.appKey)]
              )
            )
          ),
          h('section', { class: 'sdk-sidebar' }, [
            h('div', { class: 'panel-title' }, t.sdkIntegration),
            h('small', appKey.value),
            h('pre', sdkSnippet.value)
          ]),
          h('div', { class: 'sidebar-version' }, [])
        ]),

        h('section', { class: 'content detail-content' }, [
          h('header', { class: 'topbar' }, [
            h('div', [h('h1', selectedApp.value.name), h('p', t.inspectSubtitle)]),
            h('div', { class: 'topbar-actions' }, [
              h('span', { class: 'version-badge' }, `v${__APP_VERSION__}`),
              h('button', { type: 'button', class: 'outline-button', onClick: () => { void loadProjectData(); }, disabled: store.loading }, t.refresh),
              h('button', { type: 'button', class: 'outline-button', onClick: () => router.push('/projects') }, t.projectList)
            ]),
            store.errorMessage ? h('p', { class: 'error' }, store.errorMessage) : null
          ]),

          h('section', { class: 'project-filters' }, [
            h('div', { class: 'segmented-control', role: 'tablist', 'aria-label': t.issues }, [
              h('button', {
                type: 'button',
                class: issueStatus.value === 'open' ? 'segment active' : 'segment',
                onClick: () => {
                  issueStatus.value = 'open';
                }
              }, t.currentIssues),
              h('button', {
                type: 'button',
                class: issueStatus.value === 'archived' ? 'segment active' : 'segment',
                onClick: () => {
                  issueStatus.value = 'archived';
                }
              }, t.archivedIssues)
            ]),
            h('label', { class: 'field' }, [
              h('span', t.platform),
              h(
                'select',
                {
                  value: selectedPlatform.value,
                  onChange: (event: Event) => {
                    selectedPlatform.value = (event.target as HTMLSelectElement).value;
                  }
                },
                [h('option', { value: '' }, t.allPlatforms), ...platforms.map((p) => h('option', { value: p }, p))]
              )
            ]),
            h('label', { class: 'field' }, [
              h('span', t.timeRange),
              h(
                'select',
                {
                  value: timePreset.value,
                  onChange: (event: Event) => {
                    timePreset.value = (event.target as HTMLSelectElement).value as TimePreset;
                  }
                },
                [
                  h('option', { value: 'all' }, t.allTime),
                  h('option', { value: '1d' }, t.lastDay),
                  h('option', { value: '7d' }, t.lastWeek),
                  h('option', { value: '30d' }, t.lastMonth),
                  h('option', { value: 'custom' }, t.customRange)
                ]
              )
            ]),
            timePreset.value === 'custom'
              ? h('div', { class: 'custom-date-range' }, [
                  h('label', { class: 'field compact-field' }, [
                    h('span', t.startDate),
                    h('input', {
                      type: 'date',
                      value: customStartDate.value,
                      onInput: (event: Event) => {
                        customStartDate.value = (event.target as HTMLInputElement).value;
                      }
                    })
                  ]),
                  h('label', { class: 'field compact-field' }, [
                    h('span', t.endDate),
                    h('input', {
                      type: 'date',
                      value: customEndDate.value,
                      onInput: (event: Event) => {
                        customEndDate.value = (event.target as HTMLInputElement).value;
                      }
                    })
                  ])
                ])
              : null
          ]),

          h('section', { class: 'metrics' }, [
            metricCard(t.events, overview.value.events),
            metricCard(t.errors, overview.value.errors, 'error'),
            metricCard(t.failedRequests, overview.value.failedRequests, 'http'),
            metricCard(t.affectedUsers, overview.value.affectedUsers),
            metricCard(t.issues, overview.value.issues)
          ]),

          h('section', { class: 'grid' }, [
            h('div', { class: 'panel' }, [
              (() => {
                const filteredIssues = issues.value.filter((issue) => {
                  if (!issue.message.toLowerCase().includes(searchQuery.value.toLowerCase())) return false;
                  if (selectedMetricFilter.value === 'error') return issue.errorType === 'error' || issue.errorType === 'js' || issue.errorType === 'promise' || issue.errorType === 'resource';
                  if (selectedMetricFilter.value === 'http') return issue.errorType === 'http' || issue.errorType === 'request';
                  return true;
                });
                return [
                  h('div', { class: 'panel-head' }, [h('h2', issueStatus.value === 'archived' ? t.issueHistory : t.issues), h('span', `${filteredIssues.length} ${t.groups}`)]),
                  h('div', { class: 'issue-search' }, [
                    h('input', {
                      type: 'text',
                      placeholder: 'Search issues...',
                      value: searchQuery.value,
                      onInput: (event: Event) => {
                        searchQuery.value = (event.target as HTMLInputElement).value;
                      }
                    })
                  ]),
                  filteredIssues.length === 0
                    ? h('p', { class: 'empty' }, searchQuery.value || selectedMetricFilter.value !== 'all' ? t.noMatchingIssues : t.emptyIssues)
                    : h(
                        'div',
                        { class: 'issue-list' },
                        filteredIssues.map((issue) =>
                          h(
                            'button',
                            {
                              type: 'button',
                              class: selectedIssue.value?.issue.id === issue.id ? `issue-row active ${getSeverityClass(issue.eventCount)}` : `issue-row ${getSeverityClass(issue.eventCount)}`,
                              onClick: () => void openIssue(issue)
                            },
                            [
                              h('strong', issue.message),
                              h('span', `${issue.errorType} / ${issue.eventCount} ${t.events}`),
                              h('div', { class: 'issue-release-meta' }, [
                                h('span', `Status: ${issue.status}`),
                                h('span', `First: ${issue.firstSeenRelease ?? '-'}`),
                                h('span', `Last: ${issue.lastSeenRelease ?? '-'}`),
                                h('span', `Fixed: ${issue.fixedInRelease ?? '-'}`),
                                h('span', `Verified: ${issue.verifiedInRelease ?? '-'}`)
                              ]),
                              issue.archived && issue.archivedAt ? h('span', { class: 'issue-archived-at' }, `${t.archivedAt} ${formatTime(issue.archivedAt)}`) : null,
                              Object.keys(issue.platformDistribution).length > 0
                                ? h(
                                    'div',
                                    { class: 'platform-tags' },
                                    Object.entries(issue.platformDistribution).map(([platform, count]) =>
                                      h('span', { class: 'platform-tag', title: `${count} events` }, `${platform}: ${count}`)
                                    )
                                  )
                                : null,
                              h('p', { class: 'issue-last-seen' }, formatTime(issue.lastSeenAt)),
                              h('small', issue.fingerprint)
                            ]
                          )
                        )
                      )
                ];
              })()
            ]),
            h('div', { class: 'panel' }, [
              renderRepairTaskList()
            ]),
            h('div', { class: 'panel detail' }, [
              h('div', { class: 'panel-head' }, [
                h('h2', t.issueDetail),
                selectedIssue.value ? h('span', { class: 'issue-id', title: selectedIssue.value.issue.id }, selectedIssue.value.issue.id.slice(0, 12) + '...') : null
              ]),
              selectedIssue.value
                ? (() => {
                    const issue = selectedIssue.value.issue;
                    return h('div', { class: 'detail-body' }, [
                      h('h3', issue.message),
                      h('div', { class: 'detail-info-bar' }, [
                        h('span', { class: issue.errorType === 'http' || issue.errorType === 'request' ? 'badge-http' : 'badge-error' }, issue.errorType.toUpperCase()),
                        issue.archived ? h('span', { class: 'badge-archived' }, t.archivedIssues) : null,
                        h('span', { class: 'badge-archived' }, issue.status),
                        h('span', `${t.firstSeen} ${formatTime(issue.firstSeenAt)}`),
                        h('span', `${t.lastSeen} ${formatTime(issue.lastSeenAt)}`),
                        h('span', `First release ${issue.firstSeenRelease ?? '-'}`),
                        h('span', `Last release ${issue.lastSeenRelease ?? '-'}`),
                        h('span', `Fixed ${issue.fixedInRelease ?? '-'}`),
                        h('span', `Verified ${issue.verifiedInRelease ?? '-'}`),
                        issue.archived && issue.archivedAt ? h('span', `${t.archivedAt} ${formatTime(issue.archivedAt)}`) : null,
                        h('span', { class: 'detail-fingerprint' }, issue.fingerprint),
                        Object.keys(issue.platformDistribution).length > 0
                          ? h(
                              'div',
                              { class: 'platform-tags' },
                              Object.entries(issue.platformDistribution).map(([platform, count]) =>
                                h('span', { class: 'platform-tag', title: `${count} events` }, `${platform}: ${count}`)
                              )
                            )
                          : null
                      ]),
                      h('p', `${issue.eventCount} ${t.events} since ${formatTime(issue.firstSeenAt)}`),
                      h('div', { class: 'detail-actions' }, [
                        h('button', {
                          type: 'button',
                          class: 'copy-for-ai-button',
                          onClick: () => {
                            const text = buildCopyForAI(issue, selectedIssue.value?.events ?? []);
                            void copyToClipboard(text);
                          }
                        }, '复制给 AI'),
                        issue.archived
                          ? h('button', {
                              type: 'button',
                              class: 'outline-button detail-action-button',
                              onClick: () => {
                                void reopenIssue(issue);
                              }
                            }, t.reopenIssue)
                          : h('button', {
                              type: 'button',
                              class: 'outline-button detail-action-button danger-action',
                              disabled: !issue.verifiedInRelease,
                              title: issue.verifiedInRelease ? t.archiveIssue : 'verifiedInRelease is required before archiving',
                              onClick: () => {
                                void archiveIssue(issue);
                              }
                            }, t.archiveIssue)
                      ]),
                      renderIssueReleaseWorkflow(issue),
                      renderRepairTaskCreator(issue),
                      ...Object.entries(groupEventsByType(selectedIssue.value.events)).map(([type, events]) => renderEventGroup(type, events))
                    ]);
                  })()
                : h('p', { class: 'empty' }, t.noIssueSelected)
            ])
          ])
        ])
      ]);
    };
  }
};
