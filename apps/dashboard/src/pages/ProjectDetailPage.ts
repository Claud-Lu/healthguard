import { computed, h, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store, messages, loadApps } from '../globalStore';
import { apiUrl, formatTime, requestJson } from '../api';
import type { IssueSummary, OverviewTotals } from '../globalStore';

const platforms = ['web', 'wechat-miniprogram', 'alipay-miniprogram', 'flutter', 'uniapp-h5', 'uniapp-wechat', 'uniapp-alipay', 'uniapp-douyin', 'uniapp-app', 'uniapp'];

interface IssueDetailResponse {
  issue: IssueSummary;
  events: Array<Record<string, unknown>>;
}

export default {
  setup() {
    const route = useRoute();
    const router = useRouter();
    const appKey = ref(String(route.params.appKey));

    const overview = ref<OverviewTotals>({ events: 0, errors: 0, failedRequests: 0, affectedUsers: 0, issues: 0 });
    const issues = ref<IssueSummary[]>([]);
    const selectedIssue = ref<IssueDetailResponse | null>(null);
    const selectedPlatform = ref('');

    const selectedApp = computed(() => store.apps.find((item) => item.appKey === appKey.value) ?? null);

    const sdkSnippet = computed(() => {
      const endpoint = apiUrl('/events/batch');
      if (selectedApp.value?.type === 'uni-app') {
        return `import { createUniAppClient } from '@healthguard/sdk-uniapp';\n\nconst client = createUniAppClient({\n  appKey: '${appKey.value}',\n  endpoint: '${endpoint}',\n  autoCapture: true\n});`;
      }
      if (selectedApp.value?.type === 'flutter') {
        return `flutter build apk --release \\\n  --dart-define=HEALTHGUARD_ENDPOINT=${endpoint} \\\n  --dart-define=HEALTHGUARD_APP_KEY=${appKey.value} \\\n  --dart-define=HEALTHGUARD_ENV=production`;
      }
      return `const client = createHealthGuardClient({\n  appKey: '${appKey.value}',\n  endpoint: '${endpoint}',\n  autoCapture: true\n});`;
    });

    watch(() => route.params.appKey, (newKey) => {
      appKey.value = String(newKey);
      selectedIssue.value = null;
      void loadProjectData();
    });

    watch(selectedPlatform, () => {
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
      const query = encodeURIComponent(appKey.value);
      const platformQuery = selectedPlatform.value ? `&platform=${encodeURIComponent(selectedPlatform.value)}` : '';
      try {
        const [overviewResponse, issueResponse] = await Promise.all([
          requestJson<{ totals: OverviewTotals }>(apiUrl(`/overview?appKey=${query}${platformQuery}`), undefined, store.token),
          requestJson<{ issues: IssueSummary[] }>(apiUrl(`/issues?appKey=${query}${platformQuery}`), undefined, store.token)
        ]);
        overview.value = overviewResponse.totals;
        issues.value = issueResponse.issues;
        if (selectedIssue.value && !issues.value.some((issue) => issue.id === selectedIssue.value?.issue.id)) {
          selectedIssue.value = null;
        }
      } catch (error) {
        store.errorMessage = (error as Error).message;
      }
    }

    async function openIssue(issue: IssueSummary): Promise<void> {
      const platformQuery = selectedPlatform.value ? `?platform=${encodeURIComponent(selectedPlatform.value)}` : '';
      selectedIssue.value = await requestJson<IssueDetailResponse>(apiUrl(`/issues/${encodeURIComponent(issue.id)}${platformQuery}`), undefined, store.token);
    }

    function metricCard(label: string, value: number) {
      return h('article', { class: 'metric' }, [h('span', label), h('strong', value.toLocaleString())]);
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
          ])
        ]),

        h('section', { class: 'content detail-content' }, [
          h('header', { class: 'topbar' }, [
            h('div', [h('h1', selectedApp.value.name), h('p', t.inspectSubtitle)]),
            h('div', { class: 'topbar-actions' }, [
              h('button', { type: 'button', class: 'outline-button', onClick: () => { void loadProjectData(); }, disabled: store.loading }, t.refresh),
              h('button', { type: 'button', class: 'outline-button', onClick: () => router.push('/projects') }, t.projectList)
            ]),
            store.errorMessage ? h('p', { class: 'error' }, store.errorMessage) : null
          ]),

          h('section', { class: 'platform-filter' }, [
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
            ])
          ]),

          h('section', { class: 'metrics' }, [
            metricCard(t.events, overview.value.events),
            metricCard(t.errors, overview.value.errors),
            metricCard(t.failedRequests, overview.value.failedRequests),
            metricCard(t.affectedUsers, overview.value.affectedUsers),
            metricCard(t.issues, overview.value.issues)
          ]),

          h('section', { class: 'grid' }, [
            h('div', { class: 'panel' }, [
              h('div', { class: 'panel-head' }, [h('h2', t.issues), h('span', `${issues.value.length} ${t.groups}`)]),
              issues.value.length === 0
                ? h('p', { class: 'empty' }, t.emptyIssues)
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
                          h('span', `${issue.errorType} / ${issue.eventCount} ${t.events}`),
                          Object.keys(issue.platformDistribution).length > 0
                            ? h(
                                'div',
                                { class: 'platform-tags' },
                                Object.entries(issue.platformDistribution).map(([platform, count]) =>
                                  h('span', { class: 'platform-tag', title: `${count} events` }, `${platform}: ${count}`)
                                )
                              )
                            : null,
                          h('small', issue.fingerprint)
                        ]
                      )
                    )
                  )
            ]),
            h('div', { class: 'panel detail' }, [
              h('div', { class: 'panel-head' }, [h('h2', t.issueDetail), selectedIssue.value ? h('span', selectedIssue.value.issue.id) : null]),
              selectedIssue.value
                ? h('div', { class: 'detail-body' }, [
                    h('h3', selectedIssue.value.issue.message),
                    h('p', `${selectedIssue.value.issue.eventCount} ${t.events} since ${formatTime(selectedIssue.value.issue.firstSeenAt)}`),
                    h(
                      'pre',
                      selectedIssue.value.events.map((evt: Record<string, unknown>) => JSON.stringify(evt, null, 2)).join('\n\n')
                    )
                  ])
                : h('p', { class: 'empty' }, t.noIssueSelected)
            ])
          ])
        ])
      ]);
    };
  }
};
