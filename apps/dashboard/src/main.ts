import { computed, createApp, h, onMounted, ref } from 'vue';
import { defaultLocaleFromTimeZone, getMessages, type Locale } from './i18n';
import './style.css';

type AppType = 'web' | 'wechat-miniprogram' | 'alipay-miniprogram' | 'flutter' | 'other';

interface AppRecord {
  id: string;
  name: string;
  appKey: string;
  type: AppType;
  createdAt: number;
}

interface UserRecord {
  id: string;
  email: string;
  createdAt: number;
}

interface AuthResponse {
  token: string;
  user: UserRecord;
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

async function requestJson<T>(url: string, init?: RequestInit, token?: string): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

const apiBase = (import.meta.env.VITE_HEALTHGUARD_API_BASE || '/api').replace(/\/$/, '');
const defaultAppKey = import.meta.env.VITE_HEALTHGUARD_DEFAULT_APP_KEY || 'demo-web';
const appTypes: AppType[] = ['web', 'wechat-miniprogram', 'alipay-miniprogram', 'flutter', 'other'];

function apiUrl(path: string): string {
  return `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
}

function initialLocale(): Locale {
  const saved = localStorage.getItem('healthguard_locale');
  if (saved === 'en-US' || saved === 'zh-CN') {
    return saved;
  }

  return defaultLocaleFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

const App = {
  setup() {
    const locale = ref<Locale>(initialLocale());
    const messages = computed(() => getMessages(locale.value));
    const token = ref(localStorage.getItem('healthguard_token') ?? '');
    const user = ref<UserRecord | null>(null);
    const authMode = ref<'login' | 'register'>('login');
    const email = ref('');
    const password = ref('');
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
    const appType = ref<AppType>('web');
    const errorMessage = ref('');
    const loading = ref(false);

    const sdkSnippet = computed(
      () => `const client = createHealthGuardClient({
  appKey: '${selectedAppKey.value}',
  endpoint: '${apiUrl('/events/batch')}',
  autoCapture: true
});`
    );

    function setLocale(nextLocale: Locale): void {
      locale.value = nextLocale;
      localStorage.setItem('healthguard_locale', nextLocale);
    }

    async function loadProfile(): Promise<void> {
      if (!token.value) {
        return;
      }

      try {
        const response = await requestJson<{ user: UserRecord }>(apiUrl('/auth/me'), undefined, token.value);
        user.value = response.user;
      } catch {
        logout();
      }
    }

    async function submitAuth(): Promise<void> {
      loading.value = true;
      errorMessage.value = '';

      try {
        const response = await requestJson<AuthResponse>(apiUrl(`/auth/${authMode.value}`), {
          method: 'POST',
          body: JSON.stringify({ email: email.value, password: password.value })
        });

        token.value = response.token;
        user.value = response.user;
        localStorage.setItem('healthguard_token', response.token);
        await refresh();
      } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : 'Authentication failed';
      } finally {
        loading.value = false;
      }
    }

    function logout(): void {
      token.value = '';
      user.value = null;
      apps.value = [];
      issues.value = [];
      selectedIssue.value = null;
      localStorage.removeItem('healthguard_token');
    }

    async function refresh(): Promise<void> {
      if (!token.value) {
        return;
      }

      loading.value = true;
      errorMessage.value = '';

      try {
        const query = encodeURIComponent(selectedAppKey.value);
        const [appResponse, overviewResponse, issueResponse] = await Promise.all([
          requestJson<{ apps: AppRecord[] }>(apiUrl('/apps'), undefined, token.value),
          requestJson<OverviewResponse>(apiUrl(`/overview?appKey=${query}`), undefined, token.value),
          requestJson<{ issues: IssueSummary[] }>(apiUrl(`/issues?appKey=${query}`), undefined, token.value)
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
      if (!name || !token.value) {
        return;
      }

      const response = await requestJson<{ app: AppRecord }>(
        apiUrl('/apps'),
        {
          method: 'POST',
          body: JSON.stringify({ name, type: appType.value })
        },
        token.value
      );

      selectedAppKey.value = response.app.appKey;
      appName.value = '';
      await refresh();
    }

    async function openIssue(issue: IssueSummary): Promise<void> {
      selectedIssue.value = await requestJson<IssueDetailResponse>(apiUrl(`/issues/${encodeURIComponent(issue.id)}`), undefined, token.value);
    }

    onMounted(() => {
      void loadProfile().then(refresh);
    });

    return () => {
      const t = messages.value;

      if (!token.value || !user.value) {
        return h('main', { class: 'auth-page' }, [
          h('section', { class: 'auth-card' }, [
            h('div', { class: 'brand' }, [h('strong', 'HealthGuard'), h('span', authMode.value === 'login' ? t.login : t.register)]),
            h('div', { class: 'language-row' }, [
              h('span', t.language),
              languageButton('English', 'en-US', locale.value, setLocale),
              languageButton('中文', 'zh-CN', locale.value, setLocale)
            ]),
            h('label', { class: 'field' }, [
              h('span', t.email),
              h('input', {
                value: email.value,
                type: 'email',
                autocomplete: 'email',
                onInput: (event: Event) => {
                  email.value = (event.target as HTMLInputElement).value;
                }
              })
            ]),
            h('label', { class: 'field' }, [
              h('span', t.password),
              h('input', {
                value: password.value,
                type: 'password',
                autocomplete: authMode.value === 'login' ? 'current-password' : 'new-password',
                onInput: (event: Event) => {
                  password.value = (event.target as HTMLInputElement).value;
                }
              })
            ]),
            h('button', { type: 'button', class: 'wide', onClick: submitAuth, disabled: loading.value }, authMode.value === 'login' ? t.login : t.register),
            h(
              'button',
              {
                type: 'button',
                class: 'link-button',
                onClick: () => {
                  authMode.value = authMode.value === 'login' ? 'register' : 'login';
                }
              },
              authMode.value === 'login' ? t.switchToRegister : t.switchToLogin
            ),
            errorMessage.value ? h('p', { class: 'error' }, errorMessage.value) : null
          ])
        ]);
      }

      return h('main', { class: 'layout' }, [
        h('aside', { class: 'sidebar' }, [
          h('div', { class: 'brand' }, [h('strong', 'HealthGuard'), h('span', user.value.email)]),
          h('div', { class: 'language-row' }, [
            h('span', t.language),
            languageButton('EN', 'en-US', locale.value, setLocale),
            languageButton('中文', 'zh-CN', locale.value, setLocale)
          ]),
          h('label', { class: 'field' }, [
            h('span', t.currentAppKey),
            h('input', {
              value: selectedAppKey.value,
              onInput: (event: Event) => {
                selectedAppKey.value = (event.target as HTMLInputElement).value;
              }
            })
          ]),
          h('button', { type: 'button', class: 'wide', onClick: refresh, disabled: loading.value }, t.refresh),
          h('div', { class: 'create-box' }, [
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
            h('button', { type: 'button', class: 'wide secondary', onClick: createAppRecord }, t.create)
          ]),
          h('div', { class: 'panel-title' }, t.projectList),
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
                [h('span', item.name), h('small', item.type), h('small', item.appKey)]
              )
            )
          ),
          h('button', { type: 'button', class: 'wide ghost', onClick: logout }, t.logout)
        ]),
        h('section', { class: 'content' }, [
          h('header', { class: 'topbar' }, [
            h('div', [h('h1', t.applicationHealth), h('p', t.inspectSubtitle)]),
            errorMessage.value ? h('p', { class: 'error' }, errorMessage.value) : null
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
                      selectedIssue.value.events
                        .map((event) => JSON.stringify(event, null, 2))
                        .join('\n\n')
                    )
                  ])
                : h('p', { class: 'empty' }, t.noIssueSelected)
            ])
          ]),
          h('section', { class: 'panel guide' }, [
            h('div', { class: 'panel-head' }, [h('h2', t.sdkIntegration), h('span', selectedAppKey.value)]),
            h('pre', sdkSnippet.value)
          ])
        ])
      ]);
    };
  }
};

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

function metricCard(label: string, value: number) {
  return h('article', { class: 'metric' }, [h('span', label), h('strong', value.toLocaleString())]);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

createApp(App).mount('#app');
