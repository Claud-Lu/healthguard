export type Locale = 'en-US' | 'zh-CN';

export type MessageKey =
  | 'affectedUsers'
  | 'appName'
  | 'appType'
  | 'applicationHealth'
  | 'create'
  | 'createApp'
  | 'currentAppKey'
  | 'dashboardHomeSubtitle'
  | 'email'
  | 'emptyIssues'
  | 'emptyProjects'
  | 'errors'
  | 'events'
  | 'failedRequests'
  | 'groups'
  | 'inspectSubtitle'
  | 'invalidCredentials'
  | 'invalidEmail'
  | 'issueDetail'
  | 'issues'
  | 'language'
  | 'login'
  | 'logout'
  | 'networkError'
  | 'noIssueSelected'
  | 'password'
  | 'passwordHelp'
  | 'passwordTooShort'
  | 'projectList'
  | 'projectDetail'
  | 'refresh'
  | 'register'
  | 'sdkIntegration'
  | 'selectProject'
  | 'emailAlreadyRegistered'
  | 'switchToLogin'
  | 'switchToRegister';

type Messages = Record<MessageKey, string>;

const messages: Record<Locale, Messages> = {
  'en-US': {
    affectedUsers: 'Affected Users',
    appName: 'App name',
    appType: 'App Type',
    applicationHealth: 'Application Health',
    create: 'Create',
    createApp: 'Create App',
    currentAppKey: 'Current App Key',
    dashboardHomeSubtitle: 'Select a project to inspect its health data, issues, and SDK setup.',
    email: 'Email',
    emptyIssues: 'No issues yet. Trigger an error from an integrated app, then refresh.',
    emptyProjects: 'No projects yet. Create one from the sidebar to get an app key.',
    errors: 'Errors',
    events: 'Events',
    failedRequests: 'Failed Requests',
    groups: 'groups',
    inspectSubtitle: 'Inspect captured errors, failed requests, and SDK setup for the selected app.',
    invalidCredentials: 'Email or password is incorrect.',
    invalidEmail: 'Please enter a valid email address.',
    issueDetail: 'Issue Detail',
    issues: 'Issues',
    language: 'Language',
    login: 'Login',
    logout: 'Logout',
    networkError: 'Request failed. Please try again later.',
    noIssueSelected: 'Select an issue to inspect stack, breadcrumbs, and recent events.',
    password: 'Password',
    passwordHelp: 'At least 8 characters.',
    passwordTooShort: 'Password must be at least 8 characters.',
    projectList: 'Projects',
    projectDetail: 'Project Detail',
    refresh: 'Refresh',
    register: 'Register',
    sdkIntegration: 'SDK Integration',
    selectProject: 'Select Project',
    emailAlreadyRegistered: 'This email is already registered.',
    switchToLogin: 'Have an account? Login',
    switchToRegister: 'Need an account? Register'
  },
  'zh-CN': {
    affectedUsers: '影响用户',
    appName: '项目名称',
    appType: '项目类型',
    applicationHealth: '应用健康度',
    create: '创建',
    createApp: '添加项目',
    currentAppKey: '当前 App Key',
    dashboardHomeSubtitle: '选择一个项目后查看它的健康数据、Issue 和 SDK 接入信息。',
    email: '邮箱',
    emptyIssues: '暂无 Issue。请从已接入项目触发一次错误后刷新。',
    emptyProjects: '暂无项目。请先在左侧创建项目并生成 app key。',
    errors: '错误数',
    events: '事件数',
    failedRequests: '失败请求',
    groups: '组',
    inspectSubtitle: '查看所选项目采集到的错误、失败请求和 SDK 接入信息。',
    invalidCredentials: '邮箱或密码不正确。',
    invalidEmail: '请输入正确的邮箱地址。',
    issueDetail: 'Issue 详情',
    issues: 'Issues',
    language: '语言',
    login: '登录',
    logout: '退出登录',
    networkError: '请求失败，请稍后重试。',
    noIssueSelected: '选择一个 Issue 后查看堆栈、面包屑和最近事件。',
    password: '密码',
    passwordHelp: '至少 8 位。',
    passwordTooShort: '密码至少需要 8 位。',
    projectList: '项目列表',
    projectDetail: '项目详情',
    refresh: '刷新',
    register: '注册',
    sdkIntegration: 'SDK 接入',
    selectProject: '查看项目',
    emailAlreadyRegistered: '该邮箱已注册，请直接登录。',
    switchToLogin: '已有账号？去登录',
    switchToRegister: '没有账号？去注册'
  }
};

export function getMessages(locale: Locale): Messages {
  return messages[locale];
}

export function defaultLocaleFromTimeZone(timeZone?: string): Locale {
  return ['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Hong_Kong', 'Asia/Macau', 'Asia/Taipei'].includes(timeZone ?? '')
    ? 'zh-CN'
    : 'en-US';
}

export function messageForErrorCode(code: string | undefined, locale: Locale): string {
  const localizedMessages = getMessages(locale);
  const errorKeys: Record<string, MessageKey> = {
    INVALID_EMAIL: 'invalidEmail',
    PASSWORD_TOO_SHORT: 'passwordTooShort',
    EMAIL_ALREADY_REGISTERED: 'emailAlreadyRegistered',
    INVALID_CREDENTIALS: 'invalidCredentials'
  };
  const key = code ? errorKeys[code] : undefined;

  return key ? localizedMessages[key] : localizedMessages.networkError;
}
