import { computed, h, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store, messages, loadApps } from '../globalStore';
import { apiUrl, formatTime, requestJson } from '../api';
import { extractPathname } from '@healthguard/core';
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
    const searchQuery = ref('');
    const selectedMetricFilter = ref<'all' | 'error' | 'http'>('all');
    const expandedRawEvents = reactive(new Set<string>());

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
          evt.page ? h('span', { class: 'context-tag' }, `Page: ${String(evt.page)}`) : null,
          evt.scene ? h('span', { class: 'context-tag' }, `Scene: ${String(evt.scene)}`) : null,
          evt.platform ? h('span', { class: 'context-tag' }, `Platform: ${String(evt.platform)}`) : null
        ]),
        evt.filename ? h('p', { class: 'event-meta' }, `${String(evt.filename)}:${String(evt.lineno ?? '-')}:${String(evt.colno ?? '-')}`) : null,
        evt.stack ? h('pre', { class: 'event-stack' }, String(evt.stack)) : null,
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
      if (evt.url && typeof evt.url === 'string') url = evt.url;
      if (evt.method && typeof evt.method === 'string') method = evt.method;
      if (evt.statusCode !== undefined) statusCode = evt.statusCode;
      if (evt.error !== undefined) errorCode = evt.error;

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

      return h('div', { class: 'event-card http-card' }, [
        h('div', { class: 'event-header' }, [
          h('span', { class: 'event-badge http' }, `${String(evt.method ?? 'GET')}`),
          h('strong', pathname),
          h('span', { class: 'event-status' }, `Status ${String(evt.status ?? '-')}`)
        ]),
        h('p', { class: 'event-url' }, String(evt.url ?? '-')),
        h('div', { class: 'event-context-row' }, [
          evt.page ? h('span', { class: 'context-tag' }, `Page: ${String(evt.page)}`) : null,
          evt.scene ? h('span', { class: 'context-tag' }, `Scene: ${String(evt.scene)}`) : null,
          evt.platform ? h('span', { class: 'context-tag' }, `Platform: ${String(evt.platform)}`) : null
        ]),
        h('div', { class: 'event-meta-row' }, [
          h('span', `Duration: ${String(evt.duration ?? '-')}ms`),
          evt.errorMessage ? h('span', { class: 'event-error-msg' }, String(evt.errorMessage)) : null
        ]),
        renderRequestData(evt.requestData as Record<string, unknown> | undefined),
        renderBreadcrumbs(evt.breadcrumbs as Array<Record<string, unknown>> | undefined),
        renderOriginalJson(evt)
      ]);
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
      const evtId = String(evt.eventId ?? '');
      const isExpanded = expandedRawEvents.has(evtId);
      return h('div', { class: 'event-raw-section' }, [
        h('button', {
          type: 'button',
          class: 'event-raw-toggle',
          onClick: () => { isExpanded ? expandedRawEvents.delete(evtId) : expandedRawEvents.add(evtId); }
        }, isExpanded ? 'Hide Raw Data' : 'Show Raw Data'),
        isExpanded ? h('pre', { class: 'event-raw' }, JSON.stringify(evt, null, 2)) : null
      ]);
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

    function getSeverityClass(count: number) {
      if (count > 20) return 'severity-critical';
      if (count > 5) return 'severity-warning';
      return 'severity-normal';
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
                  h('div', { class: 'panel-head' }, [h('h2', t.issues), h('span', `${filteredIssues.length} ${t.groups}`)]),
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
            h('div', { class: 'panel detail' }, [
              h('div', { class: 'panel-head' }, [h('h2', t.issueDetail), selectedIssue.value ? h('span', selectedIssue.value.issue.id) : null]),
              selectedIssue.value
                ? (() => {
                    const issue = selectedIssue.value.issue;
                    return h('div', { class: 'detail-body' }, [
                      h('h3', issue.message),
                      h('div', { class: 'detail-info-bar' }, [
                        h('span', { class: issue.errorType === 'http' || issue.errorType === 'request' ? 'badge-http' : 'badge-error' }, issue.errorType.toUpperCase()),
                        h('span', `${t.firstSeen} ${formatTime(issue.firstSeenAt)}`),
                        h('span', `${t.lastSeen} ${formatTime(issue.lastSeenAt)}`),
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
