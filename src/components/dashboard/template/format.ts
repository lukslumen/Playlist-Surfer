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

export function displayScopeLabel(snapshot: DashboardTemplateSnapshot) {
  const datasetLower = snapshot.datasetLabel.toLowerCase();
  if (datasetLower.includes('sample')) return 'sampled set';
  return snapshot.scopeLabel;
}

export const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
