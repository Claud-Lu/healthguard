import { h, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store, messages, loadApps, logout, createApp, setLocale } from '../globalStore';
import { apiUrl, formatTime, requestJson } from '../api';
import type { AppRecord, AppType, OverviewTotals } from '../globalStore';
import type { Locale } from '../i18n';

const appTypes: AppType[] = ['web', 'wechat-miniprogram', 'alipay-miniprogram', 'flutter', 'uni-app', 'other'];

interface ProjectSummary {
  app: AppRecord;
  totals: OverviewTotals;
}

function emptyTotals(): OverviewTotals {
  return { events: 0, errors: 0, failedRequests: 0, affectedUsers: 0, issues: 0 };
}

function healthScore(totals: OverviewTotals): number {
  if (totals.events === 0) return 100;
  return Math.max(0, 100 - totals.errors * 12 - totals.failedRequests * 8 - totals.issues * 10);
}

function statusKey(score: number): 'healthy' | 'warning' | 'critical' {
  if (score >= 90) return 'healthy';
  if (score >= 70) return 'warning';
  return 'critical';
}

export default {
  setup() {
    const router = useRouter();
    const summaries = ref<ProjectSummary[]>([]);
    const showCreateModal = ref(false);
    const appName = ref('');
    const appType = ref<AppType>('web');

    onMounted(() => {
      void loadDashboardData();
    });

    async function loadDashboardData(): Promise<void> {
      await loadApps();
      if (!store.token) return;

      const loaded = await Promise.all(
        store.apps.map(async (app) => {
          try {
            const response = await requestJson<{ totals: OverviewTotals }>(
              apiUrl(`/overview?appKey=${encodeURIComponent(app.appKey)}`),
              undefined,
              store.token
            );
            return { app, totals: response.totals };
          } catch {
            return { app, totals: emptyTotals() };
          }
        })
      );
      summaries.value = loaded;
    }

    async function handleCreateApp(): Promise<void> {
      const key = await createApp(appName.value, appType.value);
      if (key) {
        appName.value = '';
        showCreateModal.value = false;
        await loadDashboardData();
      }
    }

    function handleLogout(): void {
      logout();
      void router.push('/login');
    }

    function languageButton(label: string, value: Locale, current: Locale, onClick: (locale: Locale) => void) {
      return h(
        'button',
        {
          type: 'button',
          class: current === value ? 'language-button active' : 'language-button',
          onClick: () => onClick(value)
        },
        label
      );
    }

    function metricCell(value: number) {
      return h('strong', value.toLocaleString());
    }

    return () => {
      const t = messages.value;
      const projectCount = store.apps.length;

      return h('main', { class: 'layout' }, [
        h('aside', { class: 'sidebar' }, [
          h('div', { class: 'brand' }, [
            h('strong', 'HealthGuard'),
            h('span', store.user?.email ?? '')
          ]),
          h('div', { class: 'language-row' }, [
            h('span', t.language),
            languageButton('EN', 'en-US', store.locale, setLocale),
            languageButton('中文', 'zh-CN', store.locale, setLocale)
          ]),
          h('button', { type: 'button', class: 'wide', onClick: () => { void loadDashboardData(); }, disabled: store.loading }, t.refresh),
          h('div', { class: 'create-box' }, [
            h('h2', t.createApp),
            h('button', { type: 'button', class: 'wide secondary', onClick: () => { showCreateModal.value = true; } }, t.create)
          ]),
          h('div', { class: 'panel-title' }, t.projectList),
          h(
            'div',
            { class: 'app-list' },
            store.apps.map((item) =>
              h(
                'button',
                {
                  type: 'button',
                  class: 'app-row',
                  onClick: () => router.push(`/projects/${item.appKey}`)
                },
                [h('span', item.name), h('small', item.type), h('small', item.appKey)]
              )
            )
          ),
          h('button', { type: 'button', class: 'wide ghost', onClick: handleLogout }, t.logout)
        ]),
        h('section', { class: 'content' }, [
          h('section', { class: 'dashboard-hero' }, [
            h('div', { class: 'hero-copy' }, [
              h('span', { class: 'eyebrow' }, 'HealthGuard'),
              h('h1', t.dashboardIntroTitle),
              h('p', t.dashboardIntroBody),
              h('div', { class: 'hero-tags' }, [
                h('span', t.dashboardIntroPrivacy),
                h('span', t.dashboardIntroPlatforms),
                h('span', t.dashboardIntroDeploy),
                h('span', t.dashboardIntroSdk)
              ])
            ]),
            h('div', { class: 'hero-status' }, [
              h('span', t.projectWorkspace),
              h('strong', String(projectCount)),
              h('small', projectCount === 1 ? t.projectDetail : t.projectList)
            ])
          ]),
          h('header', { class: 'topbar' }, [
            h('div', [h('h1', t.projectList), h('p', t.dashboardHomeSubtitle)]),
            store.errorMessage ? h('p', { class: 'error' }, store.errorMessage) : null
          ]),
          h('section', { class: 'panel project-table-panel' }, [
            store.apps.length === 0
              ? h('p', { class: 'empty' }, t.emptyProjects)
              : h('div', { class: 'project-table' }, [
                  h('div', { class: 'project-table-head' }, [
                    h('span', t.projectDetail),
                    h('span', t.healthScore),
                    h('span', t.errors),
                    h('span', t.failedRequests),
                    h('span', t.affectedUsers),
                    h('span', t.issues),
                    h('span', t.latestActivity),
                    h('span', '')
                  ]),
                  ...summaries.value.map(({ app, totals }) => {
                    const score = healthScore(totals);
                    const key = statusKey(score);
                    return h('button', { type: 'button', class: 'project-table-row', onClick: () => router.push(`/projects/${app.appKey}`) }, [
                      h('span', { class: 'project-name-cell' }, [h('strong', app.name), h('small', app.type), h('code', app.appKey)]),
                      h('span', { class: `health-pill ${key}` }, [`${score}`, h('small', t[key])]),
                      h('span', metricCell(totals.errors)),
                      h('span', metricCell(totals.failedRequests)),
                      h('span', metricCell(totals.affectedUsers)),
                      h('span', metricCell(totals.issues)),
                      h('span', totals.events > 0 ? formatTime(app.createdAt) : t.noData),
                      h('span', { class: 'table-action' }, t.openDetail)
                    ]);
                  })
                ])
          ])
        ]),
        showCreateModal.value
          ? h(
              'div',
              {
                class: 'modal-overlay',
                onClick: () => {
                  showCreateModal.value = false;
                }
              },
              [
                h(
                  'div',
                  {
                    class: 'modal-card',
                    onClick: (event: Event) => {
                      event.stopPropagation();
                    }
                  },
                  [
                    h('h2', t.createApp),
                    h('label', { class: 'field' }, [
                      h('span', t.appName),
                      h('input', {
                        value: appName.value,
                        placeholder: t.appName,
                        onInput: (event: Event) => {
                          appName.value = (event.target as HTMLInputElement).value;
                        }
                      })
                    ]),
                    h('label', { class: 'field' }, [
                      h('span', t.appType),
                      h(
                        'select',
                        {
                          value: appType.value,
                          onChange: (event: Event) => {
                            appType.value = (event.target as HTMLSelectElement).value as AppType;
                          }
                        },
                        appTypes.map((type) => h('option', { value: type }, type))
                      )
                    ]),
                    h('div', { class: 'modal-actions' }, [
                      h('button', { type: 'button', class: 'wide secondary', onClick: () => { showCreateModal.value = false; } }, t.cancel),
                      h('button', { type: 'button', class: 'wide', onClick: handleCreateApp, disabled: store.loading }, t.confirm)
                    ]),
                    store.errorMessage ? h('p', { class: 'error' }, store.errorMessage) : null
                  ]
                )
              ]
            )
          : null
      ]);
    };
  }
};
