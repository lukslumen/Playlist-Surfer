import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import type {
  DashboardOverviewBucket,
  DashboardOverviewProfile,
  DashboardOverviewShare,
  DashboardOverviewTimeBin,
  DashboardTemplateOverviewInsights,
  DashboardTemplateSnapshot,
  OverviewDrilldown,
} from '../../../lib/dashboardTemplateTypes';
import { DATE_FMT, displayScopeLabel } from './format';
import './overview.css';

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const compactShort = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 0 });
const whole = new Intl.NumberFormat('en-US');
const MONTH_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

const percent = (share: number) => `${share > 0 && share < 0.01 ? '<1' : Math.round(share * 100)}%`;

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours} h ${minutes} min`;
  if (minutes) return `${minutes} min`;
  return `${total} s`;
}

function formatSpan(firstTs: number | null, lastTs: number | null): string {
  if (firstTs === null || lastTs === null) return '';
  const days = (lastTs - firstTs) / 86_400_000;
  if (days < 1) return 'one day';
  if (days < 60) return `${Math.round(days)} days`;
  if (days < 730) return `${Math.round(days / 30.4)} months`;
  return `${(days / 365.25).toFixed(days < 3650 ? 1 : 0).replace(/\.0$/, '')} years`;
}

/** A readable top for the y axis: even up to 10 (so the midline is a whole number), then 1, 2 or 5 × 10ⁿ. */
function niceCeiling(value: number): number {
  if (value <= 2) return 2;
  if (value <= 10) return Math.ceil(value / 2) * 2;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((candidate) => candidate * power >= value) ?? 10;
  return step * power;
}

const UNIT_LABEL: Record<DashboardOverviewProfile['uploads']['unit'], string> = {
  day: 'day',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  year: 'year',
};

/** Which bins get an axis label: the starts of years (or months for short spans), thinned to about a dozen. */
function axisTicks(bins: DashboardOverviewTimeBin[], unit: DashboardOverviewProfile['uploads']['unit']) {
  const isBoundary = (bin: DashboardOverviewTimeBin, index: number) => {
    if (index === 0) return true;
    const date = new Date(bin.startTs);
    const previous = new Date(bins[index - 1].startTs);
    if (unit === 'day' || unit === 'week') return date.getUTCMonth() !== previous.getUTCMonth();
    return date.getUTCFullYear() !== previous.getUTCFullYear();
  };
  const candidates = bins.flatMap((bin, index) => (isBoundary(bin, index) ? [index] : []));
  const every = Math.max(1, Math.ceil(candidates.length / 12));
  // Labels need room: drop the first one when the next boundary follows right after it (Dec 2020, then 2021).
  const minGap = bins.length / 16;
  const thinned = candidates.filter((_, position) => position % every === 0)
    .filter((index, position, list) => !(position === 0 && list.length > 1 && list[1] - index < minGap));
  return thinned.map((index) => {
    const date = new Date(bins[index].startTs);
    const label = unit === 'day' || unit === 'week'
      ? (date.getUTCMonth() === 0 || index === 0 ? MONTH_FMT.format(date) : date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }))
      : String(date.getUTCFullYear());
    return { index, label };
  });
}

function UploadTimeline({ uploads, datedCount, totalVideos, onDrilldown }: {
  uploads: DashboardOverviewProfile['uploads'];
  datedCount: number;
  totalVideos: number;
  onDrilldown?: (drilldown: OverviewDrilldown) => void;
}) {
  const { bins, unit } = uploads;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ anchor: number; current: number } | null>(null);
  const top = niceCeiling(uploads.maxCount);
  const ticks = useMemo(() => axisTicks(bins, unit), [bins, unit]);

  // Finish a drag wherever the pointer is released, and cancel it with Escape.
  useEffect(() => {
    if (!drag) return;
    const finish = () => {
      const from = Math.min(drag.anchor, drag.current);
      const to = Math.max(drag.anchor, drag.current);
      setDrag(null);
      onDrilldown?.({ kind: 'published', startTs: bins[from].startTs, endTs: bins[to].endTs });
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrag(null);
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('keydown', cancel);
    };
  }, [bins, drag, onDrilldown]);

  if (!bins.length) {
    return <div className="ov-empty">No valid publish dates in this scope.</div>;
  }

  const selection = drag ? [Math.min(drag.anchor, drag.current), Math.max(drag.anchor, drag.current)] as const : null;
  const tooltip = (() => {
    if (selection) {
      const count = bins.slice(selection[0], selection[1] + 1).reduce((total, bin) => total + bin.count, 0);
      const label = selection[0] === selection[1] ? bins[selection[0]].label : `${bins[selection[0]].label} – ${bins[selection[1]].label}`;
      return { index: Math.round((selection[0] + selection[1]) / 2), title: label, value: `${whole.format(count)} ${count === 1 ? 'video' : 'videos'} · release to filter` };
    }
    if (hoverIndex === null) return null;
    const bin = bins[hoverIndex];
    return { index: hoverIndex, title: bin.label, value: `${whole.format(bin.count)} ${bin.count === 1 ? 'video' : 'videos'}` };
  })();

  return (
    <div className="ov-timeline">
      <div className="ov-timeline-axis-y" aria-hidden="true">
        <span>{whole.format(top)}</span>
        <span>{whole.format(top / 2)}</span>
        <span>0</span>
      </div>
      <div className="ov-timeline-body">
        <div
          className={`ov-timeline-plot ${bins.length > 160 ? 'is-dense' : ''}`}
          role="group"
          aria-label={`Uploads per ${UNIT_LABEL[unit]}`}
          onPointerLeave={() => setHoverIndex(null)}
        >
          <div className="ov-gridline" style={{ bottom: '50%' }} />
          <div className="ov-gridline" style={{ bottom: '100%' }} />
          {bins.map((bin, index) => {
            const isSelected = selection ? index >= selection[0] && index <= selection[1] : false;
            return (
              <div
                key={bin.startTs}
                className={`ov-bar-column ${isSelected ? 'is-selected' : ''} ${hoverIndex === index ? 'is-hover' : ''}`}
                onPointerEnter={() => {
                  setHoverIndex(index);
                  if (drag) setDrag({ ...drag, current: index });
                }}
                onPointerDown={(event) => {
                  if (!onDrilldown || event.button !== 0) return;
                  event.preventDefault();
                  (event.target as Element).releasePointerCapture?.(event.pointerId);
                  setDrag({ anchor: index, current: index });
                }}
              >
                <div className="ov-bar" style={{ height: bin.count ? `max(2px, ${(bin.count / top) * 100}%)` : 0 }} />
              </div>
            );
          })}
          {tooltip ? (
            <div
              className="ov-tooltip"
              style={{ left: `${((tooltip.index + 0.5) / bins.length) * 100}%` }}
              role="status"
            >
              <strong>{tooltip.title}</strong>
              <span>{tooltip.value}</span>
            </div>
          ) : null}
        </div>
        <div className="ov-timeline-axis-x" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick.index} style={{ left: `${(tick.index / bins.length) * 100}%` }}>{tick.label}</span>
          ))}
        </div>
      </div>
      {datedCount < totalVideos ? (
        <p className="ov-footnote">{whole.format(totalVideos - datedCount)} videos have no valid publish date and are not shown.</p>
      ) : null}
    </div>
  );
}

interface BarRow {
  key: string;
  label: string;
  count: number;
  share: number;
  onSelect?: () => void;
}

function BarList({ rows, emptyText, footnote }: { rows: BarRow[]; emptyText: string; footnote?: string }) {
  if (!rows.length) return <div className="ov-empty">{emptyText}</div>;
  const maxShare = Math.max(...rows.map((row) => row.share), 0.0001);
  return (
    <>
      <ul className="ov-bar-list">
        {rows.map((row) => {
          const content = (
            <>
              <span className="ov-bar-label" title={row.label}>{row.label}</span>
              <span className="ov-bar-track"><span className="ov-bar-fill" style={{ width: `${(row.share / maxShare) * 100}%` }} /></span>
              <span className="ov-bar-value">
                <strong>{percent(row.share)}</strong>
                <span>{whole.format(row.count)}</span>
              </span>
            </>
          );
          return (
            <li key={row.key}>
              {row.onSelect ? (
                <button type="button" className="ov-bar-row is-interactive" onClick={row.onSelect} title={`Show these ${whole.format(row.count)} videos in the explorer`}>
                  {content}
                </button>
              ) : (
                <div className="ov-bar-row">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
      {footnote ? <p className="ov-footnote">{footnote}</p> : null}
    </>
  );
}

function bucketRows(buckets: DashboardOverviewBucket[], kind: 'length' | 'views', onDrilldown?: (drilldown: OverviewDrilldown) => void): BarRow[] {
  return buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: bucket.count,
    share: bucket.share,
    onSelect: onDrilldown && bucket.count ? () => onDrilldown({ kind, min: bucket.min, max: bucket.max }) : undefined,
  }));
}

function shareRows(shares: DashboardOverviewShare[], toDrilldown: (value: string) => OverviewDrilldown, onDrilldown?: (drilldown: OverviewDrilldown) => void): BarRow[] {
  return shares.map((entry) => ({
    key: entry.filterValue ?? `other:${entry.label}`,
    label: entry.label,
    count: entry.count,
    share: entry.share,
    onSelect: onDrilldown && entry.filterValue ? () => onDrilldown(toDrilldown(entry.filterValue!)) : undefined,
  }));
}

function DataHealth({ overview }: { overview: DashboardTemplateOverviewInsights }) {
  // An empty scope has nothing to check; its "100% missing" caveats would only be noise.
  const issues = overview.totalRows ? overview.caveats.filter((caveat) => caveat.severity !== 'low') : [];
  const checks = [
    overview.duplicateCount ? `${whole.format(overview.duplicateCount)} duplicate videos` : 'No duplicate videos',
    overview.malformedDateCount ? `${whole.format(overview.malformedDateCount)} unreadable dates` : 'All dates readable',
  ];
  return (
    <section className={`ov-card ov-health ${issues.length ? 'has-issues' : ''}`} aria-label="Data health">
      <div className="ov-health-status">
        {issues.length ? <AlertTriangle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
        <div>
          <strong>{issues.length ? `${issues.length} ${issues.length === 1 ? 'thing' : 'things'} to check` : 'No problems found'}</strong>
          <span>{checks.join(' · ')}</span>
        </div>
      </div>
      <div className="ov-coverage" aria-label="Field coverage">
        {overview.coverage.map((metric) => (
          <div className="ov-coverage-item" key={metric.key} title={`${whole.format(metric.presentCount)} of ${whole.format(metric.presentCount + metric.missingCount)} videos have ${metric.label}`}>
            <span className="ov-coverage-label">{metric.label}</span>
            <span className="ov-coverage-meter"><span style={{ width: `${metric.presentShare * 100}%` }} /></span>
            <span className="ov-coverage-value">{percent(metric.presentShare)}</span>
          </div>
        ))}
      </div>
      {issues.length ? (
        <ul className="ov-issues">
          {issues.map((issue) => (
            <li key={issue.text} className={`is-${issue.severity}`}>{issue.text}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Kpi({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="ov-kpi">
      <span className="ov-kpi-label">{label}</span>
      <strong className="ov-kpi-value" title={value}>{value}</strong>
      {detail ? <span className="ov-kpi-detail" title={detail}>{detail}</span> : null}
    </div>
  );
}

export function OverviewTab({ snapshot, calculatedAt, onDrilldown, onRegenerate }: {
  snapshot: DashboardTemplateSnapshot;
  calculatedAt: string;
  onDrilldown?: (drilldown: OverviewDrilldown) => void;
  onRegenerate?: () => void;
}) {
  const profile = snapshot.profile;
  if (!profile) {
    return (
      <main className="ov">
        <section className="ov-card ov-outdated">
          <strong>This snapshot was made by an earlier version of the overview.</strong>
          <span>Regenerate it to see the new summary.</span>
          {onRegenerate ? (
            <button type="button" className="ov-button" onClick={onRegenerate}><RefreshCw size={14} aria-hidden="true" /> Regenerate</button>
          ) : null}
        </section>
      </main>
    );
  }

  const overview = snapshot.overview;
  // Years fit the card; the exact months go in the detail line.
  const published = (() => {
    const { firstPublishedTs: first, lastPublishedTs: last } = profile;
    if (first === null || last === null) return { value: '—', detail: undefined };
    const firstYear = new Date(first).getUTCFullYear();
    const lastYear = new Date(last).getUTCFullYear();
    const months = MONTH_FMT.format(first) === MONTH_FMT.format(last) ? MONTH_FMT.format(first) : `${MONTH_FMT.format(first)} – ${MONTH_FMT.format(last)}`;
    if (firstYear === lastYear) return { value: MONTH_FMT.format(first) === MONTH_FMT.format(last) ? MONTH_FMT.format(first) : String(firstYear), detail: months };
    return { value: `${firstYear}–${lastYear}`, detail: `${months} · ${formatSpan(first, last)}` };
  })();
  const engagement = profile.medianEngagementPerThousand;
  const languageSourceLabel = profile.languageSource === 'audio' ? 'audio language' : 'declared language';

  return (
    <main className="ov">
      <header className="ov-head">
        <div className="ov-head-line">
          <h2 className="ov-title" title={snapshot.datasetLabel}>{snapshot.datasetLabel}</h2>
          <span className="ov-chip">{displayScopeLabel(snapshot)}</span>
          <span className="ov-meta">Snapshot {DATE_FMT.format(new Date(calculatedAt || snapshot.snapshotTs).getTime())}</span>
        </div>
        <p className="ov-summary">{profile.summary.join(' ')}</p>
      </header>

      <section className="ov-kpis" aria-label="Key numbers">
        <Kpi label="Videos" value={whole.format(profile.videos)} detail={overview.totalRows !== profile.videos ? `${whole.format(overview.totalRows)} rows` : undefined} />
        <Kpi label={profile.channels === 1 ? 'Channel' : 'Channels'} value={whole.format(profile.channels)} detail={profile.singleChannelName ?? undefined} />
        <Kpi label="Published" value={published.value} detail={published.detail} />
        <Kpi label="Total views" value={compact.format(profile.totalViews)} detail={`${compactShort.format(overview.totalLikes)} likes · ${compactShort.format(overview.totalComments)} comments`} />
        <Kpi
          label="Typical views"
          value={profile.medianViews === null ? '—' : compact.format(profile.medianViews)}
          detail={profile.p10Views !== null && profile.p90Views !== null ? `middle 80%: ${compact.format(profile.p10Views)}–${compact.format(profile.p90Views)}` : undefined}
        />
        <Kpi label="Typical length" value={formatDuration(profile.medianDurationSec)} detail={engagement === null ? undefined : `${engagement < 10 ? engagement.toFixed(1) : Math.round(engagement)} likes and comments per 1K views`} />
      </section>

      <section className="ov-card ov-timeline-card">
        <div className="ov-card-head">
          <h3>Uploads per {UNIT_LABEL[profile.uploads.unit]}</h3>
          {profile.uploads.busiest && profile.uploads.busiest.count > 1 ? (
            <span className="ov-card-note">Busiest: {profile.uploads.busiest.label} ({whole.format(profile.uploads.busiest.count)})</span>
          ) : null}
          {onDrilldown ? <span className="ov-hint">Click a bar or drag across bars to filter the explorer</span> : null}
        </div>
        <UploadTimeline uploads={profile.uploads} datedCount={profile.datedCount} totalVideos={profile.videos} onDrilldown={onDrilldown} />
      </section>

      <section className="ov-grid">
        <article className="ov-card">
          <div className="ov-card-head"><h3>Length</h3></div>
          <BarList
            rows={bucketRows(profile.lengths, 'length', onDrilldown)}
            emptyText="No durations in this scope."
            footnote={profile.lengthUnknownCount ? `${whole.format(profile.lengthUnknownCount)} without a duration.` : undefined}
          />
        </article>
        <article className="ov-card">
          <div className="ov-card-head"><h3>Views per video</h3></div>
          <BarList
            rows={bucketRows(profile.views, 'views', onDrilldown)}
            emptyText="No view counts in this scope."
            footnote={profile.viewsUnknownCount ? `${whole.format(profile.viewsUnknownCount)} without a view count.` : undefined}
          />
        </article>
        <article className="ov-card">
          <div className="ov-card-head"><h3>Categories</h3></div>
          <BarList rows={shareRows(profile.categories, (value) => ({ kind: 'category', value }), onDrilldown)} emptyText="No categories in this scope." />
        </article>
        <article className="ov-card">
          <div className="ov-card-head"><h3>Languages</h3><span className="ov-card-note">{languageSourceLabel}</span></div>
          <BarList
            rows={shareRows(profile.languages, (value) => ({ kind: 'language', value, source: profile.languageSource }), onDrilldown)}
            emptyText="No language fields in this scope."
          />
        </article>
      </section>

      <DataHealth overview={overview} />
    </main>
  );
}
