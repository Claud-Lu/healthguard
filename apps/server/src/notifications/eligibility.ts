import type { HealthGuardEvent } from '@health-guard/core';
import { pageAddress } from './content';

// Filter notification creation only: local events remain available for debugging.
export function isLocalDevelopmentEvent(event: HealthGuardEvent): boolean {
  if (event.environment === 'development') return true;

  // Native WebViews can use localhost in released apps. A failed request to
  // loopback also does not prove that the page itself is running locally.
  if (event.platform !== 'web' && event.platform !== 'uniapp-h5') return false;
  const page = pageAddress(event)?.trim();
  if (!page) return false;
  try {
    const url = new URL(page.startsWith('//') ? `http:${page}` : page);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0'
      || /^127\.\d+\.\d+\.\d+$/.test(host) || host === '[::1]'
      || /^\[::ffff:7f[\da-f]{2}:[\da-f]{1,4}\]$/.test(host);
  } catch {
    return false;
  }
}
