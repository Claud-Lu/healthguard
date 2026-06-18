import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface SdkConfig {
  appKey: string;
  endpoint: string;
  platform: 'web' | 'uni-app' | 'wechat-miniprogram' | 'alipay-miniprogram' | 'flutter' | 'unknown';
  sourceFile: string;
}

export interface Credentials {
  username: string;
  password: string;
}

export interface AppRecord {
  id: string;
  name: string;
  appKey: string;
  type: string;
  createdAt: number;
}

export interface IssueSummary {
  id: string;
  appKey: string;
  fingerprint: string;
  message: string;
  errorType: string;
  eventCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  platformDistribution: Record<string, number>;
  archived: boolean;
  archivedAt: number | null;
}

export interface IssueDetail {
  issue: IssueSummary;
  events: HealthGuardEvent[];
}

export interface HealthGuardEvent {
  type: 'error' | 'http' | 'performance' | 'breadcrumb';
  appKey: string;
  eventId: string;
  message?: string;
  stack?: string;
  pageUrl?: string;
  platform?: string;
  errorType?: string;
  timestamp: number;
  deviceInfo?: Record<string, unknown>;
  breadcrumbs?: Array<{ type: string; message: string; timestamp: number; data?: Record<string, unknown> }>;
  environment?: string;
  release?: string;
  [key: string]: unknown;
}

const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.vite', '.turbo', 'coverage', '.next']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.mjs', '.cjs']);

function isSourceFile(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.'));
  return SOURCE_EXTENSIONS.has(ext);
}

function walkDir(dir: string, files: string[], depth = 0, maxDepth = 10): void {
  if (depth > maxDepth) return;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIPPED_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      walkDir(fullPath, files, depth + 1, maxDepth);
    } else if (stats.isFile() && isSourceFile(entry)) {
      files.push(fullPath);
    }
  }
}

export function extractStringLiteral(source: string, name: string): string | undefined {
  const patterns = [
    new RegExp(`${name}\\s*:\\s*"([^"]+)"`),
    new RegExp(`${name}\\s*:\\s*'([^']+)'`),
    new RegExp(`${name}\\s*=\\s*"([^"]+)"`),
    new RegExp(`${name}\\s*=\\s*'([^']+)'`)
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }

  return undefined;
}

function detectPlatform(source: string): SdkConfig['platform'] {
  if (source.includes('createHealthGuardClient')) return 'web';
  if (source.includes('createUniAppClient')) return 'uni-app';
  if (source.includes('createMiniProgramClient')) {
    if (source.includes('alipay')) return 'alipay-miniprogram';
    return 'wechat-miniprogram';
  }
  if (source.includes('createFlutterClient')) return 'flutter';
  return 'unknown';
}

export function discoverSdkConfig(cwd: string): SdkConfig | undefined {
  const files: string[] = [];
  walkDir(cwd, files);

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    const hasSdkCall =
      source.includes('createHealthGuardClient') ||
      source.includes('createUniAppClient') ||
      source.includes('createMiniProgramClient') ||
      source.includes('createFlutterClient');

    if (!hasSdkCall) continue;

    const appKey = extractStringLiteral(source, 'appKey');
    const endpoint = extractStringLiteral(source, 'endpoint');

    if (appKey && endpoint && !appKey.includes('${') && !endpoint.includes('${')) {
      return {
        appKey,
        endpoint,
        platform: detectPlatform(source),
        sourceFile: relative(cwd, file)
      };
    }
  }

  return undefined;
}

export function toApiBase(collectorEndpoint: string): string {
  const trimmed = collectorEndpoint.replace(/\/+$/, '');
  if (trimmed.endsWith('/events/batch')) {
    return trimmed.slice(0, -'/events/batch'.length);
  }
  return trimmed;
}

async function requestJson<T>(url: string, init?: RequestInit, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(init?.headers as Record<string, string>)
  };

  const response = await fetch(url, {
    ...init,
    headers
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new Error(`HealthGuard API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

export async function login(apiBase: string, credentials: Credentials): Promise<string> {
  const { token } = await requestJson<{ token: string; user: { id: string; email: string } }>(
    `${apiBase}/auth/login`,
    {
      method: 'POST',
      body: JSON.stringify({ email: credentials.username, password: credentials.password })
    }
  );
  return token;
}

export async function listApps(apiBase: string, token: string): Promise<AppRecord[]> {
  const { apps } = await requestJson<{ apps: AppRecord[] }>(`${apiBase}/apps`, undefined, token);
  return apps;
}

export async function listIssues(
  apiBase: string,
  token: string,
  appKey: string,
  options: { status?: 'archived' | 'open'; limit?: number } = {}
): Promise<IssueSummary[]> {
  const params = new URLSearchParams({ appKey });
  if (options.status === 'archived') params.set('status', 'archived');

  const { issues } = await requestJson<{ issues: IssueSummary[] }>(
    `${apiBase}/issues?${params.toString()}`,
    undefined,
    token
  );

  const sorted = issues.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  return options.limit ? sorted.slice(0, options.limit) : sorted;
}

export async function getIssueDetail(
  apiBase: string,
  token: string,
  issueId: string,
  appKey: string
): Promise<IssueDetail> {
  return requestJson<IssueDetail>(
    `${apiBase}/issues/${encodeURIComponent(issueId)}?appKey=${encodeURIComponent(appKey)}`,
    undefined,
    token
  );
}

export interface RepairReport {
  app: AppRecord | undefined;
  issue: IssueSummary;
  detail: IssueDetail;
}

export function formatReport(report: RepairReport): string {
  const { app, issue, detail } = report;
  const latest = detail.events[0];

  let markdown = `# HealthGuard Repair Report\n\n`;
  markdown += `**Project:** ${app?.name ?? issue.appKey} (${app?.type ?? 'unknown'})\n\n`;
  markdown += `**Issue:** ${issue.message}\n\n`;
  markdown += `- **Fingerprint:** \`${issue.fingerprint}\`\n`;
  markdown += `- **Error type:** ${issue.errorType}\n`;
  markdown += `- **Event count:** ${issue.eventCount}\n`;
  markdown += `- **First seen:** ${new Date(issue.firstSeenAt).toLocaleString()}\n`;
  markdown += `- **Last seen:** ${new Date(issue.lastSeenAt).toLocaleString()}\n`;
  markdown += `- **Archived:** ${issue.archived ? 'yes' : 'no'}\n\n`;

  if (latest) {
    markdown += `## Latest event\n\n`;
    markdown += `- **Environment:** ${latest.environment ?? 'unknown'}\n`;
    markdown += `- **Release:** ${latest.release ?? 'unknown'}\n`;
    markdown += `- **Page URL:** ${latest.pageUrl ?? 'unknown'}\n`;
    markdown += `- **Platform:** ${latest.platform ?? 'unknown'}\n`;
    markdown += `- **User agent:** ${(latest.deviceInfo?.userAgent as string) ?? 'unknown'}\n\n`;

    if (latest.stack) {
      markdown += `### Stack trace\n\n\`\`\`\n${latest.stack}\n\`\`\`\n\n`;
    }

    if (latest.breadcrumbs?.length) {
      markdown += `### Breadcrumbs\n\n`;
      for (const crumb of latest.breadcrumbs.slice(-10)) {
        markdown += `- [${crumb.type}] ${crumb.message} (${new Date(crumb.timestamp).toLocaleTimeString()})\n`;
      }
      markdown += '\n';
    }
  }

  markdown += `## Suggested next steps\n\n`;
  markdown += `1. Search the repo for code related to the page URL or stack trace.\n`;
  markdown += `2. Add error handling or fix the underlying promise/request.\n`;
  markdown += `3. Run tests, lint and build locally.\n`;
  markdown += `4. Verify the fix in the test environment and archive the issue in HealthGuard when resolved.\n`;

  return markdown;
}
