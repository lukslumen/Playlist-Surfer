import type { DashboardTemplateVideoRecord } from './dashboardTemplateTypes';
import { binStart, median, parsePublishedTimestamp } from './overviewProfile';
import { termIndex, type TermIndex, type VernacularUnit } from './vernacularProfile';

// The time tab: when a space publishes (weekday × hour), how views relate to publish date, when the main
// channels were active, and how the main terms rise and fall.

export type Heatmap = number[][]; // [weekday Monday=0..Sunday=6][hour 0..23]

export interface TimePeriod {
  startTs: number;
  endTs: number;
  label: string;
  videos: number;
}

export interface TimeProfile {
  datedVideos: number;
  rhythm: { utc: Heatmap; local: Heatmap; localZone: string; max: number };
  /** Up to SCATTER_LIMIT (publish time, views) points, plus the median views per period. */
  viewsByDate: {
    points: Array<{ ts: number; views: number; title: string; videoId: string }>;
    total: number;
    medians: Array<{ startTs: number; endTs: number; median: number; videos: number }>;
  };
  periods: TimePeriod[];
  periodUnit: 'month' | 'quarter' | 'year';
  /** Videos per period for the channels with the most videos. */
  channels: Array<{ key: string; label: string; videos: number; counts: number[] }>;
  channelCount: number;
  /** Share of each period's videos that use the term, for the top terms of each unit. */
  terms: Record<Exclude<VernacularUnit, 'phrases' | 'topics'>, Array<{ key: string; label: string; videos: number; shares: number[] }>>;
}

const SCATTER_LIMIT = 1500;
export const CHANNEL_LANES = 10;
export const TERMS_OVER_TIME = 8;
const MIN_PERIOD_VIDEOS_FOR_MEDIAN = 3;

function emptyHeatmap(): Heatmap {
  return Array.from({ length: 7 }, () => new Array(24).fill(0));
}

/** Periods for comparing over time: years for long spans, quarters or months for shorter ones. */
export function choosePeriodUnit(spanMs: number): TimeProfile['periodUnit'] {
  const years = spanMs / (365.25 * 86_400_000);
  if (years >= 4) return 'year';
  if (years >= 1) return 'quarter';
  return 'month';
}

export function buildTimeProfile(records: DashboardTemplateVideoRecord[], options: { exclusions?: string[]; timeZone?: string; index?: TermIndex } = {}): TimeProfile {
  const index = options.index ?? termIndex(records, options.exclusions);
  const dated = records
    .map((record, position) => ({ record, ts: parsePublishedTimestamp(record.publishedAt), position }))
    .filter((entry): entry is { record: DashboardTemplateVideoRecord; ts: number; position: number } => entry.ts !== null);

  const utc = emptyHeatmap();
  const local = emptyHeatmap();
  const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local';
  const localZone = options.timeZone ?? systemZone;
  // The browser's own zone can use Date's local getters, which are much faster than formatToParts.
  const useDateGetters = localZone === systemZone;
  const localParts = new Intl.DateTimeFormat('en-US', { timeZone: localZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
  const weekdayIndex: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  let max = 0;
  dated.forEach(({ ts }) => {
    const date = new Date(ts);
    const utcDay = (date.getUTCDay() + 6) % 7;
    utc[utcDay][date.getUTCHours()] += 1;
    let day: number;
    let hour: number;
    if (useDateGetters) {
      day = (date.getDay() + 6) % 7;
      hour = date.getHours();
    } else {
      const parts = localParts.formatToParts(date);
      day = weekdayIndex[parts.find((part) => part.type === 'weekday')?.value ?? 'Mon'] ?? 0;
      hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0) % 24;
    }
    local[day][hour] += 1;
    max = Math.max(max, utc[utcDay][date.getUTCHours()], local[day][hour]);
  });

  let first = Infinity;
  let last = -Infinity;
  dated.forEach(({ ts }) => { first = Math.min(first, ts); last = Math.max(last, ts); });
  const periodUnit = dated.length ? choosePeriodUnit(last - first) : 'year';
  // Re-bin into the coarser comparison period.
  const periods: TimePeriod[] = [];
  const periodIndexByStart = new Map<number, number>();
  if (dated.length) {
    dated.forEach(({ ts }) => {
      const start = binStart(ts, periodUnit);
      if (!periodIndexByStart.has(start)) periodIndexByStart.set(start, -1);
    });
    const starts = [...periodIndexByStart.keys()].sort((a, b) => a - b);
    // Fill gaps so periods are evenly spaced.
    const filled: number[] = [];
    for (let start = starts[0]; start <= starts[starts.length - 1]; start = nextStart(start, periodUnit)) filled.push(start);
    filled.forEach((start, index) => {
      periodIndexByStart.set(start, index);
      periods.push({ startTs: start, endTs: nextStart(start, periodUnit), label: periodLabel(start, periodUnit), videos: 0 });
    });
    dated.forEach(({ ts }) => { periods[periodIndexByStart.get(binStart(ts, periodUnit)) as number].videos += 1; });
  }
  const periodOf = (ts: number) => periodIndexByStart.get(binStart(ts, periodUnit)) ?? -1;

  // Views by publish date.
  const withViews = dated.filter(({ record }) => record.viewCount !== null && record.viewCount > 0);
  const step = Math.max(1, withViews.length / SCATTER_LIMIT);
  const sortedByTs = [...withViews].sort((a, b) => a.ts - b.ts);
  const points = [] as TimeProfile['viewsByDate']['points'];
  for (let position = 0; position < sortedByTs.length && points.length < SCATTER_LIMIT; position += step) {
    const { record, ts } = sortedByTs[Math.floor(position)];
    points.push({ ts, views: record.viewCount as number, title: record.title, videoId: record.videoId ?? '' });
  }
  const viewsPerPeriod = periods.map(() => [] as number[]);
  withViews.forEach(({ record, ts }) => viewsPerPeriod[periodOf(ts)]?.push(record.viewCount as number));
  const medians = periods.flatMap((period, index) => {
    const values = viewsPerPeriod[index];
    if (values.length < MIN_PERIOD_VIDEOS_FOR_MEDIAN) return [];
    return [{ startTs: period.startTs, endTs: period.endTs, median: median(values) as number, videos: values.length }];
  });

  // Channel lanes.
  const channelCounts = new Map<string, { label: string; videos: number; counts: number[] }>();
  dated.forEach(({ record, ts }) => {
    const key = record.channelId || record.channelTitle || '(unknown channel)';
    const entry = channelCounts.get(key) ?? { label: record.channelTitle || key, videos: 0, counts: new Array(periods.length).fill(0) };
    entry.videos += 1;
    const index = periodOf(ts);
    if (index >= 0) entry.counts[index] += 1;
    channelCounts.set(key, entry);
  });
  const channels = [...channelCounts.entries()]
    .sort((a, b) => (b[1].videos - a[1].videos) || a[1].label.localeCompare(b[1].label))
    .slice(0, CHANNEL_LANES)
    .map(([key, entry]) => ({ key, ...entry }));

  // Terms over time: the top terms overall, as a share of each period's videos.
  const units = ['words', 'hashtags', 'tags'] as const;
  const perUnit = Object.fromEntries(units.map((unit) => [unit, new Map<string, { label: string; videos: number; counts: number[] }>()])) as Record<(typeof units)[number], Map<string, { label: string; videos: number; counts: number[] }>>;
  dated.forEach(({ ts, position }) => {
    const terms = index.perVideo[position];
    const periodIndex = periodOf(ts);
    units.forEach((unit) => {
      const seen = new Set<string>();
      (terms[unit] as Array<string | { key: string; label: string }>).forEach((term) => {
        const key = typeof term === 'string' ? term : term.key;
        if (seen.has(key)) return;
        seen.add(key);
        const entry = perUnit[unit].get(key) ?? { label: typeof term === 'string' ? term : term.label, videos: 0, counts: new Array(periods.length).fill(0) };
        entry.videos += 1;
        if (periodIndex >= 0) entry.counts[periodIndex] += 1;
        perUnit[unit].set(key, entry);
      });
    });
  });
  const terms = Object.fromEntries(units.map((unit) => [unit, [...perUnit[unit].entries()]
    .sort((a, b) => (b[1].videos - a[1].videos) || a[0].localeCompare(b[0]))
    .slice(0, TERMS_OVER_TIME)
    .map(([key, entry]) => ({
      key,
      label: entry.label,
      videos: entry.videos,
      shares: entry.counts.map((count, index) => (periods[index].videos ? count / periods[index].videos : 0)),
    }))])) as TimeProfile['terms'];

  return {
    datedVideos: dated.length,
    rhythm: { utc, local, localZone, max },
    viewsByDate: { points, total: withViews.length, medians },
    periods,
    periodUnit,
    channels,
    channelCount: channelCounts.size,
    terms,
  };
}

function nextStart(start: number, unit: TimeProfile['periodUnit']): number {
  const date = new Date(start);
  if (unit === 'month') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  if (unit === 'quarter') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 3, 1);
  return Date.UTC(date.getUTCFullYear() + 1, 0, 1);
}

function periodLabel(start: number, unit: TimeProfile['periodUnit']): string {
  const date = new Date(start);
  if (unit === 'year') return String(date.getUTCFullYear());
  if (unit === 'quarter') return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(start);
}
