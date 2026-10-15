import { h } from 'vue';
import { networkDiagnosticLines } from '@health-guard/core';
export function renderNetworkDiagnostic(event: { networkDiagnostic?: unknown; context?: unknown }, language: 'zh' | 'en') {
  const lines = networkDiagnosticLines(event, language);
  if (!lines.length) return null;
  return h('section', { class: 'network-diagnostic' }, [
    h('strong', lines[0]),
    ...lines.slice(1).map((line) => h('p', line))
  ]);
}
