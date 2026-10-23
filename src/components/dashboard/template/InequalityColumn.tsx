import { type Key } from 'react';
import type { DashboardTemplateColumn } from '../../../lib/dashboardTemplateTypes';
import { formatCompact, formatPercent } from './format';
import { InfoPopover } from './InfoPopover';

type PlotRow = {
  key: string;
  shortLabel: string;
  value: number;
  y: number;
  formatted: string;
};

const STRIP_WIDTH = 320;

const STRIP_HEIGHT = 68;

const TRACK_HEIGHT = 12;

const LABEL_TOP_Y = 24;

const LABEL_ROW_STEP = 18;

const VALUE_OFFSET_Y = 10;

const MIN_VISIBLE = 12;

const LABEL_CLUSTER_GAP = 58;

const EDGE_PADDING = 12;

const SEGMENT_OPACITY = [1, 0.8, 0.58, 0.34];

function buildBoundaryLabels(segments: Array<DashboardTemplateColumn['concentration'][number] & { width: number; xStart: number; xEnd: number; cumulativeShare: number }>) {
  const labels = segments.slice(0, -1).map((segment, index) => {
    const x = Math.max(EDGE_PADDING, Math.min(STRIP_WIDTH - EDGE_PADDING, segment.xEnd));
    const anchor: 'start' | 'middle' | 'end' = x <= 36 ? 'start' : x >= STRIP_WIDTH - 36 ? 'end' : 'middle';
    return {
      key: `${segment.key}-${index}`,
      x,
      title: segment.label,
      value: formatPercent(segment.cumulativeShare, 0),
      row: 0,
      anchor,
    };
  });

  let clusterStart = 0;
  for (let i = 1; i <= labels.length; i += 1) {
    const isBreak = i === labels.length || labels[i].x - labels[i - 1].x >= LABEL_CLUSTER_GAP;
    if (!isBreak) continue;
    const size = i - clusterStart;
    if (size > 1) {
      for (let j = clusterStart; j < i; j += 1) labels[j].row = j - clusterStart;
    }
    clusterStart = i;
  }

  return labels;
}

function mapLogBand(value: number, min: number, max: number, height: number) {
  const topPad = 8;
  const bottomPad = 12;
  const innerHeight = Math.max(12, height - topPad - bottomPad);
  const low = Math.log1p(Math.max(0, min));
  const high = Math.log1p(Math.max(0, max));
  if (!Number.isFinite(low) || !Number.isFinite(high) || high - low < 1e-9) {
    return topPad + innerHeight / 2;
  }
  const t = (Math.log1p(Math.max(0, value)) - low) / (high - low);
  return topPad + innerHeight - t * innerHeight;
}

function mergeRows(rows: PlotRow[]) {
  const merged: Array<{ key: string; label: string; value: string; y: number }> = [];
  rows.forEach((row) => {
    const previous = merged[merged.length - 1];
    if (previous && previous.value === row.formatted && Math.abs(previous.y - row.y) < 1) {
      previous.key = `${previous.key}-${row.key}`;
      previous.label = `${previous.label}/${row.shortLabel}`;
      return;
    }
    merged.push({ key: row.key, label: row.shortLabel, value: row.formatted, y: row.y });
  });
  return merged;
}

function ConcentrationStrip({ segments }: { segments: DashboardTemplateColumn['concentration'] }) {
  const computed = (() => {
    if (!segments.length) return [] as Array<DashboardTemplateColumn['concentration'][number] & { width: number; xStart: number; xEnd: number; cumulativeShare: number }>;
    const raw = segments.map((segment) => ({ ...segment, width: segment.share * STRIP_WIDTH, xStart: 0, xEnd: 0, cumulativeShare: 0 }));
    const tiny = raw.filter((segment) => segment.share > 0 && segment.width < MIN_VISIBLE);
    const large = raw.filter((segment) => segment.width >= MIN_VISIBLE);
    let deficit = 0;
    tiny.forEach((segment) => {
      deficit += MIN_VISIBLE - segment.width;
      segment.width = MIN_VISIBLE;
    });
    const largeTotal = large.reduce((acc, segment) => acc + segment.width, 0);
    large.forEach((segment) => {
      if (largeTotal > 0) segment.width -= (segment.width / largeTotal) * deficit;
    });
    let cursor = 0;
    let cumulativeShare = 0;
    raw.forEach((segment, index) => {
      segment.xStart = cursor;
      cursor += index === raw.length - 1 ? STRIP_WIDTH - cursor : Math.max(0, segment.width);
      segment.xEnd = cursor;
      cumulativeShare += segment.share;
      segment.cumulativeShare = cumulativeShare;
    });
    return raw;
  })();

  const labels = buildBoundaryLabels(computed);

  return (
    <div className="strip-wrap">
      <svg className="strip" viewBox={`0 0 ${STRIP_WIDTH} ${STRIP_HEIGHT}`} aria-label="Concentration strip">
        <rect x="0" y="0" width={STRIP_WIDTH} height={TRACK_HEIGHT} className="strip-track" />
        {computed.map((segment, index) => (
          <g key={segment.key}>
            <rect x={segment.xStart} y="0" width={Math.max(0, segment.width)} height={TRACK_HEIGHT} fill="var(--accent-strong)" opacity={SEGMENT_OPACITY[index] ?? 0.25} />
            {index > 0 ? <line x1={segment.xStart} y1="0" x2={segment.xStart} y2={TRACK_HEIGHT} className="strip-divider" /> : null}
          </g>
        ))}
        {labels.map((label) => {
          const groupTopY = LABEL_TOP_Y + label.row * LABEL_ROW_STEP;
          const tickBottomY = groupTopY - 4;
          return (
            <g key={label.key}>
              <line x1={label.x} y1={TRACK_HEIGHT} x2={label.x} y2={tickBottomY} className="strip-tick" />
              <text x={label.x} y={groupTopY} className="strip-text strip-text-label" textAnchor={label.anchor}>{label.title}</text>
              <text x={label.x} y={groupTopY + VALUE_OFFSET_Y} className="strip-text strip-text-value" textAnchor={label.anchor}>{label.value}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function LogBoxplot({ stats, metricLabel }: { stats: DashboardTemplateColumn['boxStats']; metricLabel: string }) {
  const width = 244;
  const plotHeight = 170;
  const footerHeight = 20;
  const totalHeight = plotHeight + footerHeight;
  const plotLeft = 22;
  const plotRight = width - 14;
  const centerX = 58;
  const labelX = 110;
  const domainMin = Math.min(stats.p10, stats.q1, stats.median, stats.q3, stats.p90);
  const domainMax = Math.max(stats.p10, stats.q1, stats.median, stats.q3, stats.p90, 1);

  const baseRows: Array<Pick<PlotRow, 'key' | 'shortLabel' | 'value'>> = [
    { key: 'p90', shortLabel: 'p90', value: stats.p90 },
    { key: 'q3', shortLabel: 'q3', value: stats.q3 },
    { key: 'median', shortLabel: 'med', value: stats.median },
    { key: 'q1', shortLabel: 'q1', value: stats.q1 },
    { key: 'p10', shortLabel: 'p10', value: stats.p10 },
  ];

  const rows: PlotRow[] = baseRows.map((row) => ({
    ...row,
    y: mapLogBand(row.value, domainMin, domainMax, plotHeight),
    formatted: formatCompact(row.value),
  }));

  const mergedRows = mergeRows(rows);
  const yP10 = rows.find((row) => row.key === 'p10')?.y ?? plotHeight;
  const yQ1 = rows.find((row) => row.key === 'q1')?.y ?? plotHeight;
  const yMedian = rows.find((row) => row.key === 'median')?.y ?? plotHeight;
  const yQ3 = rows.find((row) => row.key === 'q3')?.y ?? plotHeight;
  const yP90 = rows.find((row) => row.key === 'p90')?.y ?? 0;

  return (
    <div className="plot-wrap">
      <div className="metric-label metric-label-row">
        <span>{metricLabel}</span>
        <InfoPopover
          label={metricLabel}
          oneLine="A log-scaled distribution view using p10, q1, median, q3, and p90."
          method="The five quantiles are mapped into vertical coordinates through log1p interpolation between the local minimum and maximum. This keeps huge outliers from visually crushing the rest of the distribution while preserving order and relative distance."
          codeSnippet={`function mapLogBand(value: number, min: number, max: number, height: number) {
  const low = Math.log1p(Math.max(0, min));
  const high = Math.log1p(Math.max(0, max));
  const t = (Math.log1p(Math.max(0, value)) - low) / (high - low);
  return topPad + innerHeight - t * innerHeight;
}`}
          codeExplanation="The snippet converts raw values into log space before drawing them. That means a jump from 100 to 1,000 does not dominate the chart in the same way it would on a linear scale, which makes heavy-tailed YouTube metrics easier to compare."
        />
      </div>
      <svg className="boxplot" viewBox={`0 0 ${width} ${totalHeight}`} aria-label={metricLabel}>
        <line x1={centerX} y1={yP90} x2={centerX} y2={yP10} className="plot-line plot-whisker" />
        <line x1={centerX - 18} y1={yP90} x2={centerX + 18} y2={yP90} className="plot-line" />
        <line x1={centerX - 18} y1={yP10} x2={centerX + 18} y2={yP10} className="plot-line" />
        <rect x={centerX - 24} y={yQ3} width={48} height={Math.max(10, yQ1 - yQ3)} className="plot-box" />
        <line x1={centerX - 24} y1={yMedian} x2={centerX + 24} y2={yMedian} className="plot-line plot-median" />

        {mergedRows.map((row) => (
          <g key={row.key} className="plot-annotation">
            <line x1={centerX + 28} y1={row.y} x2={labelX - 10} y2={row.y} className="plot-guide" />
            <text x={labelX} y={row.y + 4} className="plot-text plot-text-label">{row.label}</text>
            <text x={plotRight} y={row.y + 4} className="plot-text plot-text-value" textAnchor="end">{row.value}</text>
          </g>
        ))}

        <text x={plotLeft} y={totalHeight - 2} className="plot-text plot-text-footer">min {formatCompact(stats.min)}</text>
        <text x={plotRight} y={totalHeight - 2} className="plot-text plot-text-footer" textAnchor="end">max {formatCompact(stats.max)}</text>
      </svg>
    </div>
  );
}

function RankList({
  title,
  items,
  onNavigateToItem,
}: {
  title: string;
  items: DashboardTemplateColumn['ranking'];
  onNavigateToItem?: (item: DashboardTemplateColumn['ranking'][number]) => void;
}) {
  return (
    <div className="rank-wrap">
      <div className="section-title section-title-row">
        <span>{title}</span>
        <InfoPopover
          label={title}
          oneLine="Top 5 entities ranked by raw metric value."
          method="Items are sorted descending by the relevant metric and the list keeps the first five entries. Each row bar is normalized by the metric total, so the bar length shows share of the total rather than raw count."
          codeSnippet={`return items.slice(0, 5).map((item, index) => ({
  rank: index + 1,
  rawValue: item.value,
  share: total > 0 ? item.value / total : 0,
}));`}
          codeExplanation="This is a simple rank-and-normalize step. The list answer is who leads; the bars answer how much of the total they account for."
        />
      </div>
      <div className="rank-list">
        {items.map((item) => {
          const isNavigable = Boolean(item.videoId || item.channelId || item.channelName);
          return (
            <div key={`${item.rank}-${item.fullLabel}`} className="rank-item">
              <div className="rank-num">{String(item.rank).padStart(2, '0')}</div>
              <div className="rank-main">
                {isNavigable ? (
                  <button
                    type="button"
                    className="rank-label text-left transition-colors hover:text-[var(--accent)]"
                    title={item.fullLabel}
                    onClick={() => onNavigateToItem?.(item)}
                  >
                    {item.label}
                  </button>
                ) : (
                  <div className="rank-label" title={item.fullLabel}>{item.label}</div>
                )}
                <div className="rank-bar-track" aria-label={`${item.fullLabel} share bar`}>
                  <div className="rank-bar-fill" style={{ width: `${Math.max(item.share * 100, item.share > 0 ? 1.5 : 0)}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function InequalityColumn({
  column,
  onNavigateToItem,
}: {
  column: DashboardTemplateColumn;
  key?: Key;
  onNavigateToItem?: (item: DashboardTemplateColumn['ranking'][number]) => void;
}) {
  if (!column.available) {
    return (
      <section className="dashboard-column unavailable">
        <div className="column-title-row"><div className="column-title">{column.title}</div></div>
        <div className="unavailable-card">
          <div className="unavailable-title">unavailable</div>
          <div className="unavailable-copy">missing: {(column.missingFields ?? []).join(', ')}</div>
        </div>
      </section>
    );
  }

  const entityCount = column.boxStats.sampleSize;

  return (
    <section className={`dashboard-column column-${column.key}`}>
      <div className="column-top">
        <div className="column-title-row">
          <div className="column-title section-title-row">
            <span>{column.title}</span>
            <InfoPopover
              label={`${column.title} entities`}
              oneLine="Entity count for this column's aggregation level."
              method="The count comes from the sampleSize saved in boxStats. It reflects the number of ranked units used to compute all concentration slices, quantiles, and ranking lists in the column."
              codeSnippet={`const boxStats = computeBoxStats(values);
return {
  ...,
  boxStats: {
    ...boxStats,
    sampleSize: ranked.length
  }
};`}
              codeExplanation="The count is not decorative. It tells you how many units the entire column is based on, which is crucial when you compare concentration across videos, channels, and comments."
            />
          </div>
          {typeof entityCount === 'number' ? <div className="column-entity-count">= {entityCount}</div> : null}
        </div>

        <div className="section-title section-title-row strip-title">
          <span>cumulative attention share</span>
          <InfoPopover
            label={`${column.title} cumulative share`}
            oneLine="Shows how much total attention is captured by ranked top groups."
            method="The ranked values are sliced into top buckets, each bucket's raw sum is divided by the total, and the labels mark cumulative checkpoints such as top 1, top 5, or top 10 percent depending on the column."
            codeSnippet={`return [
  { key: 'top1', share: sum(top1.map((item) => item.value)) / total },
  { key: 'nextBucket', share: sum(nextBucket.map((item) => item.value)) / total },
  { key: 'restTop10', share: sum(restTop10.map((item) => item.value)) / total },
  { key: 'rest90', share: sum(rest90.map((item) => item.value)) / total },
];`}
            codeExplanation="Each segment is a share of the whole metric total. When the early segments dominate, the dataset is highly concentrated."
          />
        </div>
        <ConcentrationStrip segments={column.concentration} />
      </div>

      <div className="column-middle">
        <LogBoxplot stats={column.boxStats} metricLabel={column.metricLabel} />
      </div>

      <div className="column-bottom">
        <RankList title={column.rankingTitle} items={column.ranking} onNavigateToItem={onNavigateToItem} />
      </div>
    </section>
  );
}
