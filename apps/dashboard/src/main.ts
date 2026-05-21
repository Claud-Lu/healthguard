import { computed, createApp, h, onMounted, ref } from 'vue';
import './style.css';

interface AppRecord {
  id: string;
  name: string;
  appKey: string;
  createdAt: number;
}

interface OverviewResponse {
  totals: {
    events: number;
    errors: number;
    failedRequests: number;
    affectedUsers: number;
    issues: number;
  };
}

interface IssueSummary {
  id: string;
  appKey: string;
  fingerprint: string;
  message: string;
  errorType: string;
  eventCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

interface IssueDetailResponse {
  issue: IssueSummary;
  events: Array<Record<string, unknown>>;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'content-type': 'application/json'
    },
    ...init
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

const apiBase = (import.meta.env.VITE_HEALTHGUARD_API_BASE || '/api').replace(/\/$/, '');
const defaultAppKey = import.meta.env.VITE_HEALTHGUARD_DEFAULT_APP_KEY || 'demo-web';

function apiUrl(path: string): string {
  return `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
}

const App = {
  setup() {
    const apps = ref<AppRecord[]>([]);
    const selectedAppKey = ref(defaultAppKey);
    const overview = ref<OverviewResponse['totals']>({
      events: 0,
      errors: 0,
      failedRequests: 0,
      affectedUsers: 0,
      issues: 0
    });
    const issues = ref<IssueSummary[]>([]);
    const selectedIssue = ref<IssueDetailResponse | null>(null);
    const appName = ref('Demo Web');
    const errorMessage = ref('');
    const loading = ref(false);

    const sdkSnippet = computed(
      () => `const client = createHealthGuardClient({
  appKey: '${selectedAppKey.value}',
  endpoint: '${apiUrl('/events/batch')}',
  autoCapture: true
});`
    );

    async function refresh(): Promise<void> {
      loading.value = true;
      errorMessage.value = '';

      try {
        const query = encodeURIComponent(selectedAppKey.value);
        const [appResponse, overviewResponse, issueResponse] = await Promise.all([
          requestJson<{ apps: AppRecord[] }>(apiUrl('/apps')),
          requestJson<OverviewResponse>(apiUrl(`/overview?appKey=${query}`)),
          requestJson<{ issues: IssueSummary[] }>(apiUrl(`/issues?appKey=${query}`))
        ]);

        apps.value = appResponse.apps;
        overview.value = overviewResponse.totals;
        issues.value = issueResponse.issues;

        if (selectedIssue.value && !issues.value.some((issue) => issue.id === selectedIssue.value?.issue.id)) {
          selectedIssue.value = null;
        }
      } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : 'Failed to load dashboard data';
      } finally {
        loading.value = false;
      }
    }

    async function createAppRecord(): Promise<void> {
      const name = appName.value.trim();
      if (!name) {
        return;
      }

      const response = await requestJson<{ app: AppRecord }>(apiUrl('/apps'), {
        method: 'POST',
        body: JSON.stringify({ name })
      });

      selectedAppKey.value = response.app.appKey;
      appName.value = '';
      await refresh();
    }

    async function openIssue(issue: IssueSummary): Promise<void> {
      selectedIssue.value = await requestJson<IssueDetailResponse>(apiUrl(`/issues/${encodeURIComponent(issue.id)}`));
    }

    onMounted(() => {
      void refresh();
    });

    return () =>
      h('main', { class: 'layout' }, [
        h('aside', { class: 'sidebar' }, [
          h('div', { class: 'brand' }, [h('strong', 'HealthGuard'), h('span', 'MVP Dashboard')]),
          h('label', { class: 'field' }, [
            h('span', 'Current App Key'),
            h('input', {
              value: selectedAppKey.value,
              onInput: (event: Event) => {
                selectedAppKey.value = (event.target as HTMLInputElement).value;
              }
            })
          ]),
          h('button', { type: 'button', class: 'wide', onClick: refresh, disabled: loading.value }, 'Refresh'),
          h('div', { class: 'create-box' }, [
            h('label', { class: 'field' }, [
              h('span', 'Create App'),
              h('input', {
                value: appName.value,
                placeholder: 'App name',
                onInput: (event: Event) => {
                  appName.value = (event.target as HTMLInputElement).value;
                }
              })
            ]),
            h('button', { type: 'button', class: 'wide secondary', onClick: createAppRecord }, 'Create')
          ]),
          h(
            'div',
            { class: 'app-list' },
            apps.value.map((item) =>
              h(
                'button',
                {
                  type: 'button',
                  class: item.appKey === selectedAppKey.value ? 'app-row active' : 'app-row',
                  onClick: () => {
                    selectedAppKey.value = item.appKey;
                    void refresh();
                  }
                },
                [h('span', item.name), h('small', item.appKey)]
              )
            )
          )
        ]),
        h('section', { class: 'content' }, [
          h('header', { class: 'topbar' }, [
            h('div', [h('h1', 'Application Health'), h('p', 'Inspect captured errors, failed requests, and SDK setup for the selected app.')]),
            errorMessage.value ? h('p', { class: 'error' }, errorMessage.value) : null
          ]),
          h('section', { class: 'metrics' }, [
            metricCard('Events', overview.value.events),
            metricCard('Errors', overview.value.errors),
            metricCard('Failed Requests', overview.value.failedRequests),
            metricCard('Affected Users', overview.value.affectedUsers),
            metricCard('Issues', overview.value.issues)
          ]),
          h('section', { class: 'grid' }, [
            h('div', { class: 'panel' }, [
              h('div', { class: 'panel-head' }, [h('h2', 'Issues'), h('span', `${issues.value.length} groups`)]),
              issues.value.length === 0
                ? h('p', { class: 'empty' }, 'No issues yet. Trigger an error from the Vue demo, then refresh.')
                : h(
                    'div',
                    { class: 'issue-list' },
                    issues.value.map((issue) =>
                      h(
                        'button',
                        {
                          type: 'button',
                          class: selectedIssue.value?.issue.id === issue.id ? 'issue-row active' : 'issue-row',
                          onClick: () => void openIssue(issue)
                        },
                        [
                          h('strong', issue.message),
                          h('span', `${issue.errorType} / ${issue.eventCount} events`),
                          h('small', issue.fingerprint)
                        ]
                      )
                    )
                  )
            ]),
            h('div', { class: 'panel detail' }, [
              h('div', { class: 'panel-head' }, [h('h2', 'Issue Detail'), selectedIssue.value ? h('span', selectedIssue.value.issue.id) : null]),
              selectedIssue.value
                ? h('div', { class: 'detail-body' }, [
                    h('h3', selectedIssue.value.issue.message),
                    h('p', `${selectedIssue.value.issue.eventCount} events since ${formatTime(selectedIssue.value.issue.firstSeenAt)}`),
                    h(
                      'pre',
                      selectedIssue.value.events
                        .map((event) => JSON.stringify(event, null, 2))
                        .join('\n\n')
                    )
                  ])
                : h('p', { class: 'empty' }, 'Select an issue to inspect stack, breadcrumbs, and recent events.')
            ])
          ]),
          h('section', { class: 'panel guide' }, [
            h('div', { class: 'panel-head' }, [h('h2', 'SDK Integration'), h('span', selectedAppKey.value)]),
            h('pre', sdkSnippet.value)
          ])
        ])
      ]);
  }
};

function metricCard(label: string, value: number) {
  return h('article', { class: 'metric' }, [h('span', label), h('strong', value.toLocaleString())]);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

createApp(App).mount('#app');
