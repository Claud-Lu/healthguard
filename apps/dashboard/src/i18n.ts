export type Locale = 'en-US' | 'zh-CN';

export type MessageKey =
  | 'affectedUsers'
  | 'allPlatforms'
  | 'appName'
  | 'appType'
  | 'applicationHealth'
  | 'cancel'
  | 'confirm'
  | 'create'
  | 'createApp'
  | 'currentAppKey'
  | 'dashboardHomeSubtitle'
  | 'dashboardIntroTitle'
  | 'dashboardIntroBody'
  | 'dashboardIntroPrivacy'
  | 'dashboardIntroPlatforms'
  | 'dashboardIntroDeploy'
  | 'dashboardIntroSdk'
  | 'projectWorkspace'
  | 'email'
  | 'emptyIssues'
  | 'emptyProjects'
  | 'errors'
  | 'events'
  | 'failedRequests'
  | 'groups'
  | 'healthScore'
  | 'healthStatus'
  | 'healthy'
  | 'inspectSubtitle'
  | 'invalidCredentials'
  | 'invalidEmail'
  | 'issueDetail'
  | 'issues'
  | 'latestActivity'
  | 'language'
  | 'login'
  | 'logout'
  | 'networkError'
  | 'noData'
  | 'noIssueSelected'
  | 'openDetail'
  | 'password'
  | 'passwordHelp'
  | 'passwordTooShort'
  | 'platform'
  | 'projectList'
  | 'projectDetail'
  | 'refresh'
  | 'register'
  | 'sdkIntegration'
  | 'selectProject'
  | 'emailAlreadyRegistered'
  | 'switchToLogin'
  | 'switchToRegister'
  | 'warning'
  | 'critical';

type Messages = Record<MessageKey, string>;

const messages: Record<Locale, Messages> = {
  'en-US': {
    affectedUsers: 'Affected Users',
    allPlatforms: 'All Platforms',
    appName: 'App name',
    cancel: 'Cancel',
    confirm: 'Confirm',
    appType: 'App Type',
    applicationHealth: 'Application Health',
    create: 'Create',
    createApp: 'Create App',
    currentAppKey: 'Current App Key',
    dashboardHomeSubtitle: 'Select a project to inspect its health data, issues, and SDK setup.',
    dashboardIntroTitle: 'Self-hosted monitoring for H5 and mini-program apps',
    dashboardIntroBody: 'HealthGuard collects frontend errors, failed requests, breadcrumbs, and platform distribution in a private dashboard that can run on your own server.',
    dashboardIntroPrivacy: 'Private deployment',
    dashboardIntroPlatforms: 'H5 / Mini program / uni-app',
    dashboardIntroDeploy: 'Docker + PostgreSQL',
    dashboardIntroSdk: 'SDK-first integration',
    projectWorkspace: 'Project Workspace',
    email: 'Email',
    emptyIssues: 'No issues yet. Trigger an error from an integrated app, then refresh.',
    emptyProjects: 'No projects yet. Create one from the sidebar to get an app key.',
    errors: 'Errors',
    events: 'Events',
    failedRequests: 'Failed Requests',
    groups: 'groups',
    healthScore: 'Health',
    healthStatus: 'Status',
    healthy: 'Healthy',
    inspectSubtitle: 'Inspect captured errors, failed requests, and SDK setup for the selected app.',
    invalidCredentials: 'Email or password is incorrect.',
    invalidEmail: 'Please enter a valid email address.',
    issueDetail: 'Issue Detail',
    issues: 'Issues',
    latestActivity: 'Latest Activity',
    language: 'Language',
    login: 'Login',
    logout: 'Logout',
    networkError: 'Request failed. Please try again later.',
    noData: 'No data',
    noIssueSelected: 'Select an issue to inspect stack, breadcrumbs, and recent events.',
    openDetail: 'Open',
    password: 'Password',
    passwordHelp: 'At least 8 characters.',
    passwordTooShort: 'Password must be at least 8 characters.',
    platform: 'Platform',
    projectList: 'Projects',
    projectDetail: 'Project Detail',
    refresh: 'Refresh',
    register: 'Register',
    sdkIntegration: 'SDK Integration',
    selectProject: 'Select Project',
    emailAlreadyRegistered: 'This email is already registered.',
    switchToLogin: 'Have an account? Login',
    switchToRegister: 'Need an account? Register',
    warning: 'Warning',
    critical: 'Critical'
  },
  'zh-CN': {
    affectedUsers: '影响用户',
    allPlatforms: '全部平台',
    appName: '项目名称',
    cancel: '取消',
    confirm: '确定',
    appType: '项目类型',
    applicationHealth: '应用健康度',
    create: '创建',
    createApp: '添加项目',
    currentAppKey: '当前 App Key',
    dashboardHomeSubtitle: '选择一个项目后查看它的健康数据、Issue 和 SDK 接入信息。',
    dashboardIntroTitle: '开源、自托管的应用健康监控',
    dashboardIntroBody: 'HealthGuard 用私有化看板采集前端错误、失败请求、面包屑和多端平台分布，适合 H5、小程序与 uni-app 项目快速接入。',
    dashboardIntroPrivacy: '私有化部署',
    dashboardIntroPlatforms: 'H5 / 小程序 / uni-app',
    dashboardIntroDeploy: 'Docker + PostgreSQL',
    dashboardIntroSdk: 'SDK 优先接入',
    projectWorkspace: '项目工作区',
    email: '邮箱',
    emptyIssues: '暂无 Issue。请从已接入项目触发一次错误后刷新。',
    emptyProjects: '暂无项目。请先在左侧创建项目并生成 app key。',
    errors: '错误数',
    events: '事件数',
    failedRequests: '失败请求',
    groups: '组',
    healthScore: '健康度',
    healthStatus: '状态',
    healthy: '健康',
    inspectSubtitle: '查看所选项目采集到的错误、失败请求和 SDK 接入信息。',
    invalidCredentials: '邮箱或密码不正确。',
    invalidEmail: '请输入正确的邮箱地址。',
    issueDetail: 'Issue 详情',
    issues: 'Issues',
    latestActivity: '最近活动',
    language: '语言',
    login: '登录',
    logout: '退出登录',
    networkError: '请求失败，请稍后重试。',
    noData: '暂无数据',
    noIssueSelected: '选择一个 Issue 后查看堆栈、面包屑和最近事件。',
    openDetail: '查看详情',
    password: '密码',
    passwordHelp: '至少 8 位。',
    passwordTooShort: '密码至少需要 8 位。',
    platform: '平台',
    projectList: '项目列表',
    projectDetail: '项目详情',
    refresh: '刷新',
    register: '注册',
    sdkIntegration: 'SDK 接入',
    selectProject: '查看项目',
    emailAlreadyRegistered: '该邮箱已注册，请直接登录。',
    switchToLogin: '已有账号？去登录',
    switchToRegister: '没有账号？去注册',
    warning: '注意',
    critical: '异常'
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
