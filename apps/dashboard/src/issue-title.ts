import { sanitizeUrl } from '@health-guard/core';

// Historical summaries used only a path. Enrich display text from actual matching
// request evidence without rewriting stored messages or guessing a base URL.
export function issueDisplayTitle(issue: { errorType: string; message: string }, events: Array<Record<string, unknown>>): string {
  if (issue.errorType !== 'http' && issue.errorType !== 'request') return issue.message;
  const prefix = /^([A-Z]+)\s+(\/[^\s]*)([\s\S]*)$/.exec(issue.message);
  if (!prefix) return issue.message;
  const [, method, target, suffix] = prefix;
  const candidates = [...events].sort((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0));
  for (const event of candidates) {
    if (event.type !== 'http' || event.method !== method || typeof event.url !== 'string') continue;
    try {
      const url = new URL(event.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== target.split(/[?#]/, 1)[0]) continue;
      url.username = ''; url.password = ''; url.hash = '';
      return `${method} ${sanitizeUrl(url.href)}${suffix}`;
    } catch { /* Missing or relative targets cannot supply a reliable origin. */ }
  }
  return issue.message;
}
