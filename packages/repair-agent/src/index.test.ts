import { describe, expect, it } from 'vitest';
import { extractStringLiteral, toApiBase } from './index';

describe('repair-agent helpers', () => {
  it('converts collector endpoint to api base', () => {
    expect(toApiBase('https://hg.example.com/api/events/batch')).toBe('https://hg.example.com/api');
    expect(toApiBase('https://hg.example.com/api/events/batch/')).toBe('https://hg.example.com/api');
    expect(toApiBase('https://hg.example.com/api')).toBe('https://hg.example.com/api');
  });

  it('extracts string literals from source', () => {
    const source = `
      const client = createHealthGuardClient({
        appKey: 'demo-app',
        endpoint: "https://hg.example.com/api/events/batch",
      });
    `;

    expect(extractStringLiteral(source, 'appKey')).toBe('demo-app');
    expect(extractStringLiteral(source, 'endpoint')).toBe('https://hg.example.com/api/events/batch');
  });

  it('ignores template placeholders', () => {
    const source = `
      createHealthGuardClient({
        appKey: \`\${appKey.value}\`,
        endpoint: "https://hg.example.com/api/events/batch"
      });
    `;

    expect(extractStringLiteral(source, 'appKey')).toBeUndefined();
  });
});
