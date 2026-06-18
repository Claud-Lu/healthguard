#!/usr/bin/env node
import type { Credentials, IssueDetail, IssueSummary } from './index.js';
import {
  discoverSdkConfig,
  formatReport,
  getIssueDetail,
  listApps,
  listIssues,
  login,
  searchSourceFiles,
  toApiBase
} from './index.js';

interface CliOptions {
  cwd: string;
  apiBase?: string;
  username?: string;
  password?: string;
  appKey?: string;
  issueId?: string;
  limit: number;
  search: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    cwd: process.cwd(),
    limit: 5,
    search: true
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--cwd':
        options.cwd = next;
        i += 1;
        break;
      case '--api-base':
        options.apiBase = next;
        i += 1;
        break;
      case '--username':
        options.username = next;
        i += 1;
        break;
      case '--password':
        options.password = next;
        i += 1;
        break;
      case '--app-key':
        options.appKey = next;
        i += 1;
        break;
      case '--issue':
        options.issueId = next;
        i += 1;
        break;
      case '--limit':
        options.limit = Number(next) || 5;
        i += 1;
        break;
      case '--no-search':
        options.search = false;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
healthguard-repair-agent

Fetches HealthGuard issues for the current project so Claude Code can fix them.

Usage:
  npx @health-guard/repair-agent [options]

Options:
  --cwd <path>       Project root to scan for SDK config (default: cwd)
  --api-base <url>   HealthGuard API base URL (e.g. https://hg.example.com/api)
  --username <email> HealthGuard login email
  --password <pass>  HealthGuard login password
  --app-key <key>    Override the appKey discovered from SDK config
  --issue <id>       Fetch detail for a specific issue instead of listing top issues
  --limit <n>        Number of issues to list (default: 5)
  --no-search        Skip local source file search
  -h, --help         Show this help

Environment variables (used as fallback):
  HEALTHGUARD_API_BASE
  HEALTHGUARD_USERNAME
  HEALTHGUARD_PASSWORD
  HEALTHGUARD_APP_KEY
`);
}

function resolveCredentials(options: CliOptions): Credentials {
  const username = options.username ?? process.env.HEALTHGUARD_USERNAME;
  const password = options.password ?? process.env.HEALTHGUARD_PASSWORD;

  if (!username || !password) {
    console.error(
      'HealthGuard credentials are required. Pass --username and --password, or set HEALTHGUARD_USERNAME and HEALTHGUARD_PASSWORD.'
    );
    process.exit(1);
  }

  return { username, password };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const discoveredConfig = discoverSdkConfig(options.cwd);

  if (discoveredConfig) {
    console.error(`Discovered SDK config in ${discoveredConfig.sourceFile}`);
    console.error(`  appKey: ${discoveredConfig.appKey}`);
    console.error(`  platform: ${discoveredConfig.platform}`);
  }

  const apiBase =
    options.apiBase ??
    process.env.HEALTHGUARD_API_BASE ??
    (discoveredConfig ? toApiBase(discoveredConfig.endpoint) : undefined);

  if (!apiBase) {
    console.error(
      'Could not determine HealthGuard API base. Pass --api-base or set HEALTHGUARD_API_BASE, or place SDK config in the project.'
    );
    process.exit(1);
  }

  const appKey =
    options.appKey ??
    process.env.HEALTHGUARD_APP_KEY ??
    discoveredConfig?.appKey;

  if (!appKey) {
    console.error(
      'Could not determine appKey. Pass --app-key or set HEALTHGUARD_APP_KEY, or place SDK config in the project.'
    );
    process.exit(1);
  }

  const credentials = resolveCredentials(options);

  console.error(`Logging in to ${apiBase}...`);
  const token = await login(apiBase, credentials);
  console.error('Logged in.');

  const apps = await listApps(apiBase, token);
  const app = apps.find((a) => a.appKey === appKey);

  if (options.issueId) {
    const detail = await getIssueDetail(apiBase, token, options.issueId, appKey);
    const report = formatReport({ app, issue: detail.issue, detail });
    console.log(report);
    if (options.search) {
      printSourceMatches(detail.issue, detail, options.cwd);
    }
    return;
  }

  console.error(`Fetching issues for ${appKey}...`);
  const issues = await listIssues(apiBase, token, appKey, { limit: options.limit });

  if (issues.length === 0) {
    console.log(`No open issues found for ${appKey}.`);
    return;
  }

  console.log(`# HealthGuard Issues for ${app?.name ?? appKey}\n`);
  for (let i = 0; i < issues.length; i += 1) {
    const issue = issues[i];
    console.log(`${i + 1}. **${issue.message}** (${issue.errorType}, ${issue.eventCount} events)`);
    console.log(`   - ID: \`${issue.id}\``);
    console.log(`   - Last seen: ${new Date(issue.lastSeenAt).toLocaleString()}`);
    console.log(`   - Fingerprint: \`${issue.fingerprint}\``);
    console.log();
  }

  const topIssue = issues[0];
  console.error(`Fetching detail for top issue: ${topIssue.id}...`);
  const detail = await getIssueDetail(apiBase, token, topIssue.id, appKey);
  const report = formatReport({ app, issue: topIssue, detail });
  console.log('---');
  console.log(report);

  if (options.search) {
    printSourceMatches(topIssue, detail, options.cwd);
  }
}

function printSourceMatches(issue: IssueSummary, detail: IssueDetail, cwd: string): void {
  console.error('Searching local source files for relevant code...');
  const matches = searchSourceFiles(cwd, issue, detail, { maxFiles: 5 });

  if (matches.length === 0) {
    console.log('\n_No matching source files found. Try providing source maps or build a development build._');
    return;
  }

  console.log('\n## Likely source files\n');
  for (const match of matches) {
    console.log(`- **${match.file}** (score: ${match.score})`);
    for (const excerpt of match.excerpts.slice(0, 2)) {
      console.log(`  \`\`\`\n  ${excerpt}\n  \`\`\``);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
