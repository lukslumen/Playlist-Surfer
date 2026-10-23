import type { DashboardTemplateSnapshot } from '../../../lib/dashboardTemplateTypes';

function trim(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(0);
  return value.toFixed(1).replace(/\.0$/, '');
}

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${trim(value / 1_000_000_000)}b`;
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}m`;
  if (abs >= 1_000) return `${trim(value / 1_000)}k`;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function formatPercent(share: number, digits = 1): string {
  if (!Number.isFinite(share)) return '—';
  return `${(share * 100).toFixed(digits)}%`;
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall back
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export function displayScopeLabel(snapshot: DashboardTemplateSnapshot) {
  const datasetLower = snapshot.datasetLabel.toLowerCase();
  if (datasetLower.includes('sample')) return 'sampled set';
  return snapshot.scopeLabel;
}

export function statusClass(status: DashboardTemplateSnapshot['overview']['overallStatus']): string {
  if (status === 'good') return 'status-good';
  if (status === 'usable with caveats') return 'status-caveat';
  if (status === 'limited') return 'status-limited';
  return 'status-poor';
}

export function severityClass(severity: 'low' | 'warning' | 'high'): string {
  if (severity === 'high') return 'is-high';
  if (severity === 'warning') return 'is-warning';
  return 'is-low';
}

export const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
