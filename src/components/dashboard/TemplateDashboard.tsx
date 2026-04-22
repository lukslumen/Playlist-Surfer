import { useEffect, useMemo, useState, type Key, type ReactNode } from 'react';
import type {
  DashboardTemplateColumn,
  DashboardTemplateCountStat,
  DashboardTemplateLanguageRow,
  DashboardTemplateSnapshot,
} from '../../lib/dashboardTemplateTypes';
import { rangeOf } from '../../lib/largeData';
import type { DashboardTemplateTab } from '../../types';
import './templateExact.css';

type ContentFilterKind = 'category' | 'topic' | 'duration' | 'intent';

type Props = {
  snapshot?: DashboardTemplateSnapshot;
  calculatedAt: string;
  controls?: ReactNode;
  toolbarCenter?: ReactNode;
  activeTab?: DashboardTemplateTab;
  onTabChange?: (tab: DashboardTemplateTab) => void;
  thumbnailsContent?: ReactNode;
  linkingContent?: ReactNode;
  emptyStateContent?: ReactNode;
  fullscreenMode?: boolean;
  onNavigateToItem?: (item: DashboardTemplateColumn['ranking'][number]) => void;
  onApplyContentFilter?: (kind: ContentFilterKind, label: string) => void;
  allChannelIds?: string[];
};

type InfoProps = {
  label: string;
  oneLine: string;
  method: string;
  codeSnippet: string;
  codeExplanation?: string;
};

type CountListProps = {
  title: string;
  items: DashboardTemplateCountStat[];
  tone?: 'video' | 'channel' | 'engagement';
  info: InfoProps;
  onItemSelect?: (label: string) => void;
};

type KeywordCloudProps = {
  title: string;
  items: DashboardTemplateCountStat[];
  tone?: 'video' | 'channel' | 'engagement';
  info: InfoProps;
};

type CloudWord = {
  label: string;
  count: number;
  share: number;
  size: number;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotate: number;
  isCore: boolean;
};

type WordRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PlotRow = {
  key: string;
  shortLabel: string;
  value: number;
  y: number;
  formatted: string;
};

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

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

const RANK_SIZES = [17, 16, 15, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9];
const CLOUD_WIDTH = 980;
const CLOUD_HEIGHT = 236;
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

function trim(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(0);
  return value.toFixed(1).replace(/\.0$/, '');
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${trim(value / 1_000_000_000)}b`;
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}m`;
  if (abs >= 1_000) return `${trim(value / 1_000)}k`;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(share: number, digits = 1): string {
  if (!Number.isFinite(share)) return '—';
  return `${(share * 100).toFixed(digits)}%`;
}

async function copyText(text: string) {
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

function displayScopeLabel(snapshot: DashboardTemplateSnapshot) {
  const datasetLower = snapshot.datasetLabel.toLowerCase();
  if (datasetLower.includes('sample')) return 'sampled set';
  return snapshot.scopeLabel;
}

function statusClass(status: DashboardTemplateSnapshot['overview']['overallStatus']): string {
  if (status === 'good') return 'status-good';
  if (status === 'usable with caveats') return 'status-caveat';
  if (status === 'limited') return 'status-limited';
  return 'status-poor';
}

function severityClass(severity: 'low' | 'warning' | 'high'): string {
  if (severity === 'high') return 'is-high';
  if (severity === 'warning') return 'is-warning';
  return 'is-low';
}

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

function estimateWordBox(label: string, size: number): { width: number; height: number } {
  const rawWidth = label.length * size * 0.62 + size * 1.8;
  const width = Math.max(size * 2.6, Math.min(rawWidth, CLOUD_WIDTH * 0.56));
  return {
    width,
    height: size * 1.18,
  };
}

function intersects(a: WordRect, b: WordRect, pad = 5): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width + pad * 2
    && Math.abs(a.y - b.y) * 2 < a.height + b.height + pad * 2
  );
}

function insideEllipse(rect: WordRect): boolean {
  const cx = CLOUD_WIDTH / 2;
  const cy = CLOUD_HEIGHT / 2;
  const rx = CLOUD_WIDTH * 0.49 - rect.width / 2;
  const ry = CLOUD_HEIGHT * 0.46 - rect.height / 2;
  if (rx <= 0 || ry <= 0) return false;
  const dx = (rect.x - cx) / rx;
  const dy = (rect.y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function buildCloudWords(items: DashboardTemplateCountStat[]): CloudWord[] {
  const sorted = [...items].sort((a, b) => b.share - a.share);
  if (!sorted.length) return [];

  const placedRects: WordRect[] = [];
  const placedWords: CloudWord[] = [];
  const centerX = CLOUD_WIDTH / 2;
  const centerY = CLOUD_HEIGHT / 2;
  const ringSteps = [0.2, 0.34, 0.48, 0.6, 0.72, 0.82, 0.9];

  const core = sorted[0];
  const coreSize = 31;
  const coreBox = estimateWordBox(core.label, coreSize);
  const coreRect: WordRect = { x: centerX, y: centerY, width: coreBox.width, height: coreBox.height };
  placedRects.push(coreRect);
  placedWords.push({
    ...core,
    size: coreSize,
    opacity: 0.96,
    x: centerX,
    y: centerY,
    width: coreBox.width,
    height: coreBox.height,
    rotate: 0,
    isCore: true,
  });

  const maxWords = Math.min(sorted.length, 42);
  for (let i = 1; i < maxWords; i += 1) {
    const item = sorted[i];
    const baseSize = Math.max(10, 20 - Math.floor(i / 3));
    let placed = false;

    for (let shrink = 0; shrink < 5 && !placed; shrink += 1) {
      const size = Math.max(10, baseSize - shrink);
      const box = estimateWordBox(item.label, size);

      for (let ringIndex = 0; ringIndex < ringSteps.length && !placed; ringIndex += 1) {
        const ring = ringSteps[ringIndex];
        const radiusX = (CLOUD_WIDTH * 0.46) * ring;
        const radiusY = (CLOUD_HEIGHT * 0.42) * ring;
        const circumference = 2 * Math.PI * Math.max(radiusX, radiusY);
        const slots = Math.max(8, Math.round(circumference / Math.max(box.width * 0.9, 68)));

        for (let slot = 0; slot < slots && !placed; slot += 1) {
          const angle = ((slot / slots) * Math.PI * 2) + (ringIndex * 0.24) + (i * 0.17);
          const x = centerX + Math.cos(angle) * radiusX;
          const y = centerY + Math.sin(angle) * radiusY;
          const rect: WordRect = { x, y, width: box.width, height: box.height };
          const pad = i < 7 ? 8 : i < 18 ? 6 : 4;

          if (!insideEllipse(rect)) continue;
          if (placedRects.some((existing) => intersects(rect, existing, pad))) continue;

          placedRects.push(rect);
          placedWords.push({
            ...item,
            size,
            opacity: Math.max(0.48, 0.84 - (i * 0.015)),
            x,
            y,
            width: box.width,
            height: box.height,
            rotate: 0,
            isCore: false,
          });
          placed = true;
        }
      }
    }
  }

  return placedWords;
}

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

function InfoPopover({ label, oneLine, method, codeSnippet, codeExplanation }: InfoProps) {
  const [open, setOpen] = useState(false);
  const id = useMemo(() => `metric-info-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, [label]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const sections = [
    { title: 'What this shows', body: oneLine },
    { title: 'How it is constructed', body: method },
    ...(codeExplanation ? [{ title: 'How to read it', body: codeExplanation }] : []),
  ];

  return (
    <span className="info-wrap">
      <button
        type="button"
        className="info-button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`How ${label} is calculated`}
        onClick={() => setOpen((current) => !current)}
      >
        i
      </button>

      {open ? (
        <div className="info-overlay" onClick={() => setOpen(false)}>
          <div className="info-popover" id={id} role="dialog" aria-label={`${label} explanation`} onClick={(event) => event.stopPropagation()}>
            <div className="info-head">
              <div>
                <div className="info-title">{label}</div>
                <div className="info-summary">{oneLine}</div>
              </div>
              <button type="button" className="info-close" onClick={() => setOpen(false)} aria-label="Close metric explanation">×</button>
            </div>
            <div className="info-method-copy">
              {sections.map((section) => (
                <section key={section.title} className="info-method-section">
                  <div className="info-method-title">{section.title}</div>
                  <p className="info-method-paragraph">{section.body}</p>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </span>
  );
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

function InequalityColumn({
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

type TimelineSeriesKey = 'upload' | 'channelAge';

function TimelineChart({
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

function LanguageOverview({ rows }: { rows: DashboardTemplateLanguageRow[] }) {
  if (!rows.length) return <div className="provenance-empty">No language fields available.</div>;
  return (
    <div className="language-compare-grid">
      <div className="language-compare-head"><span /><span>declared</span><span>audio</span></div>
      <div className="provenance-language-list">
        {rows.slice(0, 7).map((row) => (
          <div className="provenance-language-row" key={row.label}>
            <div className="provenance-language-code">{row.label}</div>
            <div className="language-track-cell">
              <div className="provenance-language-track"><div className="provenance-language-fill declared" style={{ width: `${Math.max(row.declaredShare * 100, row.declaredCount > 0 ? 1.5 : 0)}%` }} /></div>
              <div className="provenance-language-values">{formatPercent(row.declaredShare, 0)}</div>
            </div>
            <div className="language-track-cell">
              <div className="provenance-language-track"><div className="provenance-language-fill audio" style={{ width: `${Math.max(row.audioShare * 100, row.audioCount > 0 ? 1.5 : 0)}%` }} /></div>
              <div className="provenance-language-values">{formatPercent(row.audioShare, 0)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OverviewTab({ snapshot, calculatedAt, allChannelIds = [] }: { snapshot: DashboardTemplateSnapshot; calculatedAt: string; allChannelIds?: string[] }) {
  const insights = snapshot.overview;
  const provenance = snapshot.provenance;
  const coverageValues = insights.coverage.map((metric) => metric.presentShare);
  const coverageRange = rangeOf(coverageValues, 0, 0);
  const maxCoverage = coverageRange.max;
  const minCoverage = coverageRange.min;
  const coverageUneven = maxCoverage - minCoverage >= 0.28;
  const firstCaveat = insights.caveats[0];
  const malformedDateRate = insights.totalVideos > 0 ? insights.malformedDateCount / insights.totalVideos : 0;
  const caveatAuditText = insights.caveats.length
    ? insights.caveats.map((caveat, index) => `${index + 1}. [${caveat.severity}] ${caveat.text}`).join('\n')
    : 'No caveats generated by the quality pipeline.';

  const toolbarItems = [
    { key: 'dataset', label: 'dataset', value: snapshot.datasetLabel },
    { key: 'source', label: 'source', value: snapshot.sourceLabel },
    { key: 'snapshot', label: 'snapshot', value: DATE_FMT.format(new Date(calculatedAt || snapshot.snapshotTs).getTime()) },
    { key: 'scope', label: 'scope', value: displayScopeLabel(snapshot) },
    { key: 'views', label: 'views', value: formatCompact(insights.totalViews) },
    { key: 'videos', label: 'videos', value: String(insights.totalVideos) },
    { key: 'channels', label: 'channels', value: String(insights.uniqueChannels) },
    { key: 'comments', label: 'comments', value: formatCompact(insights.totalComments) },
    { key: 'likes', label: 'likes', value: formatCompact(insights.totalLikes) },
  ];

  const qualityRows: Array<{ label: string; value: string; severity: 'low' | 'warning' | 'high' }> = [
    { label: 'duplicate videos', value: formatPercent(insights.duplicateRate, 1), severity: insights.duplicateRate >= 0.05 ? 'high' : insights.duplicateRate >= 0.01 ? 'warning' : 'low' },
    { label: 'duplicate rows', value: formatPercent(insights.exactDuplicateRowRate, 1), severity: insights.exactDuplicateRowRate >= 0.05 ? 'high' : insights.exactDuplicateRowRate >= 0.01 ? 'warning' : 'low' },
    { label: 'zero comments', value: formatPercent(insights.zeroCommentRate, 1), severity: insights.zeroCommentRate >= 0.5 ? 'high' : insights.zeroCommentRate >= 0.3 ? 'warning' : 'low' },
    { label: 'channels once', value: formatPercent(insights.oneVideoChannelShare, 1), severity: insights.oneVideoChannelShare >= 0.8 ? 'high' : insights.oneVideoChannelShare >= 0.6 ? 'warning' : 'low' },
    { label: 'malformed dates', value: String(insights.malformedDateCount), severity: malformedDateRate >= 0.1 ? 'high' : malformedDateRate > 0 ? 'warning' : 'low' },
  ];

  const [channelIdCopyFeedback, setChannelIdCopyFeedback] = useState<string>('');

  useEffect(() => {
    if (!channelIdCopyFeedback) return;
    const timeout = window.setTimeout(() => setChannelIdCopyFeedback(''), 2200);
    return () => window.clearTimeout(timeout);
  }, [channelIdCopyFeedback]);

  const handleCopyAllChannelIds = async () => {
    if (!allChannelIds.length) {
      setChannelIdCopyFeedback('No channel IDs available in this scope.');
      return;
    }
    try {
      await copyText(allChannelIds.join(','));
      setChannelIdCopyFeedback(`Copied ${allChannelIds.length.toLocaleString()} channel IDs.`);
    } catch {
      setChannelIdCopyFeedback('Could not copy channel IDs.');
    }
  };

  const coverageToneByKey: Record<string, string> = {
    thumbnails: 'tone-thumbnails',
    descriptions: 'tone-descriptions',
    tags: 'tone-tags',
    captions: 'tone-captions',
    transcripts: 'tone-transcripts',
  };

  return (
    <main className="dataset-overview-frame overview-layout">
      <section className="overview-toolbar">
        <div className="overview-toolbar-grid">
          {toolbarItems.map((item) => (
            <div className="overview-toolbar-item" key={item.key}>
              <span>{item.label}</span>
              <strong title={item.value}>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="overview-main-grid">
        <article className="dataset-overview-card overview-panel timeline-panel">
          <section className="timeline-half">
            <div className="section-title section-title-row timeline-title-row">
              <span className="timeline-title-main">
                <span>upload timeline</span>
                <InfoPopover
                  label="Upload timeline"
                  oneLine="Time series of upload counts with rolling trend, date rug marks, and automatically selected binning."
                  method="Rows are grouped into daily bins for tighter date ranges and weekly bins for broader histories. Each bar is a count of uploads in that bin. The line is a rolling average that smooths spikes so you can see the general publishing arc. Rug marks at the bottom show individual upload timestamps."
                  codeSnippet={`const binning = rangeDays <= 160 ? 'daily' : 'weekly';
const counts = bins.map((bucket) => bucketCounts.get(bucket) ?? 0);
const moving = movingAverage(counts, binning === 'daily' ? 7 : 4);
const peaks = detectPeakIndices(counts);`}
                  codeExplanation="The code first decides how coarse the timeline should be, then computes raw counts, then overlays a moving average, then flags local maxima as peaks. That is why the chart communicates both exact bursts and overall rhythm."
                />
              </span>
              <span className="timeline-meta">{provenance.overview.upload.binning} bins | {provenance.overview.upload.totalBins} bins | peaks {provenance.overview.upload.peakCount}</span>
            </div>
            <TimelineChart snapshot={snapshot} series="upload" ariaLabel="Upload counts over time" />
          </section>
          <section className="timeline-half timeline-half-secondary">
            <div className="section-title section-title-row timeline-title-row">
              <span className="timeline-title-main">
                <span>channel age timeline</span>
                <InfoPopover
                  label="Channel age timeline"
                  oneLine="Distribution of channel creation dates for the current scope using imported channel metadata."
                  method="The dashboard looks for a canonical channel creation field, then groups those timestamps into daily or weekly bins exactly like the upload chart. If no channel metadata has been imported yet, the panel stays in an instructional empty state so the layout does not jump."
                  codeSnippet={`const createdAt = row.channel_created_at ?? importedRow?.publishedAt;
const series = deriveTimelineInsights(createdAtTimestamps, rows.length);`}
                  codeExplanation="This keeps the chart compatible with imported YouTube Data Tools channel lists where the creation date comes in as publishedAt."
                />
              </span>
              <span className="timeline-meta">{provenance.overview.channelAge.totalBins ? `${provenance.overview.channelAge.binning} bins | ${provenance.overview.channelAge.totalBins} bins | peaks ${provenance.overview.channelAge.peakCount}` : 'channel metadata not loaded'}</span>
            </div>
            <TimelineChart
              snapshot={snapshot}
              series="channelAge"
              ariaLabel="Channel creation dates over time"
              emptyMessage={
                <div className="space-y-3">
                  <div>Import channel list from YouTube Data Tools to see channel age distribution, you can use multi row selection to get copy ready list of channel IDs.</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={handleCopyAllChannelIds} className="border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text)] hover:bg-[var(--surface-3)]">
                      Copy all channel IDs
                    </button>
                    {channelIdCopyFeedback ? <span className="text-xs text-[var(--muted)]">{channelIdCopyFeedback}</span> : null}
                  </div>
                </div>
              }
            />
          </section>
        </article>

        <article className="dataset-overview-card overview-panel quality-panel compact-quality">
          <div className="section-title section-title-row">
            <span>quality checks</span>
            <InfoPopover
              label="Quality checks"
              oneLine="Compact diagnostic summary of duplication, engagement sparsity, channel repetition, and date parsing issues."
              method={`The panel blends rule-based structural checks with the dashboard's quality classifier. Duplicate videos and exact duplicate rows are measured separately. Zero-comment rate is calculated only where comment fields exist. 'Channels once' measures how many channels appear only one time in the dataset.\n\nOnly the first caveat is shown inline for readability. Full caveat audit:\n${caveatAuditText}`}
              codeSnippet={`const firstCaveat = insights.caveats[0];
const caveatAuditText = insights.caveats
  .map((caveat, index) => (index + 1) + '. [' + caveat.severity + '] ' + caveat.text)
  .join('\n');`}
              codeExplanation="The inline panel stays concise, but the full generated caveat list is preserved here so someone auditing the dataset can see every triggered warning and not only the first one that fit on screen."
            />
          </div>
          <div className="quality-metric-list">
            {qualityRows.map((metric) => (
              <div className="quality-metric-row" key={metric.label}>
                <span className="quality-metric-label">{metric.label}</span>
                <strong className="quality-metric-value">{metric.value}</strong>
                <span className={`quality-severity-badge ${severityClass(metric.severity)}`}>{metric.severity}</span>
              </div>
            ))}
          </div>
          <div className="dataset-status-row">
            <span className={`dataset-status-badge ${statusClass(insights.overallStatus)}`}>{insights.overallStatus}</span>
            <span className="dataset-status-copy">{insights.statusReason}</span>
          </div>
          {firstCaveat ? (
            <div className="dataset-caveat-inline">
              <span className={`dataset-caveat-severity ${firstCaveat.severity}`}>{firstCaveat.severity === 'medium' ? 'warning' : firstCaveat.severity}</span>
              <span className="dataset-caveat-inline-text">{firstCaveat.text}</span>
            </div>
          ) : null}
        </article>
      </section>

      <section className="overview-secondary-grid">
        <article className="dataset-overview-card overview-panel coverage-panel">
          <div className="section-title">coverage</div>
          <div className="dataset-coverage-map">
            {insights.coverage.map((metric) => (
              <div className="dataset-coverage-row" key={metric.key}>
                <div className="dataset-coverage-top">
                  <div className="dataset-coverage-label">{metric.label}</div>
                  <div className="dataset-coverage-values">{formatPercent(metric.presentShare, 0)}</div>
                </div>
                <div className="coverage-track">
                  <div className={`coverage-fill ${coverageToneByKey[metric.key] ?? 'tone-tags'}`} style={{ width: `${Math.max(metric.presentShare * 100, metric.presentCount > 0 ? 1.2 : 0)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className={`dataset-coverage-note ${coverageUneven ? 'is-uneven' : 'is-balanced'}`}>coverage is {coverageUneven ? 'uneven' : 'relatively even'}</div>
        </article>

        <article className="dataset-overview-card overview-panel language-overview-panel">
          <div className="section-title section-title-row">
            <span>language overview</span>
            <InfoPopover
              label="Language overview"
              oneLine="Declared versus audio language shares for the most common language codes in the dataset."
              method="The dashboard normalizes both declared and audio language fields to base codes such as en or nl, counts them separately, then renders paired bars so mismatches are visible at a glance."
              codeSnippet={`declaredCode = normalizeLanguage(defaultLanguage);
audioCode = normalizeLanguage(defaultAudioLanguage);`}
              codeExplanation="Normalizing to base codes prevents tiny formatting differences like en-US versus en-GB from fragmenting the language distribution and makes the two metadata sources comparable."
            />
          </div>
          <div className="provenance-legend"><span><i className="swatch declared" /> declared</span><span><i className="swatch audio" /> audio</span></div>
          <LanguageOverview rows={provenance.languageRows} />
        </article>
      </section>
    </main>
  );
}

function MetricHeader({ title, info }: { title: string; info: InfoProps }) {
  return (
    <div className="section-title section-title-row">
      <span>{title}</span>
      <InfoPopover {...info} />
    </div>
  );
}

function CountList({ title, items, tone = 'video', info, onItemSelect }: CountListProps) {
  return (
    <div className="content-list-block">
      <MetricHeader title={title} info={info} />
      <div className="content-list">
        {items.map((item, index) => {
          const isClickable = Boolean(onItemSelect);
          const itemBody = (
            <>
              <div className="content-list-topline">
                <div className="content-list-label" title={item.label}>{item.label}</div>
                <div className="content-list-values"><strong>{item.count}</strong><span>{formatPercent(item.share, 1)}</span></div>
              </div>
              <div className="content-bar-track"><div className={`content-bar-fill tone-${tone}`} style={{ width: `${Math.max(item.share * 100, item.share > 0 ? 2 : 0)}%` }} /></div>
            </>
          );
          return isClickable ? (
            <button
              key={`${title}-${item.label}-${index}`}
              type="button"
              className="content-list-item w-full text-left transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_7%,transparent)]"
              onClick={() => onItemSelect?.(item.label)}
              title={`Filter by ${item.label}`}
            >
              {itemBody}
            </button>
          ) : (
            <div className="content-list-item" key={`${title}-${item.label}-${index}`}>
              {itemBody}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KeywordCloud({ title, items, tone = 'video', info }: KeywordCloudProps) {
  const words = buildCloudWords(items);
  return (
    <div className="keyword-cloud-block">
      <MetricHeader title={title} info={info} />
      <div className={`keyword-cloud-safe tone-${tone}`}>
        {words.map((word, index) => (
          <span
            key={`${title}-${word.label}-${index}`}
            className={`cloud-word tone-${tone} ${word.isCore ? 'is-core' : ''}`}
            style={{
              fontSize: `${word.isCore ? word.size : Math.max(9, word.size - 0.5)}px`,
              opacity: word.opacity,
              left: `${(word.x / CLOUD_WIDTH) * 100}%`,
              top: `${(word.y / CLOUD_HEIGHT) * 100}%`,
              width: `${(word.width / CLOUD_WIDTH) * 100}%`,
              maxWidth: `${(word.width / CLOUD_WIDTH) * 100}%`,
              transform: `translate(-50%, -50%) rotate(${word.rotate}deg)`,
            }}
            title={`${word.label}: ${word.count} videos (${formatPercent(word.share, 1)})`}
          >
            {word.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ShortsEstimateBox({ snapshot }: { snapshot: DashboardTemplateSnapshot }) {
  const estimate = snapshot.content.shortsEstimate;
  const shortAngle = estimate.shortShare * 360;
  const donutBackground = `conic-gradient(
    var(--accent-engagement) 0deg ${shortAngle}deg,
    color-mix(in srgb, var(--accent-channel) 82%, #233425 18%) ${shortAngle}deg 360deg
  )`;

  return (
    <div className="shorts-estimate">
      <div className="section-title section-title-row">
        <span>estimated shorts share</span>
        <InfoPopover
          label="Estimated shorts share"
          oneLine="Heuristic estimate of shorts versus long-form videos."
          method="Each video accumulates a shorts score from hashtag, tag, keyword, and duration signals. A strong hashtag signal immediately classifies the row as shorts; otherwise the accumulated score must cross the threshold."
          codeSnippet={`const hasHashtagSignal = /#shorts?\\b/i.test(title + ' ' + description);
const hasTagSignal = tags.some((tag) => /^(short|shorts|ytshorts)$/i.test(tag));
const hasKeywordSignal = /\\b(yt\\s*shorts?|short-form|vertical video|60s|one minute|1 minute)\\b/i.test(title + ' ' + description);
const hasDurationSignal = durationSec <= 70;

let score = 0;
if (hasHashtagSignal) score += 3;
if (hasTagSignal) score += 2;
if (hasDurationSignal) score += 2;
if (hasKeywordSignal) score += 1;
if (/^\\s*#shorts?\\b/i.test(title)) score += 1;

const isEstimatedShort = hasHashtagSignal || score >= 3;`}
          codeExplanation="This is intentionally explainable rather than model-based. You can inspect each signal and understand why the estimate moved up or down, which makes the donut suitable for exploratory analysis instead of opaque scoring."
        />
      </div>
      <div className="shorts-pie-wrap">
        <div className="shorts-pie" style={{ background: donutBackground }} aria-label="Estimated shorts share pie chart">
          <div className="shorts-pie-core"><div className="shorts-pie-value">{formatPercent(estimate.shortShare, 0)}</div></div>
        </div>
      </div>
      <div className="shorts-footnote">n short={estimate.shortCount} / long={estimate.longCount}</div>
    </div>
  );
}

function ContentTab({ snapshot, onApplyContentFilter }: { snapshot: DashboardTemplateSnapshot; onApplyContentFilter?: (kind: ContentFilterKind, label: string) => void; }) {
  return (
    <main className="dashboard-frame content-unified-frame content-final-layout">
      <section className="content-left-grid">
        <div className="content-cell content-cell-top-left">
          <CountList
            title="Top categories"
            items={snapshot.content.categories}
            tone="channel"
            onItemSelect={(label) => onApplyContentFilter?.('category', label)}
            info={{
              label: 'Top categories',
              oneLine: 'Most frequent video category labels in the dataset.',
              method: 'Each row contributes one resolved category label. Missing categories are retained as unknown so the chart still reflects metadata sparsity instead of silently dropping incomplete rows.',
              codeSnippet: `const categoryItems = rows.map((row) => row.videoCategoryLabel || 'unknown');\ncategories: countBy(categoryItems, 6);`,
              codeExplanation: 'The categories chart is row-based rather than view-weighted. It tells you what kinds of videos are present, not which categories dominate by attention.',
            }}
          />
        </div>
        <div className="content-cell content-cell-top-right">
          <CountList
            title="Top topics"
            items={snapshot.content.topics}
            tone="engagement"
            onItemSelect={(label) => onApplyContentFilter?.('topic', label)}
            info={{
              label: 'Top topics',
              oneLine: 'Most frequent topic category tokens after flattening topic arrays.',
              method: 'Rows can carry multiple topic categories. The dashboard flattens those arrays into one token stream, keeps unknown when topic metadata is missing, and normalizes by total topic observations.',
              codeSnippet: `const topicItems = rows.flatMap((row) => (\n  row.topicCategories.length ? row.topicCategories : ['unknown']\n));\ntopics: countBy(topicItems, 6);`,
              codeExplanation: 'Because rows can contribute more than one topic, this panel reads as share of topic tokens, not share of videos.',
            }}
          />
        </div>
        <div className="content-cell content-cell-bottom-left content-split-cell">
          <div className="content-split-left">
            <CountList
              title="Duration buckets"
              items={snapshot.content.durations}
              tone="channel"
              onItemSelect={(label) => onApplyContentFilter?.('duration', label)}
              info={{
                label: 'Duration buckets',
                oneLine: 'Runtime distribution in fixed editorial bins.',
                method: 'Duration values are normalized into stable, human-readable ranges such as under one minute, one to five minutes, and fifteen to thirty minutes. Missing or invalid durations remain visible as unknown.',
                codeSnippet: `function durationBucket(seconds: number | null): string {\n  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return 'unknown';\n  if (seconds < 60) return '<1m';\n  if (seconds < 300) return '1-5m';\n  if (seconds < 900) return '5-15m';\n  if (seconds < 1800) return '15-30m';\n  return '30m+';\n}`,
                codeExplanation: 'The buckets are intentionally coarse so the distribution is legible at a glance and directly comparable across exports.',
              }}
            />
          </div>
          <div className="content-split-right"><ShortsEstimateBox snapshot={snapshot} /></div>
        </div>
        <div className="content-cell content-cell-bottom-right">
          <CountList
            title="Intent cues"
            items={snapshot.content.intent}
            tone="video"
            onItemSelect={(label) => onApplyContentFilter?.('intent', label)}
            info={{
              label: 'Intent cues',
              oneLine: 'Rule-based editorial intent inferred from title and description text.',
              method: 'Intent is assigned with deterministic first-match-wins regex rules applied in order: tutorial/explainer, review/comparison, news/update, opinion/reaction, interview/talk, then fallback to other. If a title/description matches multiple patterns, only the first matching bucket is used.',
              codeSnippet: `const INTENT_PATTERNS = [
  { label: 'tutorial / explainer', pattern: /\\b(how\\s+to|tutorial|guide|explained|what\\s+is|basics?)\\b/i },
  { label: 'review / comparison', pattern: /\\b(review|vs\\.?|versus|comparison|top\\s+\\d+|best|worst|rating)\\b/i },
  { label: 'news / update', pattern: /\\b(news|update|breaking|latest|today)\\b/i },
  { label: 'opinion / reaction', pattern: /\\b(opinion|reaction|responds?|debunk|rant|hot\\s+take)\\b/i },
  { label: 'interview / talk', pattern: /\\b(interview|podcast|conversation|talk|debate)\\b/i },
];

function inferIntent(text: string): string {
  for (const candidate of INTENT_PATTERNS) {
    if (candidate.pattern.test(text)) return candidate.label;
  }
  return 'other';
}`,
              codeExplanation: 'The regex stack is explicit and ordered, so buckets are reproducible and auditable instead of opaque.',
            }}
          />
        </div>
      </section>

      <section className="content-right-column">
        <div className="content-right-box">
          <KeywordCloud
            title="Title keywords"
            items={snapshot.content.keywords.titleKeywords}
            tone="video"
            info={{
              label: 'Title keywords',
              oneLine: 'Keyword prominence by title-level document frequency.',
              method: 'Titles are normalized and tokenized, stopwords are removed, and each token counts at most once per video so repeated words in a single title do not inflate the cloud.',
              codeSnippet: `const titleTexts = rows.map((row) => row.title).filter(Boolean);\ntitleKeywords: keywordDocumentFrequency(titleTexts, 48);`,
              codeExplanation: 'Document frequency answers how widespread a term is across the dataset, not how many times it repeats inside the same item. That makes the cloud more robust as a topical summary.',
            }}
          />
        </div>
        <div className="content-right-box">
          <KeywordCloud
            title="Description keywords"
            items={snapshot.content.keywords.descriptionKeywords}
            tone="engagement"
            info={{
              label: 'Description keywords',
              oneLine: 'Keyword prominence by description-level document frequency.',
              method: 'Descriptions are normalized, tokenized, filtered for stopwords, and then counted once per row. This often surfaces framing phrases, calls to action, and recurring contextual language.',
              codeSnippet: `const descriptionTexts = rows.map((row) => row.description).filter(Boolean);\ndescriptionKeywords: keywordDocumentFrequency(descriptionTexts, 48);`,
              codeExplanation: 'Because descriptions are longer than titles, this cloud is often better for editorial framing than for concise topic names.',
            }}
          />
        </div>
        <div className="content-right-box">
          <KeywordCloud
            title="Tag keywords"
            items={snapshot.content.keywords.tagKeywords}
            tone="channel"
            info={{
              label: 'Tag keywords',
              oneLine: 'Keyword prominence by tag-level document frequency.',
              method: 'Tags are joined per video before tokenization. The resulting document-frequency count surfaces the vocabulary that creators explicitly attached to their uploads.',
              codeSnippet: `const tagTexts = rows.map((row) => row.tags.join(' ')).filter(Boolean);\ntagKeywords: keywordDocumentFrequency(tagTexts, 48);`,
              codeExplanation: 'Tags often reveal explicit self-labeling, which can differ from what is visible in titles or descriptions alone.',
            }}
          />
        </div>
      </section>
    </main>
  );
}

export default function TemplateDashboard({
  snapshot,
  calculatedAt,
  controls,
  toolbarCenter,
  activeTab,
  onTabChange,
  thumbnailsContent,
  linkingContent,
  emptyStateContent,
  fullscreenMode = false,
  onNavigateToItem,
  onApplyContentFilter,
  allChannelIds = [],
}: Props) {
  const [internalActiveTab, setInternalActiveTab] = useState<DashboardTemplateTab>('overview');
  const resolvedActiveTab = activeTab ?? internalActiveTab;
  const setTab = (tab: DashboardTemplateTab) => {
    if (onTabChange) onTabChange(tab);
    if (activeTab === undefined) setInternalActiveTab(tab);
  };

  const shellClassName = [
    'exactdash-shell',
    fullscreenMode ? 'is-fullscreen' : '',
    resolvedActiveTab === 'thumbnails' ? 'is-thumbnails-view' : '',
    resolvedActiveTab === 'linking' ? 'is-linking-view' : '',
    resolvedActiveTab !== 'thumbnails' && resolvedActiveTab !== 'linking' && !snapshot ? 'is-empty-view' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={shellClassName}>
      <div className="exactdash-header">
        <div className="exactdash-tabs" role="tablist" aria-label="Dashboard sections">
          {(['overview', 'attention', 'content', 'linking', 'thumbnails'] as DashboardTemplateTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={resolvedActiveTab === tab}
              className={`exactdash-tab ${resolvedActiveTab === tab ? 'is-active' : ''}`}
              onClick={() => setTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="exactdash-toolbar-center">{toolbarCenter}</div>
        {controls ? <div className="exactdash-controls" aria-label="Dashboard tools">{controls}</div> : null}
      </div>
      {resolvedActiveTab === 'thumbnails' ? <main className="exactdash-thumbnails-tab">{thumbnailsContent}</main> : null}
      {resolvedActiveTab !== 'thumbnails' && resolvedActiveTab !== 'linking' && !snapshot ? (
        <main className="exactdash-empty-tab">{emptyStateContent}</main>
      ) : null}
      {resolvedActiveTab === 'overview' && snapshot ? <OverviewTab snapshot={snapshot} calculatedAt={calculatedAt} allChannelIds={allChannelIds} /> : null}
      {resolvedActiveTab === 'attention' && snapshot ? <main className="dashboard-frame">{snapshot.columns.map((column) => <InequalityColumn key={column.key} column={column} onNavigateToItem={onNavigateToItem} />)}</main> : null}
      {resolvedActiveTab === 'content' && snapshot ? <ContentTab snapshot={snapshot} onApplyContentFilter={onApplyContentFilter} /> : null}
      {resolvedActiveTab === 'linking' ? linkingContent : null}
    </div>
  );
}
