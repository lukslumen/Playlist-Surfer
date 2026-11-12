import type {
  DashboardOverviewBucket,
  DashboardOverviewProfile,
  DashboardOverviewShare,
  DashboardOverviewTimeBin,
  DashboardTemplateVideoRecord,
} from './dashboardTemplateTypes';

// The dashboard's overview tab: headline numbers, a plain-language summary, the upload timeline and
// the length, views, category and language distributions. Pure, so it can be tested and snapshotted.

const DAY_MS = 24 * 60 * 60 * 1000;
export const UNKNOWN_LANGUAGE = 'unknown';

const LENGTH_BUCKETS: Array<Omit<DashboardOverviewBucket, 'count' | 'share'>> = [
  { key: 'under-1m', label: 'Under 1 min', min: 0, max: 60 },
  { key: '1-4m', label: '1–4 min', min: 60, max: 240 },
  { key: '4-10m', label: '4–10 min', min: 240, max: 600 },
  { key: '10-20m', label: '10–20 min', min: 600, max: 1200 },
  { key: '20-60m', label: '20–60 min', min: 1200, max: 3600 },
  { key: 'over-1h', label: 'Over 1 hour', min: 3600, max: null },
];

const VIEW_BUCKETS: Array<Omit<DashboardOverviewBucket, 'count' | 'share'>> = [
  { key: 'under-1k', label: 'Under 1K', min: 0, max: 1_000 },
  { key: '1k-10k', label: '1K–10K', min: 1_000, max: 10_000 },
  { key: '10k-100k', label: '10K–100K', min: 10_000, max: 100_000 },
  { key: '100k-1m', label: '100K–1M', min: 100_000, max: 1_000_000 },
  { key: '1m-10m', label: '1M–10M', min: 1_000_000, max: 10_000_000 },
  { key: 'over-10m', label: '10M+', min: 10_000_000, max: null },
];

const MONTH_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const DAY_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Base language code (en, nl, …) or UNKNOWN_LANGUAGE for empty, undetermined or malformed values. */
export function normalizeLanguage(rawValue: string): string {
  const normalized = String(rawValue ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!normalized || normalized === 'na' || normalized === 'n/a' || normalized === 'none') return UNKNOWN_LANGUAGE;
  const base = normalized.split('-')[0].trim();
  if (!base || base === 'und' || base === 'zxx') return UNKNOWN_LANGUAGE;
  if (!/^[a-z]{2,3}$/.test(base)) return UNKNOWN_LANGUAGE;
  return base;
}

let languageNames: Intl.DisplayNames | null | undefined;
/** "English" for "en"; the upper-cased code when the browser has no name for it. */
export function languageName(code: string): string {
  if (languageNames === undefined) {
    try {
      languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
    } catch {
      languageNames = null;
    }
  }
  try {
    const name = languageNames?.of(code);
    if (name && name.toLowerCase() !== code.toLowerCase()) return name;
  } catch {
    // Not a valid code for Intl; fall through.
  }
  return code.toUpperCase();
}

export function parsePublishedTimestamp(value: string | undefined): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric > 1e12) return Math.floor(numeric);
    if (numeric > 1e9) return Math.floor(numeric * 1000);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

export function quantile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

type TimeUnit = DashboardOverviewProfile['uploads']['unit'];

/** A unit that gives a readable number of bars (roughly 10–80) for the span. */
export function chooseTimeUnit(spanMs: number): TimeUnit {
  const days = spanMs / DAY_MS;
  if (days <= 60) return 'day';
  if (days <= 2 * 365) return 'week';
  if (days <= 12 * 365) return 'month';
  if (days <= 40 * 365) return 'quarter';
  return 'year';
}

/** The start (UTC) of the bin that contains `ts`. Weeks start on Monday. */
export function binStart(ts: number, unit: TimeUnit): number {
  const date = new Date(ts);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  switch (unit) {
    case 'day': return Date.UTC(year, month, date.getUTCDate());
    case 'week': {
      const day = Date.UTC(year, month, date.getUTCDate());
      const weekday = (new Date(day).getUTCDay() + 6) % 7;
      return day - weekday * DAY_MS;
    }
    case 'month': return Date.UTC(year, month, 1);
    case 'quarter': return Date.UTC(year, Math.floor(month / 3) * 3, 1);
    case 'year': return Date.UTC(year, 0, 1);
  }
}

function nextBinStart(start: number, unit: TimeUnit): number {
  const date = new Date(start);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  switch (unit) {
    case 'day': return start + DAY_MS;
    case 'week': return start + 7 * DAY_MS;
    case 'month': return Date.UTC(year, month + 1, 1);
    case 'quarter': return Date.UTC(year, month + 3, 1);
    case 'year': return Date.UTC(year + 1, 0, 1);
  }
}

function binLabel(start: number, unit: TimeUnit): string {
  const date = new Date(start);
  switch (unit) {
    case 'day': return DAY_FMT.format(start);
    case 'week': return `Week of ${DAY_FMT.format(start)}`;
    case 'month': return MONTH_FMT.format(start);
    case 'quarter': return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
    case 'year': return String(date.getUTCFullYear());
  }
}

/** Upload counts per calendar bin from the first to the last upload, including empty bins. */
export function buildUploadBins(timestamps: number[]): DashboardOverviewProfile['uploads'] {
  if (!timestamps.length) return { unit: 'month', bins: [], maxCount: 0, busiest: null };
  let minTs = Infinity;
  let maxTs = -Infinity;
  timestamps.forEach((ts) => {
    if (ts < minTs) minTs = ts;
    if (ts > maxTs) maxTs = ts;
  });
  const unit = chooseTimeUnit(maxTs - minTs);
  const counts = new Map<number, number>();
  timestamps.forEach((ts) => {
    const start = binStart(ts, unit);
    counts.set(start, (counts.get(start) ?? 0) + 1);
  });
  const bins: DashboardOverviewTimeBin[] = [];
  for (let start = binStart(minTs, unit); start <= maxTs; start = nextBinStart(start, unit)) {
    bins.push({ startTs: start, endTs: nextBinStart(start, unit), label: binLabel(start, unit), count: counts.get(start) ?? 0 });
  }
  const busiest = bins.reduce<DashboardOverviewTimeBin | null>((best, bin) => (!best || bin.count > best.count ? bin : best), null);
  return { unit, bins, maxCount: busiest?.count ?? 0, busiest };
}

/** Counts values into buckets, dropping empty buckets at either end so the chart shows the populated range. */
export function bucketize(values: number[], definitions: Array<Omit<DashboardOverviewBucket, 'count' | 'share'>>): DashboardOverviewBucket[] {
  const total = values.length;
  const buckets = definitions.map((definition) => ({ ...definition, count: 0, share: 0 }));
  values.forEach((value) => {
    const bucket = buckets.find((entry) => value >= entry.min && (entry.max === null || value < entry.max));
    if (bucket) bucket.count += 1;
  });
  buckets.forEach((bucket) => { bucket.share = total ? bucket.count / total : 0; });
  const first = buckets.findIndex((bucket) => bucket.count > 0);
  if (first < 0) return [];
  let last = buckets.length - 1;
  while (last > first && buckets[last].count === 0) last -= 1;
  return buckets.slice(first, last + 1);
}

/** The most common values, then one "Other" entry for the rest; unknown values come last as `unknownLabel`. */
export function topShares(values: Array<string | null>, limit: number, unknownLabel: string, labelFor: (value: string) => string = (value) => value): DashboardOverviewShare[] {
  const total = values.length;
  if (!total) return [];
  const counts = new Map<string, number>();
  let unknown = 0;
  values.forEach((value) => {
    if (!value) {
      unknown += 1;
      return;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  const sorted = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  const shown = sorted.slice(0, limit).map(([value, count]) => ({ label: labelFor(value), filterValue: value, count, share: count / total }));
  const otherCount = sorted.slice(limit).reduce((acc, [, count]) => acc + count, 0);
  if (otherCount) shown.push({ label: `Other (${(sorted.length - limit).toLocaleString('en-US')})`, filterValue: undefined, count: otherCount, share: otherCount / total });
  if (unknown) shown.push({ label: unknownLabel, filterValue: undefined, count: unknown, share: unknown / total });
  return shown;
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const percent = (share: number) => `${Math.round(share * 100)}%`;

function formatRange(first: number | null, last: number | null): string | null {
  if (first === null || last === null) return null;
  const firstLabel = MONTH_FMT.format(first);
  const lastLabel = MONTH_FMT.format(last);
  return firstLabel === lastLabel ? `in ${firstLabel}` : `between ${firstLabel} and ${lastLabel}`;
}

function buildSummary(profile: Omit<DashboardOverviewProfile, 'summary'>): string[] {
  if (!profile.videos) return ['This scope has no videos.'];
  const sentences: string[] = [];
  const who = profile.channels === 1
    ? `one channel${profile.singleChannelName ? ` (${profile.singleChannelName})` : ''}`
    : `${profile.channels.toLocaleString('en-US')} channels`;
  const range = formatRange(profile.firstPublishedTs, profile.lastPublishedTs);
  sentences.push(`${profile.videos.toLocaleString('en-US')} ${profile.videos === 1 ? 'video' : 'videos'} from ${who}${range ? `, published ${range}` : ''}.`);

  const parts: string[] = [];
  const topLength = [...profile.lengths].sort((a, b) => b.count - a.count)[0];
  if (topLength) {
    parts.push(topLength.share > 0.5
      ? `Most are ${topLength.label.toLowerCase()} long (${percent(topLength.share)})`
      : `Lengths vary; ${topLength.label.toLowerCase()} is the most common (${percent(topLength.share)})`);
  }
  if (profile.medianViews !== null) parts.push(`the typical video has ${compact.format(profile.medianViews)} views`);
  if (parts.length) sentences.push(`${parts.join(', and ')}.`);
  const shorts = profile.formats.find((entry) => entry.label === 'Shorts');
  if (profile.formats.length) sentences.push(shorts ? `${percent(shorts.share)} are Shorts.` : 'None are Shorts.');

  const traits: string[] = [];
  const topCategory = profile.categories.find((entry) => entry.filterValue);
  if (topCategory && topCategory.share > 0.5) traits.push(`${topCategory.label} (${percent(topCategory.share)})`);
  const topLanguage = profile.languages.find((entry) => entry.filterValue);
  if (topLanguage && topLanguage.share > 0.5) traits.push(`in ${topLanguage.label} (${percent(topLanguage.share)})`);
  if (traits.length) sentences.push(`Mostly ${traits.join(' and ')}.`);
  return sentences;
}

/** Shorts vs regular videos from the isShort flag, keeping the stored values for drill-downs. */
export function buildFormats(records: DashboardTemplateVideoRecord[]): DashboardOverviewShare[] {
  if (!records.some((record) => record.isShort !== null && record.isShort !== undefined)) return [];
  const tally = { short: 0, regular: 0, unknown: 0 };
  const raw: { short?: string; regular?: string } = {};
  records.forEach((record) => {
    if (record.isShort === true) {
      tally.short += 1;
      raw.short ??= String(record.isShortRaw ?? 'yes');
    } else if (record.isShort === false) {
      tally.regular += 1;
      raw.regular ??= String(record.isShortRaw ?? 'no');
    } else tally.unknown += 1;
  });
  const total = records.length;
  return [
    { label: 'Shorts', filterValue: raw.short, count: tally.short, share: tally.short / total },
    { label: 'Regular videos', filterValue: raw.regular, count: tally.regular, share: tally.regular / total },
    ...(tally.unknown ? [{ label: 'Not flagged', count: tally.unknown, share: tally.unknown / total }] : []),
  ].filter((entry) => entry.count > 0);
}

/** Median subscriber count over the set's channels (each channel once). */
function medianChannelSubscribers(records: DashboardTemplateVideoRecord[]): number | null {
  const byChannel = new Map<string, number>();
  records.forEach((record) => {
    const key = record.channelId || record.channelTitle;
    if (key && record.channelSubscribers !== null && record.channelSubscribers !== undefined && !byChannel.has(key)) byChannel.set(key, record.channelSubscribers);
  });
  return median([...byChannel.values()]);
}

export function buildOverviewProfile(records: DashboardTemplateVideoRecord[]): DashboardOverviewProfile {
  const channelKeys = new Set<string>();
  const channelNames = new Set<string>();
  const timestamps: number[] = [];
  const views: number[] = [];
  const durations: number[] = [];
  const engagement: number[] = [];
  let totalViews = 0;
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  // Count languages from one field, so a drill-down filters on the same field the chart counted.
  const languageSource = records.some((record) => normalizeLanguage(record.defaultAudioLanguage) !== UNKNOWN_LANGUAGE) ? 'audio' : 'declared';

  records.forEach((record) => {
    const channelKey = record.channelId || record.channelTitle;
    if (channelKey) channelKeys.add(channelKey);
    if (record.channelTitle) channelNames.add(record.channelTitle);
    const ts = parsePublishedTimestamp(record.publishedAt);
    if (ts !== null) {
      timestamps.push(ts);
      if (firstTs === null || ts < firstTs) firstTs = ts;
      if (lastTs === null || ts > lastTs) lastTs = ts;
    }
    if (record.viewCount !== null && Number.isFinite(record.viewCount) && record.viewCount >= 0) {
      views.push(record.viewCount);
      totalViews += record.viewCount;
      if (record.viewCount > 0 && (record.likeCount !== null || record.commentCount !== null)) {
        engagement.push((((record.likeCount ?? 0) + (record.commentCount ?? 0)) / record.viewCount) * 1000);
      }
    }
    if (record.durationSec !== null && Number.isFinite(record.durationSec) && record.durationSec > 0) durations.push(record.durationSec);
  });

  const uploads = buildUploadBins(timestamps);
  const base = {
    videos: records.length,
    channels: channelKeys.size,
    singleChannelName: channelKeys.size === 1 && channelNames.size === 1 ? [...channelNames][0] : null,
    firstPublishedTs: firstTs,
    lastPublishedTs: lastTs,
    datedCount: timestamps.length,
    totalViews,
    medianViews: median(views),
    p10Views: quantile(views, 0.1),
    p90Views: quantile(views, 0.9),
    medianDurationSec: median(durations),
    medianEngagementPerThousand: median(engagement),
    uploads,
    lengths: bucketize(durations, LENGTH_BUCKETS),
    lengthUnknownCount: records.length - durations.length,
    views: bucketize(views, VIEW_BUCKETS),
    viewsUnknownCount: records.length - views.length,
    categories: topShares(records.map((record) => record.videoCategoryLabel?.trim() || null), 5, 'No category'),
    languages: topShares(
      records.map((record) => {
        const code = normalizeLanguage(languageSource === 'audio' ? record.defaultAudioLanguage : record.defaultLanguage);
        return code === UNKNOWN_LANGUAGE ? null : code;
      }),
      4,
      'Not set',
      languageName,
    ),
    languageSource,
    formats: buildFormats(records),
    medianChannelSubscribers: medianChannelSubscribers(records),
  } satisfies Omit<DashboardOverviewProfile, 'summary'>;
  return { ...base, summary: buildSummary(base) };
}
