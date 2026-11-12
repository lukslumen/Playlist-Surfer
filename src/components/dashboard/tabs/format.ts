// Number formatting shared by the dashboard tabs.

export const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
export const whole = new Intl.NumberFormat('en-US');

export function percent(share: number, digits = 0): string {
  if (!Number.isFinite(share)) return '—';
  if (share > 0 && share < 0.01 && digits === 0) return '<1%';
  return `${(share * 100).toFixed(digits)}%`;
}

export function rate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value < 10 ? value.toFixed(1) : whole.format(Math.round(value));
}

export function times(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value >= 10 ? `${Math.round(value)}×` : `${value.toFixed(1)}×`;
}

export const METRIC_LABEL = { views: 'views', likes: 'likes', comments: 'comments' } as const;
