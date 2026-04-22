import { DashboardHotspot, DashboardRenderResult, DashboardTabId, DashboardShareItem, DatasetDashboardSnapshot } from '../types';
import { appendAll, maxOf } from './largeData';
import { formatDateDisplay } from './data';

const PANEL_WIDTH = 40;
const PANEL_BODY_HEIGHT = 9;
const GAP = 3;
const PRESET_ORDER: DashboardTabId[] = ['overview', 'temporal', 'inequality', 'content', 'locale', 'reliability'];
const PRESET_LABELS: Record<DashboardTabId, string> = {
  overview: 'Overview',
  temporal: 'Temporal',
  inequality: 'Inequality',
  content: 'Content',
  locale: 'Locale',
  reliability: 'Reliability',
};

type HelpConfig = { title: string; body: string; caveat?: string };
type BoxOptions = {
  title: string;
  lines: string[];
  width?: number;
  bodyHeight?: number;
  action?: DashboardTabId;
  helpId?: string;
};

const LABEL_ABBREVIATIONS: Record<string, string> = {
  'Howto & Style': 'How-to & Style',
  'Film & Animation': 'Film + Animation',
  'Nonprofits & Activism': 'Nonprofits + Activism',
  'Science & Technology': 'Science + Tech',
  'Autos & Vehicles': 'Autos + Vehicles',
  'Current filtered view': 'Filtered',
};

const HELP: Record<string, HelpConfig> = {
  'overview.overview': {
    title: 'Overview',
    body: 'Dataset footprint: total videos, channels, comments, categories, languages, and the overall upload span.',
    caveat: 'Counts describe the current scope only.'
  },
  'overview.temporal': {
    title: 'Temporal',
    body: 'Shows the date range, median age, and a compact upload timeline for the current scope.',
    caveat: 'This is descriptive timing, not a forecast.'
  },
  'overview.inequality': {
    title: 'Inequality',
    body: 'Shows how concentrated attention is, using median, p90, and top-share concentration signals.',
    caveat: 'High top-share values indicate winner-take-most dynamics.'
  },
  'overview.content': {
    title: 'Content',
    body: 'Shows which categories occupy the most rows in the dataset and how dominant the top category is.',
  },
  'overview.locale': {
    title: 'Locale',
    body: 'Summarizes language concentration. This is language-oriented, not country-oriented.',
  },
  'overview.reliability': {
    title: 'Reliability',
    body: 'Shows metadata coverage and the most important cautions for interpretation.',
    caveat: 'Low-confidence fields should be treated carefully in analysis.'
  },
  'temporal.summary': {
    title: 'Temporal summary',
    body: 'Basic timing reference points: oldest, newest, median age, and overall span.',
  },
  'temporal.histogram': {
    title: 'Year histogram',
    body: 'Relative upload density over time. Taller bars indicate more uploads in that period.',
  },
  'temporal.recency': {
    title: 'Recency buckets',
    body: 'Groups uploads into 30d, 90d, 365d, and older to show how recent the sample is.',
  },
  'temporal.age': {
    title: 'Age distribution',
    body: 'Shows how much of the sample falls into short-, medium-, and long-age buckets.',
  },
  'temporal.cadence': {
    title: 'Cadence',
    body: 'Simple production-rate signals based on uploads per day and per year.',
  },
  'temporal.notes': {
    title: 'Temporal notes',
    body: 'Short factual interpretation of the temporal structure based on the current snapshot.',
  },
  'ineq.summary': {
    title: 'Inequality summary',
    body: 'Fast reference for median, upper-percentile, and top-share concentration levels.',
  },
  'ineq.ladder': {
    title: 'Percentile ladder',
    body: 'Shows how sharply outcomes rise from the median to the upper tail.',
  },
  'ineq.topshares': {
    title: 'Top shares',
    body: 'How much total attention is captured by the largest items or groups.',
  },
  'ineq.channels': {
    title: 'Channel mix',
    body: 'Compares channel row share against view share. Positive deltas mean a channel punches above its footprint.',
  },
  'ineq.comments': {
    title: 'Comments / engagement',
    body: 'Summarizes video-level comment counts and concentration. These are not commenter-level metrics.',
  },
  'ineq.metrics': {
    title: 'Inequality metrics',
    body: 'Secondary concentration diagnostics such as Gini and HHI, kept lightweight and descriptive.',
  },
  'content.summary': {
    title: 'Content summary',
    body: 'High-level category footprint: category count, dominant category, and long-tail share.',
  },
  'content.top': {
    title: 'Top categories',
    body: 'The largest categories by row count in the current scope.',
  },
  'content.views': {
    title: 'Categories by views',
    body: 'Ranks categories by attention rather than output, when view aggregation is available.',
  },
  'content.output': {
    title: 'Categories by output',
    body: 'Shows the category mix using rows as the production/output unit.',
  },
  'content.overindex': {
    title: 'Over-index',
    body: 'Compares view share to row share. Positive deltas indicate categories attracting more attention than their footprint suggests.',
  },
  'content.keywords': {
    title: 'Keywords / tail',
    body: 'Lightweight keyword ranking from titles and descriptions, capped for performance.',
  },
  'locale.summary': {
    title: 'Locale summary',
    body: 'Language count, dominant language, and a compact read on concentration.',
  },
  'locale.top': {
    title: 'Top languages',
    body: 'Largest languages by row count in the current scope.',
  },
  'locale.views': {
    title: 'Language by views',
    body: 'Ranks languages by attention rather than footprint when view aggregation is available.',
  },
  'locale.overindex': {
    title: 'Language over-index',
    body: 'Compares row share to view share. Positive deltas indicate stronger attention than expected from row volume.',
  },
  'locale.mix': {
    title: 'Language mix',
    body: 'Shows how dominant the leading language(s) are and whether a broader tail remains present.',
  },
  'locale.notes': {
    title: 'Locale notes',
    body: 'This view is language-based. It should not be read as a country or region map.',
  },
  'reliability.coverage': {
    title: 'Coverage',
    body: 'Metadata presence across key fields. Sparse fields reduce confidence in downstream interpretation.',
  },
  'reliability.lowconf': {
    title: 'Low-confidence fields',
    body: 'Lists fields whose low coverage makes them fragile for interpretation or comparison.',
  },
  'reliability.warnings': {
    title: 'Warnings',
    body: 'Compact cautions produced from the current snapshot and available metadata.',
  },
  'reliability.comparability': {
    title: 'Comparability',
    body: 'Short notes on what can be compared directly and what should be treated cautiously.',
  },
  'reliability.missing': {
    title: 'Missingness profile',
    body: 'Shows what share of the current scope is missing for each key field.',
  },
  'reliability.method': {
    title: 'Method footer',
    body: 'Reminds the reader that the dashboard is a refresh-driven snapshot tied to the current scope.',
  },
};

function helpFor(id?: string): HelpConfig | undefined {
  return id ? HELP[id] : undefined;
}

function abbreviateLabel(label: string) {
  return LABEL_ABBREVIATIONS[label] || label;
}

function safeDate(value: string | null | undefined) {
  return value ? formatDateDisplay(value) : '—';
}

export function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return Math.round(value).toLocaleString();
}

export function compactPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const pct = value * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

export function ellipsis(label: string, width: number): string {
  const clean = abbreviateLabel(label);
  if (width <= 0) return '';
  if (clean.length <= width) return clean;
  if (width === 1) return '…';
  return `${clean.slice(0, width - 1)}…`;
}

export const truncateLabel = ellipsis;
export const padRight = (text: string, width: number) => ellipsis(text, width).padEnd(width, ' ');
export const padLeft = (text: string | number, width: number) => String(text).slice(-width).padStart(width, ' ');
export const center = (text: string, width: number) => {
  const trimmed = ellipsis(text, width);
  const left = Math.floor((width - trimmed.length) / 2);
  return `${' '.repeat(Math.max(0, left))}${trimmed}${' '.repeat(Math.max(0, width - trimmed.length - left))}`;
};

export function bar(value: number | null | undefined, max = 1, width = 8): string {
  if (value === null || value === undefined || !Number.isFinite(value) || max <= 0 || width <= 0) return ' '.repeat(width);
  const ratio = Math.max(0, Math.min(1, value / max));
  const fill = Math.min(width, Math.max(0, Math.round(ratio * width)));
  return `${'▓'.repeat(fill)}${'░'.repeat(Math.max(0, width - fill))}`;
}

export function spark(values: number[], width = 18): string {
  if (!values.length || width <= 0) return ' '.repeat(width);
  const chars = '▁▂▃▄▅▆▇█';
  const bins = Array.from({ length: width }, () => 0);
  values.forEach((value, index) => {
    const bucket = Math.min(width - 1, Math.floor((index / Math.max(1, values.length)) * width));
    bins[bucket] += value;
  });
  const max = Math.max(1, ...bins);
  return bins.map((value) => chars[Math.max(0, Math.min(chars.length - 1, Math.round((value / max) * (chars.length - 1))))]).join('');
}

function hotspotShift(hotspots: DashboardHotspot[], lineOffset: number, colOffset: number): DashboardHotspot[] {
  return hotspots.map((hotspot) => ({
    ...hotspot,
    line: hotspot.line + lineOffset,
    lineEnd: hotspot.lineEnd + lineOffset,
    colStart: hotspot.colStart + colOffset,
    colEnd: hotspot.colEnd + colOffset,
  }));
}

function metricRow(label: string, value: string, width = PANEL_WIDTH - 4) {
  const valueWidth = Math.min(10, Math.max(4, value.length));
  return `${padRight(abbreviateLabel(label), Math.max(8, width - valueWidth - 1))} ${padLeft(value, valueWidth)}`;
}

function shareBarRow(item: DashboardShareItem, width = PANEL_WIDTH - 4) {
  const labelWidth = Math.max(8, width - 4 - 6 - 9 - 1);
  const label = padRight(item.label, labelWidth);
  const pct = padLeft(compactPercent(item.share), 4);
  const countText = padLeft(compactNumber(item.value ?? item.count ?? 0), 6);
  return `${label} ${pct} ${countText} ${bar(item.share, 1, 9)}`;
}

function bucketRow(label: string, count: number, total: number, max: number, width = PANEL_WIDTH - 4) {
  const pct = total > 0 ? count / total : 0;
  return `${padRight(label, 7)} ${padLeft(compactPercent(pct), 4)} ${padLeft(compactNumber(count), 5)} ${bar(count, Math.max(max, 1), 9)}`;
}

function compareShareRows(base: DashboardShareItem[], views: DashboardShareItem[], limit = 5) {
  const byLabel = new Map(views.map((item) => [item.label, item.share]));
  return base.slice(0, limit).map((item) => {
    const viewShare = byLabel.get(item.label) || 0;
    const deltaPct = (viewShare - item.share) * 100;
    const delta = `${deltaPct > 0 ? '+' : ''}${Math.abs(deltaPct) < 1 && deltaPct !== 0 ? '<1%' : `${Math.round(deltaPct)}%`}`;
    return `${padRight(item.label, 14)} ${padLeft(compactPercent(item.share), 4)} ${padLeft(compactPercent(viewShare), 4)} ${padLeft(delta, 5)}`;
  });
}

function warningRow(text: string, width = PANEL_WIDTH - 4) {
  const clean = text.startsWith('!') ? text : `! ${text}`;
  return padRight(clean, width);
}

function lowConfRow(label: string, pct: number, width = PANEL_WIDTH - 4) {
  const note = pct < 0.5 ? '! low-conf' : 'ok';
  const left = `${label.toLowerCase()} ${compactPercent(pct)}`;
  return `${padRight(left, Math.max(8, width - note.length - 1))} ${note}`;
}

function topLine(title: string, width: number) {
  const titleText = title.toUpperCase();
  const rule = Math.max(1, width - titleText.length - 6);
  return `╭─ ${titleText} ${'─'.repeat(rule)}╮`;
}

export function box({ title, lines, width = PANEL_WIDTH, bodyHeight = PANEL_BODY_HEIGHT, action, helpId }: BoxOptions): DashboardRenderResult {
  const innerWidth = width - 4;
  const padded = [...lines];
  while (padded.length < bodyHeight) padded.push('');
  const body = padded.slice(0, bodyHeight).map((line) => `│ ${padRight(line, innerWidth)} │`);
  const hotspots: DashboardHotspot[] = [];
  const help = helpFor(helpId);
  if (helpId) {
    hotspots.push({
      id: `panel-${helpId}`,
      kind: 'panel',
      line: 0,
      lineEnd: bodyHeight + 2,
      colStart: 0,
      colEnd: width,
      helpTitle: help?.title ?? title,
      helpBody: help?.body,
      helpCaveat: help?.caveat,
    });
  }
  if (action) {
    hotspots.push({
      id: `section-${action}`,
      kind: 'section',
      action,
      line: 0,
      lineEnd: 1,
      colStart: 3,
      colEnd: 3 + title.toUpperCase().length,
      helpTitle: help?.title ?? title,
      helpBody: help?.body,
      helpCaveat: help?.caveat,
    });
  }
  return {
    text: [topLine(title, width), ...body, `╰${'─'.repeat(width - 2)}╯`].join('\n'),
    hotspots,
    width,
    height: bodyHeight + 2,
  };
}

function composeColumns(columns: DashboardRenderResult[], gap = GAP): DashboardRenderResult {
  const arrays = columns.map((column) => column.text.split('\n'));
  const height = maxOf(arrays.map((items) => items.length), 0);
  const lines: string[] = [];
  const hotspots: DashboardHotspot[] = [];
  let colOffset = 0;
  columns.forEach((column, index) => {
    appendAll(hotspots, hotspotShift(column.hotspots, 0, colOffset));
    colOffset += column.width + (index < columns.length - 1 ? gap : 0);
  });
  for (let lineIndex = 0; lineIndex < height; lineIndex += 1) {
    lines.push(columns.map((column, index) => padRight(arrays[index][lineIndex] || '', column.width)).join(' '.repeat(gap)));
  }
  return { text: lines.join('\n'), hotspots, width: colOffset, height };
}

function composeGrid(rows: DashboardRenderResult[]): DashboardRenderResult {
  const lines: string[] = [];
  const hotspots: DashboardHotspot[] = [];
  let lineOffset = 0;
  rows.forEach((row, index) => {
    appendAll(lines, row.text.split('\n'));
    appendAll(hotspots, hotspotShift(row.hotspots, lineOffset, 0));
    lineOffset += row.height;
    if (index < rows.length - 1) {
      lines.push('');
      lineOffset += 1;
    }
  });
  return { text: lines.join('\n'), hotspots, width: maxOf(rows.map((row) => row.width), 0), height: lines.length };
}

function renderPresetHeader(active: DashboardTabId): DashboardRenderResult {
  let line = 'presets: ';
  const hotspots: DashboardHotspot[] = [];
  PRESET_ORDER.forEach((preset, index) => {
    const visible = preset === active ? `[${PRESET_LABELS[preset]}]` : PRESET_LABELS[preset];
    const colStart = line.length;
    line += visible;
    hotspots.push({
      id: `preset-${preset}`,
      kind: 'preset',
      action: preset,
      line: 0,
      lineEnd: 1,
      colStart,
      colEnd: colStart + visible.length,
      helpTitle: PRESET_LABELS[preset],
      helpBody: `Open the ${PRESET_LABELS[preset]} page.`,
    });
    if (index < PRESET_ORDER.length - 1) line += '  ';
  });
  return { text: line, hotspots, width: line.length, height: 1 };
}

function composeDocument(title: string, meta: string, presetLine: DashboardRenderResult, grid: DashboardRenderResult): DashboardRenderResult {
  const lines = [title, meta, presetLine.text, '', grid.text];
  return {
    text: lines.join('\n'),
    hotspots: [...hotspotShift(presetLine.hotspots, 2, 0), ...hotspotShift(grid.hotspots, 4, 0)],
    width: maxOf(lines.map((line) => line.length), 0),
    height: lines.join('\n').split('\n').length,
  };
}

function scopeLabel(snapshot: DatasetDashboardSnapshot, viewLabel?: string) {
  const scope = snapshot.scope === 'full' ? 'full dataset' : 'filtered';
  return `scope: ${scope}${viewLabel ? ` · ${viewLabel}` : ''} · snapshot: ${new Date(snapshot.calculatedAt).toLocaleString()}`;
}

function documentTitle() {
  return 'Dataset Dashboard';
}

function renderOverviewDocument(snapshot: DatasetDashboardSnapshot): DashboardRenderResult {
  const { stats } = snapshot;
  const dominantCategory = stats.composition.topCategories[0];
  const dominantLanguage = stats.composition.topLanguages[0];
  const warnings = stats.warnings.slice(0, 2);
  const row1 = composeColumns([
    box({ title: 'OVERVIEW', helpId: 'overview.overview', action: 'overview', lines: [
      metricRow('videos', compactNumber(stats.videoCount)),
      metricRow('channels', compactNumber(stats.uniqueChannelCount)),
      metricRow('comments', compactNumber(stats.totalVideoComments)),
      metricRow('categories', compactNumber(stats.categoryCount)),
      metricRow('languages', compactNumber(stats.languageCount)),
      metricRow('upload span', `${compactNumber(stats.uploadSpanDays)}d`),
      '',
      stats.uniqueChannelCount / Math.max(stats.videoCount, 1) > 0.65 ? 'channel spread is broad' : 'channels recur often',
      '',
    ]}),
    box({ title: 'TEMPORAL', helpId: 'overview.temporal', action: 'temporal', lines: [
      metricRow('oldest', safeDate(stats.time.oldestUpload)),
      metricRow('newest', safeDate(stats.time.newestUpload)),
      metricRow('median age', stats.time.medianAgeDays != null ? `${compactNumber(stats.time.medianAgeDays)}d` : '—'),
      metricRow('upload span', `${compactNumber(stats.uploadSpanDays)}d`),
      `timeline  ${spark(stats.time.uploadBins.map((bin) => bin.count), 16)}`,
      `30/90/365 ${padLeft(compactPercent((stats.time.recencyBuckets?.[0]?.count || 0) / Math.max(1, snapshot.rowCount)), 4)} ${padLeft(compactPercent((stats.time.recencyBuckets?.[1]?.count || 0) / Math.max(1, snapshot.rowCount)), 4)} ${padLeft(compactPercent((stats.time.recencyBuckets?.[2]?.count || 0) / Math.max(1, snapshot.rowCount)), 4)}`,
      '',
      stats.uploadSpanDays > 365 * 4 ? 'long observation window' : 'shorter observation window',
      '',
    ]}),
    box({ title: 'INEQUALITY', helpId: 'overview.inequality', action: 'inequality', lines: [
      metricRow('median views', compactNumber(stats.attention.medianViews)),
      metricRow('p90 views', compactNumber(stats.attention.p90Views)),
      metricRow('views/day', compactNumber(stats.attention.medianViewsPerDay)),
      metricRow('top 10% share', compactPercent(stats.attention.top10ViewShare)),
      '',
      `${padRight('views', 9)} ${bar(stats.attention.top10ViewShare, 1)} ${padLeft(compactPercent(stats.attention.top10ViewShare), 4)}`,
      `${padRight('comments', 9)} ${bar(stats.comments.top10CommentShare, 1)} ${padLeft(compactPercent(stats.comments.top10CommentShare), 4)}`,
      `${padRight('channels', 9)} ${bar(stats.channelMix.topChannelsByViews[0]?.share ?? stats.channelMix.topChannelsByRows[0]?.share, 1)} ${padLeft(stats.channelMix.dominance, 4)}`,
      (stats.attention.top10ViewShare || 0) > 0.75 ? 'attention is highly skewed' : 'attention is less concentrated',
    ]}),
  ]);

  const row2 = composeColumns([
    box({ title: 'CONTENT', helpId: 'overview.content', action: 'content', lines: [
      ...stats.composition.topCategories.slice(0, 5).map((item) => shareBarRow(item)),
      '',
      `dominant ${padLeft(compactPercent(dominantCategory?.share), 4)}  ${ellipsis(dominantCategory?.label || '—', PANEL_WIDTH - 19)}`,
      (dominantCategory?.share || 0) > 0.5 ? 'one category leads clearly' : 'category mix is broader',
      '',
    ]}),
    box({ title: 'LOCALE', helpId: 'overview.locale', action: 'locale', lines: [
      ...stats.composition.topLanguages.slice(0, 5).map((item) => shareBarRow(item)),
      '',
      `dominant ${padLeft(compactPercent(dominantLanguage?.share), 4)}  ${ellipsis(dominantLanguage?.label || '—', PANEL_WIDTH - 19)}`,
      (dominantLanguage?.share || 0) > 0.75 ? 'one language dominates' : 'language mix is broader',
      '',
    ]}),
    box({ title: 'RELIABILITY', helpId: 'overview.reliability', action: 'reliability', lines: [
      lowConfRow('thumbnails', stats.coverage.thumbnailsPresentPct),
      lowConfRow('descriptions', stats.coverage.descriptionsPresentPct),
      lowConfRow('tags', stats.coverage.tagsPresentPct),
      lowConfRow('captions', stats.coverage.captionsAvailablePct),
      lowConfRow('transcripts', stats.coverage.transcriptsPresentPct),
      '─'.repeat(PANEL_WIDTH - 4),
      warningRow(warnings[0] ? `warning  ${warnings[0]}` : 'warning  none flagged'),
      warningRow(warnings[1] ? `warning  ${warnings[1]}` : 'warning  metadata gaps remain'),
      stats.coverage.transcriptsPresentPct < 0.1 || stats.coverage.tagsPresentPct < 0.5 ? 'some fields are sparse' : 'metadata looks steadier',
    ]}),
  ]);

  return composeDocument(documentTitle(), scopeLabel(snapshot, `rows: ${compactNumber(snapshot.rowCount)}`), renderPresetHeader('overview'), composeGrid([row1, row2]));
}

function renderTemporalDocument(snapshot: DatasetDashboardSnapshot): DashboardRenderResult {
  const { time, videoCount } = snapshot.stats;
  const recency = time.recencyBuckets || [];
  const age = time.ageBuckets || [];
  const maxYearCount = Math.max(1, ...time.uploadBins.map((bin) => bin.count));
  const row1 = composeColumns([
    box({ title: 'SUMMARY', helpId: 'temporal.summary', lines: [
      metricRow('oldest', safeDate(time.oldestUpload)),
      metricRow('newest', safeDate(time.newestUpload)),
      metricRow('median age', time.medianAgeDays != null ? `${compactNumber(time.medianAgeDays)}d` : '—'),
      metricRow('upload span', `${compactNumber(snapshot.stats.uploadSpanDays)}d`),
      metricRow('uploads/day', time.uploadsPerDay != null ? time.uploadsPerDay.toFixed(2) : '—'),
      metricRow('uploads/year', time.uploadsPerYear != null ? compactNumber(time.uploadsPerYear) : '—'),
      '',
      `rows covered ${compactNumber(videoCount)}`,
      '',
    ]}),
    box({ title: 'YEAR HISTOGRAM', helpId: 'temporal.histogram', lines: [
      `timeline  ${spark(time.uploadBins.map((bin) => bin.count), 18)}`,
      '',
      ...time.uploadBins.slice(0, 5).map((bin) => `${padRight(bin.label.slice(0, 4), 6)} ${padLeft(String(bin.count), 4)} ${bar(bin.count, maxYearCount)}`),
      '',
      'bars mark relative upload density',
    ]}),
    box({ title: 'RECENCY BUCKETS', helpId: 'temporal.recency', lines: recency.length ? [
      ...recency.map((bucket) => bucketRow(bucket.label, bucket.count, videoCount, maxOf(recency.map((item) => item.count), 1))),
      '',
      (recency[0]?.count || 0) / Math.max(videoCount, 1) > 0.2 ? 'recent uploads stand out' : 'recent uploads are limited',
      '',
    ] : ['No recency signal', '', '', '', '', '', '', '', '']}),
  ]);
  const row2 = composeColumns([
    box({ title: 'AGE DISTRIBUTION', helpId: 'temporal.age', lines: age.length ? [
      ...age.map((bucket) => bucketRow(bucket.label, bucket.count, videoCount, maxOf(age.map((item) => item.count), 1))),
      '',
      (age[4]?.count || 0) / Math.max(videoCount, 1) > 0.25 ? 'older archive remains visible' : 'distribution leans newer',
      '',
    ] : ['No age distribution', '', '', '', '', '', '', '', '']}),
    box({ title: 'CADENCE', helpId: 'temporal.cadence', lines: [
      metricRow('uploads/day', time.uploadsPerDay != null ? time.uploadsPerDay.toFixed(2) : '—'),
      metricRow('uploads/year', time.uploadsPerYear != null ? compactNumber(time.uploadsPerYear) : '—'),
      metricRow('total uploads', compactNumber(videoCount)),
      '',
      `active period ${compactNumber(snapshot.stats.uploadSpanDays)} days`,
      '',
      (time.uploadsPerYear || 0) > 100 ? 'output cadence is brisk' : 'output cadence is moderate',
      '',
      '',
    ]}),
    box({ title: 'TEMPORAL NOTES', helpId: 'temporal.notes', lines: [
      snapshot.stats.uploadSpanDays > 365 * 4 ? 'Long observational window.' : 'Moderate observational window.',
      `Range ${safeDate(time.oldestUpload)} → ${safeDate(time.newestUpload)}.`,
      recency[3] && recency[3].count / Math.max(videoCount, 1) > 0.5 ? 'Older uploads still dominate.' : 'Recent uploads contribute visibly.',
      'Descriptive snapshot only.',
      'No forecasting or seasonality inference.',
      '', '', '', '',
    ]}),
  ]);
  return composeDocument(documentTitle(), scopeLabel(snapshot, 'temporal view'), renderPresetHeader('temporal'), composeGrid([row1, row2]));
}

function renderInequalityDocument(snapshot: DatasetDashboardSnapshot): DashboardRenderResult {
  const { attention, channelMix, comments } = snapshot.stats;
  const rowNames = channelMix.topChannelsByRows.slice(0, 4);
  const viewByName = new Map(channelMix.topChannelsByViews.map((item) => [item.label, item.share]));
  const channelLines = rowNames.length
    ? rowNames.map((item) => {
        const viewShare = viewByName.get(item.label) || 0;
        const deltaPct = (viewShare - item.share) * 100;
        const delta = `${deltaPct > 0 ? '+' : ''}${Math.abs(deltaPct) < 1 && deltaPct !== 0 ? '<1%' : `${Math.round(deltaPct)}%`}`;
        return `${padRight(item.label, 14)} ${padLeft(compactPercent(item.share), 4)} ${padLeft(compactPercent(viewShare), 4)} ${padLeft(delta, 5)}`;
      })
    : ['No channel mix available'];

  const row1 = composeColumns([
    box({ title: 'SUMMARY', helpId: 'ineq.summary', lines: [
      metricRow('median views', compactNumber(attention.medianViews)),
      metricRow('p75 views', compactNumber(attention.p75Views)),
      metricRow('p90 views', compactNumber(attention.p90Views)),
      metricRow('views/day', compactNumber(attention.medianViewsPerDay)),
      metricRow('top 10% share', compactPercent(attention.top10ViewShare)),
      '',
      metricRow('dominance', channelMix.dominance),
      (attention.top10ViewShare || 0) > 0.8 ? 'extreme concentration' : 'more moderate concentration',
      '',
    ]}),
    box({ title: 'PERCENTILE LADDER', helpId: 'ineq.ladder', lines: [
      `${padRight('p50', 6)} ${padLeft(compactNumber(attention.medianViews), 6)} ${bar(attention.medianViews || 0, attention.p90Views || 1)}`,
      `${padRight('p75', 6)} ${padLeft(compactNumber(attention.p75Views), 6)} ${bar(attention.p75Views || 0, attention.p90Views || 1)}`,
      `${padRight('p90', 6)} ${padLeft(compactNumber(attention.p90Views), 6)} ${bar(attention.p90Views || 0, attention.p90Views || 1)}`,
      `${padRight('top10', 6)} ${padLeft(compactPercent(attention.top10ViewShare), 6)} ${bar(attention.top10ViewShare || 0, 1)}`,
      '',
      'The ladder shows how quickly',
      'attention accumulates near the top.',
      '',
      '',
    ]}),
    box({ title: 'TOP SHARES', helpId: 'ineq.topshares', lines: [
      metricRow('top1', compactPercent(attention.top1ViewShare)),
      metricRow('top5', compactPercent(attention.top5ViewShare)),
      metricRow('top10', compactPercent(attention.top10ViewShare)),
      metricRow('top50', compactPercent(attention.top50ViewShare)),
      '',
      `${padRight('top1', 6)} ${bar(attention.top1ViewShare || 0, 1)} ${padLeft(compactPercent(attention.top1ViewShare), 4)}`,
      `${padRight('top5', 6)} ${bar(attention.top5ViewShare || 0, 1)} ${padLeft(compactPercent(attention.top5ViewShare), 4)}`,
      `${padRight('top50', 6)} ${bar(attention.top50ViewShare || 0, 1)} ${padLeft(compactPercent(attention.top50ViewShare), 4)}`,
      (attention.top1ViewShare || 0) > 0.35 ? 'very top-heavy distribution' : 'less top-heavy distribution',
    ]}),
  ]);

  const row2 = composeColumns([
    box({ title: 'CHANNEL MIX', helpId: 'ineq.channels', lines: [
      'rows  views delta',
      ...channelLines,
      '',
      metricRow('top5 rows', compactPercent(channelMix.top5RowsShare)),
      metricRow('top5 views', compactPercent(channelMix.top5ViewsShare)),
      channelMix.dominance === 'high' ? 'channel concentration is high' : 'channel concentration is limited',
      '',
    ]}),
    box({ title: 'COMMENTS / ENGAGEMENT', helpId: 'ineq.comments', lines: [
      metricRow('total comments', compactNumber(comments.totalVideoComments)),
      metricRow('median/video', compactNumber(comments.medianCommentsPerVideo)),
      metricRow('top10 share', compactPercent(comments.top10CommentShare)),
      '',
      `${padRight('comments', 9)} ${bar(comments.top10CommentShare, 1)} ${padLeft(compactPercent(comments.top10CommentShare), 4)}`,
      'video-level counts only',
      (comments.top10CommentShare || 0) > 0.75 ? 'commenting is concentrated' : 'commenting is less concentrated',
      '',
      '',
    ]}),
    box({ title: 'INEQUALITY METRICS', helpId: 'ineq.metrics', lines: [
      metricRow('gini', attention.giniViews != null ? attention.giniViews.toFixed(3) : '—'),
      metricRow('views hhi', attention.hhiViews != null ? attention.hhiViews.toFixed(3) : '—'),
      metricRow('channel hhi', channelMix.hhiViews != null ? channelMix.hhiViews.toFixed(3) : '—'),
      metricRow('dominance', channelMix.dominance),
      '',
      'Share metrics carry the primary read.',
      'Gini / HHI act as secondary checks.',
      '',
      '',
    ]}),
  ]);

  return composeDocument(documentTitle(), scopeLabel(snapshot, 'inequality view'), renderPresetHeader('inequality'), composeGrid([row1, row2]));
}

function renderContentDocument(snapshot: DatasetDashboardSnapshot): DashboardRenderResult {
  const { composition, categoryCount } = snapshot.stats;
  const dominant = composition.topCategories[0];
  const overIndex = compareShareRows(composition.topCategories, composition.topCategoriesByViews || [], 5);
  const keywordLines = (composition.keywordTokens || []).slice(0, 5).map((item) => `${padRight(item.label, 16)} ${padLeft(compactNumber(item.count), 4)} ${bar(item.share, 1)}`);

  const row1 = composeColumns([
    box({ title: 'SUMMARY', helpId: 'content.summary', lines: [
      metricRow('categories', compactNumber(categoryCount)),
      metricRow('dominant', dominant?.label || '—'),
      metricRow('dom. share', compactPercent(dominant?.share)),
      metricRow('long tail', compactPercent(composition.longTailCategoryShare)),
      '',
      'output unit  rows / videos',
      (dominant?.share || 0) > 0.5 ? 'one category leads clearly' : 'mix is more distributed',
      '',
      '',
    ]}),
    box({ title: 'TOP CATEGORIES', helpId: 'content.top', lines: [
      ...composition.topCategories.slice(0, 5).map((item) => shareBarRow(item)),
      '',
      `dominant ${padLeft(compactPercent(dominant?.share), 4)}  ${ellipsis(dominant?.label || '—', PANEL_WIDTH - 19)}`,
      '',
      '',
    ]}),
    box({ title: 'CATEGORIES BY VIEWS', helpId: 'content.views', lines: composition.topCategoriesByViews?.length ? [
      ...composition.topCategoriesByViews.slice(0, 5).map((item) => shareBarRow(item)),
      '',
      composition.topCategoriesByViews[0]?.label !== dominant?.label ? 'attention order differs from output' : 'attention follows output closely',
      '',
      '',
    ] : ['View aggregation unavailable', '', '', '', '', '', '', '', '']}),
  ]);

  const row2 = composeColumns([
    box({ title: 'CATEGORIES BY OUTPUT', helpId: 'content.output', lines: [
      ...composition.topCategories.slice(0, 5).map((item) => shareBarRow(item)),
      '',
      `long tail ${padLeft(compactPercent(composition.longTailCategoryShare), 4)} of rows`,
      '',
      '',
    ]}),
    box({ title: 'OVER-INDEX', helpId: 'content.overindex', lines: overIndex.length ? [
      'rows  views delta',
      ...overIndex.slice(0, 5),
      '',
      'positive delta = punch above weight',
      '',
      '',
    ] : ['Insufficient row / view pairing', '', '', '', '', '', '', '', '']}),
    box({ title: keywordLines.length ? 'KEYWORDS' : 'LONG TAIL', helpId: 'content.keywords', lines: keywordLines.length ? [
      ...keywordLines,
      '',
      `long tail share ${compactPercent(composition.longTailCategoryShare)}`,
      'Lightweight ranking from titles and',
      'descriptions only.',
      '', '', '', '',
    ] : [
      metricRow('long tail', compactPercent(composition.longTailCategoryShare)),
      metricRow('dominant', dominant?.label || '—'),
      'Keyword panel omitted to stay light.', '', '', '', '', '', '',
    ]}),
  ]);

  return composeDocument(documentTitle(), scopeLabel(snapshot, 'content view'), renderPresetHeader('content'), composeGrid([row1, row2]));
}

function renderLocaleDocument(snapshot: DatasetDashboardSnapshot): DashboardRenderResult {
  const { composition, languageCount } = snapshot.stats;
  const dominant = composition.topLanguages[0];
  const overIndex = compareShareRows(composition.topLanguages, composition.topLanguagesByViews || [], 5);
  const top3Share = composition.topLanguages.slice(0, 3).reduce((sum, item) => sum + item.share, 0);

  const row1 = composeColumns([
    box({ title: 'SUMMARY', helpId: 'locale.summary', lines: [
      metricRow('languages', compactNumber(languageCount)),
      metricRow('dominant', dominant?.label || '—'),
      metricRow('dom. share', compactPercent(dominant?.share)),
      metricRow('mix', dominant?.share != null && dominant.share > 0.75 ? 'concentrated' : 'broader'),
      '',
      'Locale view is language-oriented.',
      (dominant?.share || 0) > 0.8 ? 'one language strongly dominates' : 'language mix is more distributed',
      '',
      '',
    ]}),
    box({ title: 'TOP LANGUAGES', helpId: 'locale.top', lines: [
      ...composition.topLanguages.slice(0, 5).map((item) => shareBarRow(item)),
      '',
      `dominant ${padLeft(compactPercent(dominant?.share), 4)}  ${ellipsis(dominant?.label || '—', PANEL_WIDTH - 19)}`,
      '',
      '',
    ]}),
    box({ title: 'LANGUAGE BY VIEWS', helpId: 'locale.views', lines: composition.topLanguagesByViews?.length ? [
      ...composition.topLanguagesByViews.slice(0, 5).map((item) => shareBarRow(item)),
      '',
      composition.topLanguagesByViews[0]?.label !== dominant?.label ? 'attention order differs from volume' : 'view share tracks row share',
      '',
      '',
    ] : ['View aggregation unavailable', '', '', '', '', '', '', '', '']}),
  ]);

  const row2 = composeColumns([
    box({ title: 'LANGUAGE OVER-INDEX', helpId: 'locale.overindex', lines: overIndex.length ? [
      'rows  views delta',
      ...overIndex.slice(0, 5),
      '',
      'positive delta = stronger attention',
      '',
      '',
    ] : ['Insufficient row / view pairing', '', '', '', '', '', '', '', '']}),
    box({ title: 'LANGUAGE MIX', helpId: 'locale.mix', lines: [
      metricRow('top1 share', compactPercent(dominant?.share)),
      metricRow('top3 share', compactPercent(top3Share)),
      metricRow('longer tail', languageCount > 5 ? 'present' : 'limited'),
      '',
      `${padRight('top1', 9)} ${bar(dominant?.share, 1)} ${padLeft(compactPercent(dominant?.share), 4)}`,
      `${padRight('top3', 9)} ${bar(top3Share, 1)} ${padLeft(compactPercent(top3Share), 4)}`,
      top3Share > 0.95 ? 'top three dominate strongly' : 'some tail remains visible',
      '',
      '',
    ]}),
    box({ title: 'LOCALE NOTES', helpId: 'locale.notes', lines: [
      'This page describes language mix, not geography.',
      'Regional/country inference is intentionally omitted.',
      'Language variants collapse to base codes.',
      '',
      'Use this page for language composition,',
      'not territorial claims.',
      '', '', '',
    ]}),
  ]);

  return composeDocument(documentTitle(), scopeLabel(snapshot, 'locale view'), renderPresetHeader('locale'), composeGrid([row1, row2]));
}

function renderReliabilityDocument(snapshot: DatasetDashboardSnapshot): DashboardRenderResult {
  const { coverage, warnings, dataQuality } = snapshot.stats;
  const coverageEntries = [
    ['thumbnails', coverage.thumbnailsPresentPct],
    ['descriptions', coverage.descriptionsPresentPct],
    ['tags', coverage.tagsPresentPct],
    ['captions', coverage.captionsAvailablePct],
    ['transcripts', coverage.transcriptsPresentPct],
  ] as const;

  const row1 = composeColumns([
    box({ title: 'COVERAGE', helpId: 'reliability.coverage', lines: [
      ...coverageEntries.map(([label, value]) => `${padRight(label, 12)} ${padLeft(compactPercent(value), 4)} ${bar(value, 1)}`),
      '',
      coverage.transcriptsPresentPct < 0.1 || coverage.tagsPresentPct < 0.5 ? 'coverage is uneven' : 'coverage is relatively stable',
      '',
      '',
    ]}),
    box({ title: 'LOW-CONFIDENCE', helpId: 'reliability.lowconf', lines: [
      ...coverageEntries.map(([label, value]) => lowConfRow(label, value)),
      '',
      'Sparse fields should be read cautiously.',
      '',
      '',
    ]}),
    box({ title: 'WARNINGS', helpId: 'reliability.warnings', lines: [
      ...(warnings.length ? warnings.slice(0, 4).map((warning) => warningRow(`warning  ${warning}`)) : [warningRow('warning  none flagged')]),
      '',
      'Warnings flag interpretation limits,',
      'not parser errors.',
      '', '', '', '', '',
    ]}),
  ]);

  const row2 = composeColumns([
    box({ title: 'COMPARABILITY', helpId: 'reliability.comparability', lines: [
      `views    ${ellipsis(dataQuality.viewsComparability, PANEL_WIDTH - 13)}`,
      `comments ${ellipsis(dataQuality.commentsNote, PANEL_WIDTH - 13)}`,
      `scope    ${snapshot.scope === 'full' ? 'full dataset' : 'filtered view'}`,
      '',
      'Metadata gaps affect interpretation.',
      '', '', '', '',
    ]}),
    box({ title: 'MISSINGNESS PROFILE', helpId: 'reliability.missing', lines: [
      ...coverageEntries.map(([label, value]) => `${padRight(label, 12)} ${padLeft(compactPercent(1 - value), 4)} miss ${bar(1 - value, 1)}`),
      '',
      coverage.captionsAvailablePct < 0.1 || coverage.transcriptsPresentPct < 0.1 ? 'text supports are scarce' : 'text supports are more available',
      '',
      '',
    ]}),
    box({ title: 'METHOD FOOTER', helpId: 'reliability.method', lines: [
      'refresh-driven snapshot only',
      `rows covered  ${compactNumber(snapshot.rowCount)}`,
      `scope         ${snapshot.scope === 'full' ? 'full dataset' : 'filtered view'}`,
      'copy output matches rendered document',
      '',
      'Use refresh after filters or data changes.',
      '', '', '',
    ]}),
  ]);

  return composeDocument(documentTitle(), scopeLabel(snapshot, 'reliability view'), renderPresetHeader('reliability'), composeGrid([row1, row2]));
}

export function renderDashboardDocument(snapshot: DatasetDashboardSnapshot | undefined, active: DashboardTabId): DashboardRenderResult {
  if (!snapshot) {
    const preset = renderPresetHeader(active);
    const intro = composeGrid([
      composeColumns([
        box({ title: 'OVERVIEW', action: 'overview', helpId: 'overview.overview', lines: ['No dashboard snapshot calculated yet.', '', 'Press Refresh to compute the current scope.', '', '', '', '', '', ''] }),
        box({ title: 'TEMPORAL', action: 'temporal', helpId: 'overview.temporal', lines: ['Refresh computes only the current scope.', '', 'Scope can be full dataset or filtered.', '', '', '', '', '', ''] }),
        box({ title: 'INEQUALITY', action: 'inequality', helpId: 'overview.inequality', lines: ['Snapshots stay visible when stale.', '', 'Refresh updates them when you are ready.', '', '', '', '', '', ''] }),
      ]),
      composeColumns([
        box({ title: 'CONTENT', action: 'content', helpId: 'overview.content', lines: ['The document renderer is also the copy source.', '', 'Clipboard output matches what you see.', '', '', '', '', '', ''] }),
        box({ title: 'LOCALE', action: 'locale', helpId: 'overview.locale', lines: ['Preset names and overview titles are clickable.', '', 'Hover panels for concise reading help.', '', '', '', '', '', ''] }),
        box({ title: 'RELIABILITY', action: 'reliability', helpId: 'overview.reliability', lines: ['The dashboard stays lightweight and refresh-only.', '', '', '', '', '', '', '', ''] }),
      ]),
    ]);
    return composeDocument(documentTitle(), 'scope: not calculated yet', preset, intro);
  }

  switch (active) {
    case 'temporal':
      return renderTemporalDocument(snapshot);
    case 'inequality':
      return renderInequalityDocument(snapshot);
    case 'content':
      return renderContentDocument(snapshot);
    case 'locale':
      return renderLocaleDocument(snapshot);
    case 'reliability':
      return renderReliabilityDocument(snapshot);
    case 'overview':
    default:
      return renderOverviewDocument(snapshot);
  }
}
