export type Locale = 'en-US' | 'zh-CN';

export type MessageKey =
  | 'affectedUsers'
  | 'appName'
  | 'appType'
  | 'applicationHealth'
  | 'create'
  | 'createApp'
  | 'currentAppKey'
  | 'email'
  | 'emptyIssues'
  | 'errors'
  | 'events'
  | 'failedRequests'
  | 'groups'
  | 'inspectSubtitle'
  | 'issueDetail'
  | 'issues'
  | 'language'
  | 'login'
  | 'logout'
  | 'noIssueSelected'
  | 'password'
  | 'projectList'
  | 'refresh'
  | 'register'
  | 'sdkIntegration'
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
    email: 'Email',
    emptyIssues: 'No issues yet. Trigger an error from an integrated app, then refresh.',
    errors: 'Errors',
    events: 'Events',
    failedRequests: 'Failed Requests',
    groups: 'groups',
    inspectSubtitle: 'Inspect captured errors, failed requests, and SDK setup for the selected app.',
    issueDetail: 'Issue Detail',
    issues: 'Issues',
    language: 'Language',
    login: 'Login',
    logout: 'Logout',
    noIssueSelected: 'Select an issue to inspect stack, breadcrumbs, and recent events.',
    password: 'Password',
    projectList: 'Projects',
    refresh: 'Refresh',
    register: 'Register',
    sdkIntegration: 'SDK Integration',
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
    email: '邮箱',
    emptyIssues: '暂无 Issue。请从已接入项目触发一次错误后刷新。',
    errors: '错误数',
    events: '事件数',
    failedRequests: '失败请求',
    groups: '组',
    inspectSubtitle: '查看所选项目采集到的错误、失败请求和 SDK 接入信息。',
    issueDetail: 'Issue 详情',
    issues: 'Issues',
    language: '语言',
    login: '登录',
    logout: '退出登录',
    noIssueSelected: '选择一个 Issue 后查看堆栈、面包屑和最近事件。',
    password: '密码',
    projectList: '项目列表',
    refresh: '刷新',
    register: '注册',
    sdkIntegration: 'SDK 接入',
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
