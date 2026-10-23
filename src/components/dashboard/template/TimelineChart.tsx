import { type ReactNode } from 'react';
import type { DashboardTemplateSnapshot } from '../../../lib/dashboardTemplateTypes';

const AXIS_MONTH_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});

const AXIS_DAY_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  timeZone: 'UTC',
});

function axisLabel(ts: number, rangeDays: number): string {
  if (rangeDays <= 95) return AXIS_DAY_FMT.format(ts);
  return AXIS_MONTH_FMT.format(ts);
}

function tickIndices(length: number): number[] {
  if (length <= 1) return [0];
  if (length <= 3) return Array.from({ length }, (_, index) => index);
  const raw = [0, Math.floor((length - 1) / 3), Math.floor(((length - 1) * 2) / 3), length - 1];
  return [...new Set(raw)].sort((a, b) => a - b);
}

type TimelineSeriesKey = 'upload' | 'channelAge';

export function TimelineChart({
  snapshot,
  series = 'upload',
  emptyMessage,
  ariaLabel,
}: {
  snapshot: DashboardTemplateSnapshot;
  series?: TimelineSeriesKey;
  emptyMessage?: ReactNode;
  ariaLabel?: string;
}) {
  const isChannelAge = series === 'channelAge';
  const points = isChannelAge ? (snapshot.provenance.channelAgeSeries || []) : snapshot.provenance.timeSeries;
  const timestamps = isChannelAge ? (snapshot.provenance.channelAgeTimestamps || []) : snapshot.provenance.uploadTimestamps;
  const minTs = isChannelAge ? snapshot.provenance.channelAgeMinTs : snapshot.provenance.minTs;
  const maxTs = isChannelAge ? snapshot.provenance.channelAgeMaxTs : snapshot.provenance.maxTs;

  if (!points.length) {
    return <div className="provenance-empty">{emptyMessage || <>No valid <code>publishedAt</code> timestamps found.</>}</div>;
  }

  const width = 1160;
  const height = 340;
  const padLeft = 36;
  const padRight = 18;
  const padTop = 14;
  const padBottom = 44;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const baselineY = padTop + plotHeight;
  const maxCount = Math.max(1, ...points.map((point) => point.count));
  const step = points.length > 0 ? plotWidth / points.length : plotWidth;
  const barWidth = Math.max(2, Math.min(16, step * 0.82));
  const rangeDenominator = minTs !== null && maxTs !== null
    ? Math.max(1, maxTs - minTs)
    : 1;
  const effectiveMinTs = minTs ?? points[0].startTs;
  const effectiveMaxTs = maxTs ?? points[points.length - 1].startTs;
  const rangeDays = Math.max(1, Math.round((effectiveMaxTs - effectiveMinTs) / (24 * 60 * 60 * 1000)));
  const labels = tickIndices(points.length).map((index) => ({
    x: padLeft + step * index + step / 2,
    text: axisLabel(points[index].startTs, rangeDays),
    key: `${index}-${points[index].startTs}`,
  }));

  const toY = (value: number) => baselineY - (Math.max(value, 0) / maxCount) * plotHeight;
  const movingPath = points.map((point, index) => {
    const x = padLeft + step * index + step / 2;
    const y = toY(point.movingAvg);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

  return (
    <svg className="provenance-timeline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel || (isChannelAge ? 'Channel ages over time' : 'Upload counts over time')}>
      {[0.25, 0.5, 0.75, 1].map((t) => {
        const y = baselineY - plotHeight * t;
        return <line key={`grid-${t}`} className="prov-grid" x1={padLeft} y1={y} x2={width - padRight} y2={y} />;
      })}
      {points.map((point, index) => {
        const x = padLeft + step * index + (step - barWidth) / 2;
        const barTop = toY(point.count);
        const barHeight = baselineY - barTop;
        return <rect key={point.key} className="prov-bar" x={x} y={barTop} width={barWidth} height={Math.max(1, barHeight)} />;
      })}
      <path className="prov-line" d={movingPath} />
      {timestamps.slice(0, 1800).map((ts, index) => {
        const x = padLeft + ((ts - (minTs ?? ts)) / rangeDenominator) * plotWidth;
        return <line key={`rug-${index}-${ts}`} className="prov-rug" x1={x} y1={baselineY + 6} x2={x} y2={baselineY + 10} />;
      })}
      <line className="prov-axis" x1={padLeft} y1={baselineY} x2={width - padRight} y2={baselineY} />
      {labels.map((label) => (
        <text key={label.key} className="prov-axis-label" x={label.x} y={baselineY + 26} textAnchor="middle">{label.text}</text>
      ))}
    </svg>
  );
}
