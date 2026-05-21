import { computed, createApp, h, onMounted, ref } from 'vue';
import { defaultLocaleFromTimeZone, getMessages, messageForErrorCode, type Locale } from './i18n';
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

class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
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
    const payload = await readErrorPayload(response);
    throw new ApiError(payload.message || `Request failed: ${response.status}`, payload.code);
  }

  return response.json() as Promise<T>;
}

const apiBase = (import.meta.env.VITE_HEALTHGUARD_API_BASE || '/api').replace(/\/$/, '');
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
    const selectedAppKey = ref('');
    const selectedApp = computed(() => apps.value.find((item) => item.appKey === selectedAppKey.value) ?? null);
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
        const validationError = validateAuthForm(email.value, password.value, locale.value);
        if (validationError) {
          errorMessage.value = validationError;
          return;
        }

        const response = await requestJson<AuthResponse>(apiUrl(`/auth/${authMode.value}`), {
          method: 'POST',
          body: JSON.stringify({ email: email.value, password: password.value })
        });

        token.value = response.token;
        user.value = response.user;
        localStorage.setItem('healthguard_token', response.token);
        await refresh();
      } catch (error) {
        errorMessage.value = friendlyErrorMessage(error, locale.value);
      } finally {
        loading.value = false;
      }
    }

    function logout(): void {
      token.value = '';
      user.value = null;
      apps.value = [];
      selectedAppKey.value = '';
      resetProjectData();
      localStorage.removeItem('healthguard_token');
    }

    async function refresh(): Promise<void> {
      if (!token.value) {
        return;
      }

      loading.value = true;
      errorMessage.value = '';

      try {
        const appResponse = await requestJson<{ apps: AppRecord[] }>(apiUrl('/apps'), undefined, token.value);

        apps.value = appResponse.apps;

        if (!selectedApp.value) {
          selectedAppKey.value = '';
          resetProjectData();
          return;
        }

        await loadProjectData(selectedAppKey.value);
      } catch (error) {
        errorMessage.value = friendlyErrorMessage(error, locale.value);
      } finally {
        loading.value = false;
      }
    }

    async function loadProjectData(appKey: string): Promise<void> {
      const query = encodeURIComponent(appKey);
      const [overviewResponse, issueResponse] = await Promise.all([
        requestJson<OverviewResponse>(apiUrl(`/overview?appKey=${query}`), undefined, token.value),
        requestJson<{ issues: IssueSummary[] }>(apiUrl(`/issues?appKey=${query}`), undefined, token.value)
      ]);

      overview.value = overviewResponse.totals;
      issues.value = issueResponse.issues;

      if (selectedIssue.value && !issues.value.some((issue) => issue.id === selectedIssue.value?.issue.id)) {
        selectedIssue.value = null;
      }
    }

    function resetProjectData(): void {
      overview.value = {
        events: 0,
        errors: 0,
        failedRequests: 0,
        affectedUsers: 0,
        issues: 0
      };
      issues.value = [];
      selectedIssue.value = null;
    }

    async function selectProject(appKey: string): Promise<void> {
      selectedAppKey.value = appKey;
      selectedIssue.value = null;
      loading.value = true;
      errorMessage.value = '';

      try {
        await loadProjectData(appKey);
      } catch (error) {
        errorMessage.value = friendlyErrorMessage(error, locale.value);
      } finally {
        loading.value = false;
      }
    }

    function showProjectList(): void {
      selectedAppKey.value = '';
      resetProjectData();
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
            h('p', { class: 'help' }, t.passwordHelp),
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
                    void selectProject(item.appKey);
                  }
                },
                [h('span', item.name), h('small', item.type), h('small', item.appKey)]
              )
            )
          ),
          h('button', { type: 'button', class: 'wide ghost', onClick: logout }, t.logout)
        ]),
        selectedApp.value
          ? h('section', { class: 'content' }, [
          h('header', { class: 'topbar' }, [
            h('div', [h('h1', selectedApp.value.name), h('p', t.inspectSubtitle)]),
            h('button', { type: 'button', class: 'outline-button', onClick: showProjectList }, t.projectList),
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
          : h('section', { class: 'content' }, [
              h('header', { class: 'topbar' }, [
                h('div', [h('h1', t.projectList), h('p', t.dashboardHomeSubtitle)]),
                errorMessage.value ? h('p', { class: 'error' }, errorMessage.value) : null
              ]),
              h(
                'section',
                { class: 'project-grid' },
                apps.value.length === 0
                  ? [h('div', { class: 'panel empty-panel' }, [h('p', { class: 'empty' }, t.emptyProjects)])]
                  : apps.value.map((item) =>
                      h('button', { type: 'button', class: 'project-card', onClick: () => void selectProject(item.appKey) }, [
                        h('span', item.type),
                        h('strong', item.name),
                        h('code', item.appKey),
                        h('small', `${t.create}: ${formatTime(item.createdAt)}`),
                        h('em', t.selectProject)
                      ])
                    )
              )
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

async function readErrorPayload(response: Response): Promise<{ code?: string; message?: string }> {
  try {
    const payload = (await response.json()) as { code?: unknown; message?: unknown };

    return {
      code: typeof payload.code === 'string' ? payload.code : undefined,
      message: typeof payload.message === 'string' ? payload.message : undefined
    };
  } catch {
    return {};
  }
}

function validateAuthForm(email: string, password: string, locale: Locale): string | null {
  const trimmedEmail = email.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return messageForErrorCode('INVALID_EMAIL', locale);
  }

  if (password.length < 8) {
    return messageForErrorCode('PASSWORD_TOO_SHORT', locale);
  }

  return null;
}

function friendlyErrorMessage(error: unknown, locale: Locale): string {
  if (error instanceof ApiError) {
    return messageForErrorCode(error.code, locale);
  }

  return messageForErrorCode(undefined, locale);
}

createApp(App).mount('#app');
