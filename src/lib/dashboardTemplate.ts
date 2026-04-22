import type { Annotation, DashboardScope, ImportedChannelMetadataState } from '../types';
import {
  buildChannelLookupKey,
  resolveChannelId,
  resolvePublishedAt,
  resolveTranscript,
  resolveVideoDescription,
  resolveVideoId,
  resolveVideoTags,
  resolveVideoTitle,
  resolveViews,
} from './data';
import type {
  DashboardTemplateColumn,
  DashboardTemplateContentInsights,
  DashboardTemplateCountStat,
  DashboardTemplateCoverageMetric,
  DashboardTemplateIssue,
  DashboardTemplateOverviewInsights,
  DashboardTemplateProvenanceInsights,
  DashboardTemplateRankedItem,
  DashboardTemplateSegment,
  DashboardTemplateSnapshot,
  DashboardTemplateTimePoint,
  DashboardTemplateVideoRecord,
} from './dashboardTemplateTypes';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const UNKNOWN_LANGUAGE = 'unknown';
const SHORTS_DURATION_MAX_SECONDS = 70;
const SHORTS_SCORE_THRESHOLD = 3;
const SHORTS_HASHTAG_RE = /#shorts?\b/i;
const SHORTS_KEYWORD_RE = /\b(yt\s*shorts?|shorts?|short-form|vertical video|60s|one minute|1 minute)\b/i;
const SHORTS_TAG_RE = /^(short|shorts|ytshorts)$/i;

const DATE_LABEL_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

const SHORT_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  timeZone: 'UTC',
});

const STOPWORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'before', 'being',
  'best', 'but', 'by', 'can', 'channel', 'check', 'click', 'com', 'could', 'did', 'do', 'does', 'dont', 'for',
  'from', 'get', 'has', 'have', 'here', 'how', 'http', 'https', 'if', 'in', 'into', 'is', 'it', 'its', 'just',
  'learn', 'like', 'more', 'my', 'new', 'not', 'now', 'of', 'on', 'or', 'our', 'out', 'please', 'share', 'so',
  'some', 'subscribe', 'than', 'that', 'the', 'their', 'them', 'there', 'this', 'to', 'today', 'too', 'up',
  'use', 'video', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your',
]);

export const INTENT_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'tutorial / explainer', pattern: /\b(how\s+to|tutorial|guide|explained|what\s+is|basics?)\b/i },
  { label: 'review / comparison', pattern: /\b(review|vs\.?|versus|comparison|top\s+\d+|best|worst|rating)\b/i },
  { label: 'news / update', pattern: /\b(news|update|breaking|latest|today)\b/i },
  { label: 'opinion / reaction', pattern: /\b(opinion|reaction|responds?|debunk|rant|hot\s+take)\b/i },
  { label: 'interview / talk', pattern: /\b(interview|podcast|conversation|talk|debate)\b/i },
];

function toShare(count: number, total: number): number {
  if (total <= 0) return 0;
  return count / total;
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const numeric = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(numeric) ? numeric : null;
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toTextList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  const raw = String(value).trim();
  if (!raw) return [];
  const normalized = raw
    .replace(/^\[|\]$/g, '')
    .replace(/"/g, '')
    .replace(/\|/g, ',')
    .replace(/;/g, ',');
  return normalized
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseIsoDuration(value: string): number | null {
  if (!value) return null;
  const match = /^P(?:([0-9]+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!match) return null;
  const [, d, h, m, s] = match;
  return (Number(d || 0) * 86400) + (Number(h || 0) * 3600) + (Number(m || 0) * 60) + Number(s || 0);
}

function parseDurationSeconds(value: unknown): number | null {
  const direct = parseNumber(value);
  if (direct !== null) return direct;
  if (typeof value === 'string') {
    const iso = parseIsoDuration(value);
    if (iso !== null) return iso;
  }
  return null;
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric > 1_000_000_000_000) return Math.floor(numeric);
    if (numeric > 1_000_000_000) return Math.floor(numeric * 1000);
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizeLanguage(rawValue: string): string {
  const normalized = rawValue
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');

  if (!normalized || normalized === 'na' || normalized === 'n/a' || normalized === 'none') {
    return UNKNOWN_LANGUAGE;
  }

  const base = normalized.split('-')[0].trim();
  if (!base || base === 'und' || base === 'zxx') return UNKNOWN_LANGUAGE;
  if (!/^[a-z]{2,3}$/.test(base)) return UNKNOWN_LANGUAGE;
  return base;
}

function toLanguageLabel(code: string): string {
  return code === UNKNOWN_LANGUAGE ? code : code.toUpperCase();
}

function cleanText(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeForKeywords(text: string): string[] {
  if (!text) return [];
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  return cleaned
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && token.length <= 28 && !STOPWORDS.has(token));
}

function keywordDocumentFrequency(texts: string[], limit: number): DashboardTemplateCountStat[] {
  const counter = new Map<string, number>();
  let docs = 0;

  for (const text of texts) {
    const tokens = new Set(tokenizeForKeywords(text));
    if (tokens.size === 0) continue;
    docs += 1;
    for (const token of tokens) {
      counter.set(token, (counter.get(token) ?? 0) + 1);
    }
  }

  return [...counter.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count, share: toShare(count, docs) }));
}

function countBy(items: string[], limit: number): DashboardTemplateCountStat[] {
  const counter = new Map<string, number>();
  for (const item of items) {
    const label = item.trim();
    if (!label) continue;
    counter.set(label, (counter.get(label) ?? 0) + 1);
  }
  return [...counter.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count, share: toShare(count, items.length) }));
}

function durationBucket(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return 'unknown';
  if (seconds < 60) return '<1m';
  if (seconds < 300) return '1-5m';
  if (seconds < 900) return '5-15m';
  if (seconds < 1800) return '15-30m';
  return '30m+';
}

export function inferIntentFromText(text: string): string {
  if (!text) return 'other';
  for (const candidate of INTENT_PATTERNS) {
    if (candidate.pattern.test(text)) return candidate.label;
  }
  return 'other';
}

function floorUtcDay(ts: number): number {
  const date = new Date(ts);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function floorUtcWeek(ts: number): number {
  const dayStart = floorUtcDay(ts);
  const weekday = (new Date(dayStart).getUTCDay() + 6) % 7;
  return dayStart - weekday * DAY_MS;
}

function movingAverage(values: number[], windowSize: number): number[] {
  if (!values.length) return [];
  const output: number[] = [];
  let rollingSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    rollingSum += values[i];
    if (i >= windowSize) rollingSum -= values[i - windowSize];
    const denom = Math.min(i + 1, windowSize);
    output.push(rollingSum / denom);
  }
  return output;
}

function detectPeakIndices(values: number[]): Set<number> {
  if (values.length === 0) return new Set<number>();
  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const threshold = Math.max(2, Math.ceil(mean * 1.35));
  const candidates: number[] = [];

  for (let i = 1; i < values.length - 1; i += 1) {
    const prev = values[i - 1];
    const current = values[i];
    const next = values[i + 1];
    if (current > prev && current >= next && current >= threshold) {
      candidates.push(i);
    }
  }

  if (candidates.length === 0) {
    let maxIndex = 0;
    for (let i = 1; i < values.length; i += 1) {
      if (values[i] > values[maxIndex]) maxIndex = i;
    }
    return values[maxIndex] > 0 ? new Set<number>([maxIndex]) : new Set<number>();
  }

  return new Set<number>([...candidates].sort((a, b) => values[b] - values[a]).slice(0, 6));
}

function quantile(sortedOrUnsorted: number[], p: number): number | null {
  if (!sortedOrUnsorted.length) return null;
  const sorted = [...sortedOrUnsorted].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  const weight = index - low;
  return sorted[low] + (sorted[high] - sorted[low]) * weight;
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function gini(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].filter((v) => v >= 0).sort((a, b) => a - b);
  const total = sum(sorted);
  if (total === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    weighted += (i + 1) * sorted[i];
  }
  return (2 * weighted) / (sorted.length * total) - (sorted.length + 1) / sorted.length;
}

function computeBoxStats(values: number[]) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  const medianValue = quantile(sorted, 0.5) ?? 0;
  const p90 = quantile(sorted, 0.9) ?? 0;
  return {
    min: sorted[0] ?? 0,
    p10: quantile(sorted, 0.1) ?? 0,
    q1: quantile(sorted, 0.25) ?? 0,
    median: medianValue,
    q3: quantile(sorted, 0.75) ?? 0,
    p90,
    max: sorted[sorted.length - 1] ?? 0,
    gini: gini(sorted),
    ratioP90ToMedian: medianValue > 0 ? p90 / medianValue : undefined,
    sampleSize: sorted.length,
  };
}

function buildSegments(items: { value: number }[], mode: 'video' | 'channel' | 'engagement'): DashboardTemplateSegment[] {
  const total = sum(items.map((item) => item.value));
  const cumulativeLabels = mode === 'channel'
    ? { top1: 'top 1', nextBucket: 'top 5', restTop10: 'top 10', rest90: 'all' }
    : { top1: 'top 1', nextBucket: 'top 10', restTop10: 'top 10%', rest90: 'all' };

  if (total <= 0 || items.length === 0) {
    return [
      { key: 'top1', label: cumulativeLabels.top1, share: 0, rawValue: 0 },
      { key: 'nextBucket', label: cumulativeLabels.nextBucket, share: 0, rawValue: 0 },
      { key: 'restTop10', label: cumulativeLabels.restTop10, share: 0, rawValue: 0 },
      { key: 'rest90', label: cumulativeLabels.rest90, share: 0, rawValue: 0 },
    ];
  }

  const topCount = Math.max(1, Math.ceil(items.length * 0.1));
  const top1 = items.slice(0, 1);
  const nextBucket = mode === 'video' ? items.slice(1, 10) : items.slice(1, 5);
  const topBound = mode === 'channel' ? 10 : topCount;
  const restTop10 = items.slice(mode === 'video' ? 10 : 5, topBound);
  const rest90 = items.slice(topBound);

  return [
    { key: 'top1', label: cumulativeLabels.top1, share: sum(top1.map((item) => item.value)) / total, rawValue: sum(top1.map((item) => item.value)) },
    { key: 'nextBucket', label: cumulativeLabels.nextBucket, share: sum(nextBucket.map((item) => item.value)) / total, rawValue: sum(nextBucket.map((item) => item.value)) },
    { key: 'restTop10', label: cumulativeLabels.restTop10, share: sum(restTop10.map((item) => item.value)) / total, rawValue: sum(restTop10.map((item) => item.value)) },
    { key: 'rest90', label: cumulativeLabels.rest90, share: sum(rest90.map((item) => item.value)) / total, rawValue: sum(rest90.map((item) => item.value)) },
  ];
}

function buildRanking<T extends {
  label: string;
  value: number;
  kind?: DashboardTemplateRankedItem['kind'];
  videoId?: string;
  channelId?: string | null;
  channelName?: string;
}>(items: T[], total: number): DashboardTemplateRankedItem[] {
  return items.slice(0, 5).map((item, index) => ({
    rank: index + 1,
    label: item.label,
    fullLabel: item.label,
    rawValue: item.value,
    share: total > 0 ? item.value / total : 0,
    kind: item.kind,
    videoId: item.videoId,
    channelId: item.channelId,
    channelName: item.channelName,
  }));
}

function makeUnavailable(
  key: DashboardTemplateColumn['key'],
  title: string,
  metricLabel: string,
  headlineLabel: string,
  rankingTitle: string,
  missingFields: string[],
): DashboardTemplateColumn {
  return {
    key,
    title,
    metricLabel,
    headlineLabel,
    headlineShare: 0,
    concentration: [],
    boxStats: { min: 0, p10: 0, q1: 0, median: 0, q3: 0, p90: 0, max: 0 },
    rankingTitle,
    ranking: [],
    available: false,
    missingFields,
  };
}

function deriveColumns(rows: DashboardTemplateVideoRecord[]): DashboardTemplateColumn[] {
  return [deriveVideoColumn(rows), deriveChannelColumn(rows), deriveEngagementColumn(rows)];
}

function deriveVideoColumn(rows: DashboardTemplateVideoRecord[]): DashboardTemplateColumn {
  const usable = rows.filter((row) => row.title && row.viewCount !== null);
  if (!usable.length) return makeUnavailable('video', 'Video', 'views per video', 'top 10%', 'top 5 videos by views', ['title', 'viewCount']);

  const ranked = [...usable]
    .map((row) => ({ label: row.title, value: row.viewCount as number, kind: 'video' as const, videoId: row.videoId }))
    .sort((a, b) => b.value - a.value);
  const values = ranked.map((row) => row.value);
  const total = sum(values);
  const topCount = Math.max(1, Math.ceil(ranked.length * 0.1));
  return {
    key: 'video',
    title: 'Video',
    metricLabel: 'views per video',
    headlineLabel: 'top 10%',
    headlineShare: total > 0 ? sum(ranked.slice(0, topCount).map((row) => row.value)) / total : 0,
    concentration: buildSegments(ranked, 'video'),
    boxStats: computeBoxStats(values),
    rankingTitle: 'top 5 videos by views',
    ranking: buildRanking(ranked, total),
    available: true,
  };
}

function deriveChannelColumn(rows: DashboardTemplateVideoRecord[]): DashboardTemplateColumn {
  const usable = rows.filter((row) => row.channelTitle && row.viewCount !== null);
  if (!usable.length) return makeUnavailable('channel', 'Channel', 'views per channel', 'top 5', 'top 5 channels by views', ['channelTitle', 'viewCount']);

  const byChannel = new Map<string, { label: string; value: number; channelId: string | null; channelName: string }>();
  usable.forEach((row) => {
    const channelKey = row.channelId ? `id:${row.channelId}` : `name:${row.channelTitle.toLowerCase()}`;
    const existing = byChannel.get(channelKey) || {
      label: row.channelTitle,
      value: 0,
      channelId: row.channelId ?? null,
      channelName: row.channelTitle,
    };
    existing.value += row.viewCount as number;
    byChannel.set(channelKey, existing);
  });
  const ranked = [...byChannel.values()].map((entry) => ({
    label: entry.label,
    value: entry.value,
    kind: 'channel' as const,
    channelId: entry.channelId,
    channelName: entry.channelName,
  })).sort((a, b) => b.value - a.value);
  const total = sum(ranked.map((row) => row.value));
  const boxStats = computeBoxStats(ranked.map((row) => row.value));

  return {
    key: 'channel',
    title: 'Channel',
    metricLabel: 'views per channel',
    headlineLabel: 'top 5',
    headlineShare: total > 0 ? sum(ranked.slice(0, 5).map((row) => row.value)) / total : 0,
    concentration: buildSegments(ranked, 'channel'),
    boxStats,
    rankingTitle: 'top 5 channels by views',
    ranking: buildRanking(ranked, total),
    available: true,
  };
}

function deriveEngagementColumn(rows: DashboardTemplateVideoRecord[]): DashboardTemplateColumn {
  const usable = rows.filter((row) => row.title && row.commentCount !== null);
  if (!usable.length) return makeUnavailable('engagement', 'Comments', 'comments per video', 'top 10%', 'top 5 videos by comments', ['title', 'commentCount']);

  const ranked = [...usable]
    .map((row) => ({ label: row.title, value: row.commentCount as number, likes: row.likeCount ?? 0, kind: 'video' as const, videoId: row.videoId }))
    .sort((a, b) => b.value - a.value);

  const values = ranked.map((row) => row.value);
  const total = sum(values);
  const topCount = Math.max(1, Math.ceil(ranked.length * 0.1));
  const boxStats = computeBoxStats(values);
  const likes = ranked.map((row) => row.likes).sort((a, b) => a - b);
  const likesTotal = sum(ranked.map((row) => row.likes));

  return {
    key: 'engagement',
    title: 'Comments',
    metricLabel: 'comments per video',
    headlineLabel: 'top 10%',
    headlineShare: total > 0 ? sum(ranked.slice(0, topCount).map((row) => row.value)) / total : 0,
    concentration: buildSegments(ranked, 'engagement'),
    boxStats: {
      ...boxStats,
      medianLikes: quantile(likes, 0.5) ?? undefined,
      likesTop10Share: likesTotal > 0 ? sum(ranked.slice(0, topCount).map((row) => row.likes)) / likesTotal : undefined,
    },
    rankingTitle: 'top 5 videos by comments',
    ranking: buildRanking(ranked, total),
    available: true,
  };
}

function isPresentText(value: string): boolean {
  return value.trim().length > 0;
}

function isTruthyMetadata(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return !['0', 'false', 'no', 'none', 'n/a'].includes(normalized);
}

function buildCoverageMetric(key: string, label: string, presentCount: number, total: number): DashboardTemplateCoverageMetric {
  const missingCount = Math.max(0, total - presentCount);
  return {
    key,
    label,
    presentCount,
    missingCount,
    presentShare: toShare(presentCount, total),
    missingShare: toShare(missingCount, total),
  };
}

function addIssue(issues: DashboardTemplateIssue[], severity: DashboardTemplateIssue['severity'], text: string) {
  issues.push({ severity, text });
}

function classifyStatus(args: {
  keyCoverage: number;
  duplicateRate: number;
  malformedDateRate: number;
  engagementCoverage: number;
  oneVideoChannelShare: number;
}): { status: DashboardTemplateOverviewInsights['overallStatus']; reason: string } {
  const { keyCoverage, duplicateRate, malformedDateRate, engagementCoverage, oneVideoChannelShare } = args;
  const majorFailure = keyCoverage < 0.6 || engagementCoverage < 0.45 || malformedDateRate > 0.35 || duplicateRate > 0.2;
  if (majorFailure) return { status: 'poor', reason: 'Core fields are unreliable for robust interpretation.' };
  const limited = keyCoverage < 0.75 || engagementCoverage < 0.65 || malformedDateRate > 0.15 || duplicateRate > 0.08 || oneVideoChannelShare > 0.9;
  if (limited) return { status: 'limited', reason: 'Multiple structural limitations can distort downstream analysis.' };
  const caveated = keyCoverage < 0.93 || engagementCoverage < 0.9 || malformedDateRate > 0.03 || duplicateRate > 0.015 || oneVideoChannelShare > 0.75;
  if (caveated) return { status: 'usable with caveats', reason: 'Dataset is usable, but caveats should guide interpretation.' };
  return { status: 'good', reason: 'Structural quality is strong for high-level interpretation.' };
}

function deriveOverviewInsights(rows: DashboardTemplateVideoRecord[]): DashboardTemplateOverviewInsights {
  const totalRows = rows.length;
  const channelSet = new Set<string>();
  const uniqueVideoSet = new Set<string>();
  const dedupeKeySet = new Set<string>();
  const exactRowSet = new Set<string>();
  let duplicateCount = 0;
  let exactDuplicateRowCount = 0;
  let titlePresent = 0;
  let channelPresent = 0;
  let thumbnailPresent = 0;
  let descriptionPresent = 0;
  let tagsPresent = 0;
  let captionsPresent = 0;
  let transcriptsPresent = 0;
  let viewPresent = 0;
  let commentPresent = 0;
  let publishPresent = 0;
  let likePresent = 0;
  let validDateCount = 0;
  let malformedDateCount = 0;
  const publishTimestamps: number[] = [];
  let totalViews = 0;
  let totalComments = 0;
  let totalLikes = 0;
  let zeroViews = 0;
  let zeroComments = 0;
  let zeroLikes = 0;
  const channelVideoCounts = new Map<string, number>();

  rows.forEach((row) => {
    const normalizedTitle = row.title.trim().toLowerCase();
    const normalizedChannel = row.channelTitle.trim().toLowerCase();
    const normalizedVideoId = (row.videoId ?? '').trim();
    const normalizedPublished = (row.publishedAt ?? '').trim();

    if (isPresentText(row.title)) titlePresent += 1;
    if (isPresentText(row.channelTitle)) channelPresent += 1;
    if (isPresentText(row.thumbnailUrl)) thumbnailPresent += 1;
    if (isPresentText(row.description)) descriptionPresent += 1;
    if (row.tags.length > 0) tagsPresent += 1;
    if (isTruthyMetadata(row.caption)) captionsPresent += 1;
    if (isTruthyMetadata(row.transcript)) transcriptsPresent += 1;
    if (row.viewCount !== null) viewPresent += 1;
    if (row.commentCount !== null) commentPresent += 1;
    if (isPresentText(normalizedPublished)) publishPresent += 1;
    if (row.likeCount !== null) likePresent += 1;

    if (isPresentText(row.channelTitle)) {
      channelSet.add(row.channelTitle.trim());
      channelVideoCounts.set(row.channelTitle.trim(), (channelVideoCounts.get(row.channelTitle.trim()) ?? 0) + 1);
    }
    if (normalizedVideoId) uniqueVideoSet.add(normalizedVideoId);

    const dedupeKey = normalizedVideoId
      ? `id:${normalizedVideoId}`
      : `proxy:${normalizedTitle}|${normalizedChannel}|${normalizedPublished}`;
    if (dedupeKeySet.has(dedupeKey)) duplicateCount += 1;
    dedupeKeySet.add(dedupeKey);

    const exactKey = [
      normalizedVideoId,
      normalizedTitle,
      normalizedChannel,
      row.description.trim().toLowerCase(),
      normalizedPublished,
      row.viewCount ?? '',
      row.commentCount ?? '',
      row.likeCount ?? '',
    ].join('||');
    if (exactRowSet.has(exactKey)) exactDuplicateRowCount += 1;
    exactRowSet.add(exactKey);

    const ts = parseTimestamp(normalizedPublished);
    if (normalizedPublished) {
      if (ts === null) malformedDateCount += 1;
      else {
        validDateCount += 1;
        publishTimestamps.push(ts);
      }
    }

    if (row.viewCount !== null) {
      totalViews += row.viewCount;
      if (row.viewCount === 0) zeroViews += 1;
    }
    if (row.commentCount !== null) {
      totalComments += row.commentCount;
      if (row.commentCount === 0) zeroComments += 1;
    }
    if (row.likeCount !== null) {
      totalLikes += row.likeCount;
      if (row.likeCount === 0) zeroLikes += 1;
    }
  });

  publishTimestamps.sort((a, b) => a - b);
  const keyCoverage = (
    toShare(titlePresent, totalRows)
    + toShare(channelPresent, totalRows)
    + toShare(viewPresent, totalRows)
    + toShare(commentPresent, totalRows)
    + toShare(publishPresent, totalRows)
  ) / 5;
  const engagementCoverage = (toShare(viewPresent, totalRows) + toShare(commentPresent, totalRows) + toShare(likePresent, totalRows)) / 3;
  const malformedDateRate = toShare(malformedDateCount, totalRows);
  const duplicateRate = toShare(duplicateCount, totalRows);
  const oneVideoChannelCount = [...channelVideoCounts.values()].filter((count) => count === 1).length;
  const oneVideoChannelShare = toShare(oneVideoChannelCount, channelSet.size);
  const status = classifyStatus({ keyCoverage, duplicateRate, malformedDateRate, engagementCoverage, oneVideoChannelShare });

  const caveats: DashboardTemplateIssue[] = [];
  if (toShare(publishPresent, totalRows) < 0.9) addIssue(caveats, 'medium', `${Math.round((1 - toShare(publishPresent, totalRows)) * 100)}% of rows are missing publish date.`);
  if (malformedDateRate > 0) addIssue(caveats, malformedDateRate > 0.1 ? 'high' : 'low', `${Math.round(malformedDateRate * 100)}% of rows have malformed publish dates.`);
  if (duplicateRate > 0) addIssue(caveats, duplicateRate > 0.08 ? 'high' : 'medium', `Duplicate video rate is ${Math.round(duplicateRate * 100)}%.`);
  if (toShare(zeroComments, Math.max(1, commentPresent)) > 0.5) addIssue(caveats, 'medium', `${Math.round(toShare(zeroComments, Math.max(1, commentPresent)) * 100)}% of rows with comments have value 0.`);
  if (oneVideoChannelShare > 0.7) addIssue(caveats, oneVideoChannelShare > 0.85 ? 'high' : 'medium', `${Math.round(oneVideoChannelShare * 100)}% of channels appear once.`);
  if (!caveats.length) addIssue(caveats, 'low', 'No major structural quality flags detected.');

  return {
    totalRows,
    totalVideos: uniqueVideoSet.size || totalRows,
    uniqueChannels: channelSet.size,
    uniqueVideoIds: uniqueVideoSet.size,
    totalViews,
    totalComments,
    totalLikes,
    validPublishCount: validDateCount,
    malformedDateCount,
    newestPublishTs: publishTimestamps[publishTimestamps.length - 1] ?? null,
    oldestPublishTs: publishTimestamps[0] ?? null,
    medianPublishTs: quantile(publishTimestamps, 0.5),
    coverage: [
      buildCoverageMetric('thumbnails', 'thumbnails', thumbnailPresent, totalRows),
      buildCoverageMetric('descriptions', 'descriptions', descriptionPresent, totalRows),
      buildCoverageMetric('tags', 'tags', tagsPresent, totalRows),
      buildCoverageMetric('captions', 'captions', captionsPresent, totalRows),
      buildCoverageMetric('transcripts', 'transcripts', transcriptsPresent, totalRows),
    ],
    duplicateCount,
    duplicateRate,
    exactDuplicateRowCount,
    exactDuplicateRowRate: toShare(exactDuplicateRowCount, totalRows),
    zeroViewRate: toShare(zeroViews, Math.max(1, viewPresent)),
    zeroCommentRate: toShare(zeroComments, Math.max(1, commentPresent)),
    zeroLikeRate: toShare(zeroLikes, Math.max(1, likePresent)),
    oneVideoChannelCount,
    oneVideoChannelShare,
    overallStatus: status.status,
    statusReason: status.reason,
    caveats: caveats.slice(0, 3),
  };
}

function deriveProvenanceInsights(rows: DashboardTemplateVideoRecord[]): DashboardTemplateProvenanceInsights {
  const uploadTimeline = deriveTimelineInsights(
    rows
      .map((row) => parseTimestamp(row.publishedAt))
      .filter((value): value is number => value !== null),
    rows.length,
  );

  const channelCreatedByKey = new Map<string, number>();
  rows.forEach((row) => {
    const ts = parseTimestamp(row.channelCreatedAt);
    if (ts === null) return;
    const key = (row.channelId && row.channelId.trim()) || row.channelTitle.trim().toLowerCase();
    if (!key || channelCreatedByKey.has(key)) return;
    channelCreatedByKey.set(key, ts);
  });

  const channelAgeTimeline = deriveTimelineInsights(
    [...channelCreatedByKey.values()],
    Math.max(channelCreatedByKey.size, 1),
  );

  const declared = new Map<string, number>();
  const audio = new Map<string, number>();
  rows.forEach((row) => {
    const declaredCode = normalizeLanguage(row.defaultLanguage);
    const audioCode = normalizeLanguage(row.defaultAudioLanguage);
    declared.set(declaredCode, (declared.get(declaredCode) ?? 0) + 1);
    audio.set(audioCode, (audio.get(audioCode) ?? 0) + 1);
  });

  const combined = new Map<string, number>();
  for (const [code, count] of declared.entries()) combined.set(code, (combined.get(code) ?? 0) + count);
  for (const [code, count] of audio.entries()) combined.set(code, (combined.get(code) ?? 0) + count);
  const sortedCodes = [...combined.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).map(([code]) => code);
  const selected = sortedCodes.slice(0, 7);
  if ((combined.get(UNKNOWN_LANGUAGE) ?? 0) > 0 && !selected.includes(UNKNOWN_LANGUAGE)) selected.push(UNKNOWN_LANGUAGE);
  const languageRows = selected.slice(0, 8).map((code) => ({
    label: toLanguageLabel(code),
    declaredCount: declared.get(code) ?? 0,
    audioCount: audio.get(code) ?? 0,
    declaredShare: toShare(declared.get(code) ?? 0, rows.length),
    audioShare: toShare(audio.get(code) ?? 0, rows.length),
  }));

  return {
    overview: {
      totalVideos: rows.length,
      upload: uploadTimeline.overview,
      channelAge: channelAgeTimeline.overview,
    },
    timeSeries: uploadTimeline.timeSeries,
    uploadTimestamps: uploadTimeline.timestamps,
    minTs: uploadTimeline.minTs,
    maxTs: uploadTimeline.maxTs,
    channelAgeSeries: channelAgeTimeline.timeSeries,
    channelAgeTimestamps: channelAgeTimeline.timestamps,
    channelAgeMinTs: channelAgeTimeline.minTs,
    channelAgeMaxTs: channelAgeTimeline.maxTs,
    languageRows,
  };
}

function computeShortsEstimate(rows: DashboardTemplateVideoRecord[]) {
  let shortCount = 0;
  let hashtagSignalHits = 0;
  let tagSignalHits = 0;
  let keywordSignalHits = 0;
  let durationSignalHits = 0;

  for (const row of rows) {
    const mergedText = `${row.title} ${row.description}`.trim();
    const hasHashtagSignal = SHORTS_HASHTAG_RE.test(mergedText);
    const hasTagSignal = row.tags.some((tag) => SHORTS_TAG_RE.test(tag.trim()));
    const hasKeywordSignal = SHORTS_KEYWORD_RE.test(mergedText);
    const hasDurationSignal = typeof row.durationSec === 'number' && row.durationSec > 0 && row.durationSec <= SHORTS_DURATION_MAX_SECONDS;
    const hasTitleLeadSignal = /^\s*#shorts?\b/i.test(row.title);

    let score = 0;
    if (hasHashtagSignal) score += 3;
    if (hasTagSignal) score += 2;
    if (hasDurationSignal) score += 2;
    if (hasKeywordSignal) score += 1;
    if (hasTitleLeadSignal) score += 1;

    const isEstimatedShort = hasHashtagSignal || score >= SHORTS_SCORE_THRESHOLD;
    if (isEstimatedShort) shortCount += 1;
    if (hasHashtagSignal) hashtagSignalHits += 1;
    if (hasTagSignal) tagSignalHits += 1;
    if (hasKeywordSignal) keywordSignalHits += 1;
    if (hasDurationSignal) durationSignalHits += 1;
  }

  return {
    shortCount,
    longCount: Math.max(0, rows.length - shortCount),
    shortShare: rows.length ? shortCount / rows.length : 0,
    longShare: rows.length ? Math.max(0, rows.length - shortCount) / rows.length : 0,
    hashtagSignalHits,
    tagSignalHits,
    keywordSignalHits,
    durationSignalHits,
    scoreThreshold: SHORTS_SCORE_THRESHOLD,
  };
}

function deriveContentInsights(rows: DashboardTemplateVideoRecord[]): DashboardTemplateContentInsights {
  const withCategory = rows.filter((row) => row.videoCategoryLabel).length;
  const withTags = rows.filter((row) => row.tags.length > 0).length;
  const withDescription = rows.filter((row) => row.description).length;
  const withTopics = rows.filter((row) => row.topicCategories.length > 0).length;
  const tagTotal = rows.reduce((acc, row) => acc + row.tags.length, 0);

  return {
    overview: {
      videos: rows.length,
      withCategory,
      withTags,
      withDescription,
      withTopics,
      avgTagsPerTaggedVideo: withTags > 0 ? tagTotal / withTags : 0,
    },
    categories: countBy(rows.map((row) => row.videoCategoryLabel || 'unknown'), 6),
    topics: countBy(rows.flatMap((row) => row.topicCategories.length ? row.topicCategories : ['unknown']), 6),
    intent: countBy(rows.map((row) => inferIntentFromText(`${row.title} ${row.description}`)), 6),
    durations: countBy(rows.map((row) => durationBucket(row.durationSec)), 6),
    shortsEstimate: computeShortsEstimate(rows),
    keywords: {
      titleKeywords: keywordDocumentFrequency(rows.map((row) => row.title).filter(Boolean), 36),
      descriptionKeywords: keywordDocumentFrequency(rows.map((row) => row.description).filter(Boolean), 36),
      tagKeywords: keywordDocumentFrequency(rows.map((row) => row.tags.join(' ')).filter(Boolean), 36),
    },
  };
}

function resolveThumbnailUrl(row: any): string {
  return toText(
    row?.thumbnailUrl
    ?? row?.thumbnail
    ?? row?.thumbnail_default
    ?? row?.thumbnail_medium
    ?? row?.thumbnail_high
    ?? row?.thumbnail_maxres,
  );
}

function resolveCaptionValue(row: any): string {
  return toText(row?.caption ?? row?.captionsAvailable ?? row?.captionAvailable ?? row?.captions);
}

function resolveChannelTitle(row: any): string {
  return toText(row?.channelTitle ?? row?.channel ?? row?.creator ?? row?.ChannelTitle);
}

function resolveCategory(row: any): string {
  return toText(row?.videoCategoryLabel ?? row?.categoryLabel ?? row?.category ?? row?.videoCategory);
}

function resolveTopicCategories(row: any): string[] {
  return toTextList(row?.topicCategories ?? row?.topicCategoryDetails ?? row?.topics ?? row?.topic_categories);
}

function resolveDuration(row: any): number | null {
  return parseDurationSeconds(row?.durationSec ?? row?.duration_seconds ?? row?.duration ?? row?.lengthSeconds ?? row?.length_seconds);
}

function resolveImportedChannelMetadataRow(row: any, importedChannelMetadata?: ImportedChannelMetadataState | null): Record<string, any> | null {
  if (!importedChannelMetadata || !Object.keys(importedChannelMetadata.byKey || {}).length) return null;
  const channelId = resolveChannelId(row);
  const channelTitle = resolveChannelTitle(row);
  const possibleKeys = [
    channelId ? buildChannelLookupKey(channelId, 'channelId') : null,
    channelTitle ? buildChannelLookupKey(channelTitle, 'normalizedChannelTitle') : null,
  ].filter((value): value is string => Boolean(value));

  for (const key of possibleKeys) {
    const entry = importedChannelMetadata.byKey[key];
    if (entry) return entry;
  }
  return null;
}

function resolveChannelCreatedAt(row: any, importedChannelMetadata?: ImportedChannelMetadataState | null): string {
  const importedRow = resolveImportedChannelMetadataRow(row, importedChannelMetadata);
  const value = row?.channel_created_at
    ?? row?.channelCreatedAt
    ?? row?.channel_joined
    ?? row?.channelJoined
    ?? row?.channel_created
    ?? importedRow?.channel_created_at
    ?? importedRow?.publishedAt
    ?? importedRow?.published_at
    ?? importedRow?.channel_joined
    ?? importedRow?.channelCreatedAt
    ?? importedRow?.joined
    ?? importedRow?.creation_date
    ?? '';
  return toText(value);
}

function buildEmptyTimelineOverview(): DashboardTemplateProvenanceInsights['overview']['upload'] {
  return {
    validDateCount: 0,
    validDateShare: 0,
    firstLabel: 'n/a',
    lastLabel: 'n/a',
    rangeDays: 0,
    binning: 'weekly',
    totalBins: 0,
    peakCount: 0,
    maxBinCount: 0,
  };
}

function deriveTimelineInsights(timestamps: number[], totalRows: number): {
  overview: DashboardTemplateProvenanceInsights['overview']['upload'];
  timeSeries: DashboardTemplateTimePoint[];
  timestamps: number[];
  minTs: number | null;
  maxTs: number | null;
} {
  const sortedTimestamps = [...timestamps].sort((a, b) => a - b);
  const validDateCount = sortedTimestamps.length;
  const minTs = sortedTimestamps[0] ?? null;
  const maxTs = sortedTimestamps[sortedTimestamps.length - 1] ?? null;

  if (validDateCount === 0 || minTs === null || maxTs === null) {
    return {
      overview: buildEmptyTimelineOverview(),
      timeSeries: [] as DashboardTemplateTimePoint[],
      timestamps: [] as number[],
      minTs: null as number | null,
      maxTs: null as number | null,
    };
  }

  const minDay = floorUtcDay(minTs);
  const maxDay = floorUtcDay(maxTs);
  const rangeDays = Math.floor((maxDay - minDay) / DAY_MS) + 1;
  const binning: DashboardTemplateProvenanceInsights['overview']['upload']['binning'] = rangeDays <= 160 ? 'daily' : 'weekly';
  const binSize = binning === 'daily' ? DAY_MS : WEEK_MS;
  const bucketFloor = binning === 'daily' ? floorUtcDay : floorUtcWeek;
  const bucketCounts = new Map<number, number>();
  sortedTimestamps.forEach((ts) => {
    const bucket = bucketFloor(ts);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  });

  const startBucket = bucketFloor(minTs);
  const endBucket = bucketFloor(maxTs);
  const points: Array<{ startTs: number; count: number }> = [];
  for (let bucket = startBucket; bucket <= endBucket; bucket += binSize) {
    points.push({ startTs: bucket, count: bucketCounts.get(bucket) ?? 0 });
  }

  const counts = points.map((point) => point.count);
  const moving = movingAverage(counts, binning === 'daily' ? 7 : 4);
  const peakIndices = detectPeakIndices(counts);
  const maxBinCount = Math.max(0, ...counts);

  return {
    overview: {
      validDateCount,
      validDateShare: toShare(validDateCount, totalRows),
      firstLabel: DATE_LABEL_FMT.format(minTs),
      lastLabel: DATE_LABEL_FMT.format(maxTs),
      rangeDays,
      binning,
      totalBins: points.length,
      peakCount: peakIndices.size,
      maxBinCount,
    },
    timeSeries: points.map((point, index) => ({
      key: `${point.startTs}-${index}`,
      startTs: point.startTs,
      label: binning === 'daily' ? SHORT_DATE_FMT.format(point.startTs) : `wk ${SHORT_DATE_FMT.format(point.startTs)}`,
      count: point.count,
      movingAvg: moving[index] ?? point.count,
      isPeak: peakIndices.has(index),
    })),
    timestamps: sortedTimestamps,
    minTs,
    maxTs,
  };
}

function normalizeTemplateRows(rows: any[], annotations: Record<string, Annotation> = {}, importedChannelMetadata?: ImportedChannelMetadataState | null): DashboardTemplateVideoRecord[] {
  return rows.map((row) => {
    const videoId = resolveVideoId(row) ?? undefined;
    const annotation = videoId ? annotations[videoId] : undefined;
    return {
      title: toText(resolveVideoTitle(row)),
      description: toText(resolveVideoDescription(row)),
      channelTitle: resolveChannelTitle(row),
      channelId: resolveChannelId(row),
      channelCreatedAt: resolveChannelCreatedAt(row, importedChannelMetadata),
      thumbnailUrl: resolveThumbnailUrl(row),
      transcript: toText(resolveTranscript(row, annotation)),
      tags: resolveVideoTags(row),
      videoCategoryLabel: resolveCategory(row),
      topicCategories: resolveTopicCategories(row),
      durationSec: resolveDuration(row),
      caption: resolveCaptionValue(row),
      defaultLanguage: toText(row?.defaultLanguage),
      defaultAudioLanguage: toText(row?.defaultLAudioLanguage ?? row?.defaultAudioLanguage),
      viewCount: parseNumber(resolveViews(row)),
      commentCount: parseNumber(row?.commentCount ?? row?.comments),
      likeCount: parseNumber(row?.likeCount ?? row?.likes),
      videoId,
      publishedAt: toText(resolvePublishedAt(row)),
    };
  });
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

function trim(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(0);
  return value.toFixed(1).replace(/\.0$/, '');
}

function buildSummaryText(snapshot: Omit<DashboardTemplateSnapshot, 'summaryText' | 'detailedSummaryText'>): string {
  const topVideo = snapshot.columns.find((column) => column.key === 'video')?.ranking[0];
  const topChannel = snapshot.columns.find((column) => column.key === 'channel')?.ranking[0];
  return [
    `Dashboard snapshot for ${snapshot.datasetLabel} (${snapshot.scopeLabel})`,
    `Rows: ${snapshot.overview.totalRows}`,
    `Unique channels: ${snapshot.overview.uniqueChannels}`,
    `Total views: ${formatCompact(snapshot.overview.totalViews)}`,
    `Status: ${snapshot.overview.overallStatus}`,
    `Caveat: ${snapshot.overview.caveats[0]?.text ?? 'No major structural quality flags detected.'}`,
    `Top video: ${topVideo ? `${topVideo.fullLabel} (${formatPercent(topVideo.share, 1)})` : 'n/a'}`,
    `Top channel: ${topChannel ? `${topChannel.fullLabel} (${formatPercent(topChannel.share, 1)})` : 'n/a'}`,
  ].join('\n');
}

function formatDateLabel(value: number | null): string {
  if (!value || !Number.isFinite(value)) return 'n/a';
  return DATE_LABEL_FMT.format(value);
}

function summarizeCountStats(title: string, items: DashboardTemplateCountStat[], max = 6): string[] {
  if (!items.length) return [`${title}: No entries recorded.`];
  const lines = [`${title}:`];
  items.slice(0, max).forEach((item, index) => {
    lines.push(`  ${index + 1}. ${item.label} — ${item.count.toLocaleString()} (${formatPercent(item.share, 1)})`);
  });
  return lines;
}

function summarizeAttentionColumn(column: DashboardTemplateColumn): string[] {
  if (!column.available) {
    return [
      `${column.title}: unavailable`,
      `  Missing fields: ${(column.missingFields ?? []).join(', ') || 'unknown'}`,
    ];
  }

  const concentration = column.concentration
    .map((segment) => `${segment.label} ${formatPercent(segment.share, 1)}`)
    .join(' | ');
  const topRanking = column.ranking
    .slice(0, 5)
    .map((item) => `${item.rank}. ${item.fullLabel} (${formatPercent(item.share, 1)})`)
    .join(' | ');

  return [
    `${column.title}:`,
    `  Metric: ${column.metricLabel}`,
    `  Entity count: ${column.boxStats.sampleSize ?? 0}`,
    `  Concentration checkpoints: ${concentration || 'n/a'}`,
    `  Distribution (log band): min ${formatCompact(column.boxStats.min)}, p10 ${formatCompact(column.boxStats.p10)}, q1 ${formatCompact(column.boxStats.q1)}, median ${formatCompact(column.boxStats.median)}, q3 ${formatCompact(column.boxStats.q3)}, p90 ${formatCompact(column.boxStats.p90)}, max ${formatCompact(column.boxStats.max)}`,
    `  Top ranking: ${topRanking || 'n/a'}`,
  ];
}

function buildDetailedSummaryText(snapshot: Omit<DashboardTemplateSnapshot, 'summaryText' | 'detailedSummaryText'>): string {
  const overview = snapshot.overview;
  const provenance = snapshot.provenance;
  const caveatLines = overview.caveats.length
    ? overview.caveats.map((caveat, index) => `  ${index + 1}. [${caveat.severity}] ${caveat.text}`)
    : ['  No caveats generated.'];

  const overviewSection = [
    'SECTION 1 — OVERVIEW',
    `Dataset label: ${snapshot.datasetLabel}`,
    `Scope: ${snapshot.scopeLabel}`,
    `Snapshot timestamp: ${formatDateLabel(snapshot.snapshotTs)}`,
    '',
    'Corpus scale and completeness:',
    `  Total rows: ${overview.totalRows.toLocaleString()}`,
    `  Video rows: ${overview.totalVideos.toLocaleString()}`,
    `  Unique video IDs: ${overview.uniqueVideoIds.toLocaleString()}`,
    `  Unique channels: ${overview.uniqueChannels.toLocaleString()}`,
    `  Total views: ${formatCompact(overview.totalViews)}`,
    `  Total comments: ${formatCompact(overview.totalComments)}`,
    `  Total likes: ${formatCompact(overview.totalLikes)}`,
    `  Valid publish dates: ${overview.validPublishCount.toLocaleString()} (${formatPercent(overview.validPublishCount / Math.max(1, overview.totalVideos), 1)})`,
    `  Malformed publish dates: ${overview.malformedDateCount.toLocaleString()}`,
    `  Publish range: ${formatDateLabel(overview.oldestPublishTs)} → ${formatDateLabel(overview.newestPublishTs)}`,
    `  Median publish timestamp: ${formatDateLabel(overview.medianPublishTs)}`,
    '',
    'Quality checks and caveats:',
    `  Overall status: ${overview.overallStatus}`,
    `  Status reason: ${overview.statusReason}`,
    `  Duplicate videos: ${formatPercent(overview.duplicateRate, 1)} (${overview.duplicateCount.toLocaleString()} rows)`,
    `  Duplicate rows: ${formatPercent(overview.exactDuplicateRowRate, 1)} (${overview.exactDuplicateRowCount.toLocaleString()} rows)`,
    `  Zero-view rows: ${formatPercent(overview.zeroViewRate, 1)}`,
    `  Zero-comment rows: ${formatPercent(overview.zeroCommentRate, 1)}`,
    `  Zero-like rows: ${formatPercent(overview.zeroLikeRate, 1)}`,
    `  Channels appearing once: ${overview.oneVideoChannelCount.toLocaleString()} (${formatPercent(overview.oneVideoChannelShare, 1)})`,
    ...caveatLines,
    '',
    'Coverage metrics:',
    ...overview.coverage.map((metric) => `  - ${metric.label}: present ${formatPercent(metric.presentShare, 1)} (${metric.presentCount.toLocaleString()}), missing ${formatPercent(metric.missingShare, 1)} (${metric.missingCount.toLocaleString()})`),
    '',
    'Timeline and language diagnostics:',
    `  Upload binning: ${provenance.overview.upload.binning}`,
    `  Upload bins: ${provenance.overview.upload.totalBins.toLocaleString()}`,
    `  Upload peak bins: ${provenance.overview.upload.peakCount.toLocaleString()}`,
    `  Upload max bin count: ${provenance.overview.upload.maxBinCount.toLocaleString()}`,
    `  Upload span: ${provenance.overview.upload.rangeDays.toLocaleString()} days`,
    `  First upload label: ${provenance.overview.upload.firstLabel}`,
    `  Last upload label: ${provenance.overview.upload.lastLabel}`,
    `  Channel-age binning: ${provenance.overview.channelAge.binning}`,
    `  Channel-age bins: ${provenance.overview.channelAge.totalBins.toLocaleString()}`,
    `  Channel-age peak bins: ${provenance.overview.channelAge.peakCount.toLocaleString()}`,
    `  Channel-age max bin count: ${provenance.overview.channelAge.maxBinCount.toLocaleString()}`,
    `  Channel-age span: ${provenance.overview.channelAge.rangeDays.toLocaleString()} days`,
    `  First channel label: ${provenance.overview.channelAge.firstLabel}`,
    `  Last channel label: ${provenance.overview.channelAge.lastLabel}`,
    ...provenance.languageRows.slice(0, 8).map((row) => (
      `  - ${row.label}: declared ${row.declaredCount.toLocaleString()} (${formatPercent(row.declaredShare, 1)}), audio ${row.audioCount.toLocaleString()} (${formatPercent(row.audioShare, 1)})`
    )),
  ];

  const attentionSection = [
    'SECTION 2 — ATTENTION',
    'This section mirrors the three inequality columns used in the dashboard attention view.',
    '',
    ...snapshot.columns.flatMap((column, index) => (
      index === 0 ? summarizeAttentionColumn(column) : ['', ...summarizeAttentionColumn(column)]
    )),
  ];

  const content = snapshot.content;
  const shorts = content.shortsEstimate;
  const contentSection = [
    'SECTION 3 — CONTENT',
    'Content composition, durations, intent cues, and keyword clouds from the content dashboard view.',
    '',
    `Content overview: videos ${content.overview.videos.toLocaleString()}, with category ${content.overview.withCategory.toLocaleString()}, with tags ${content.overview.withTags.toLocaleString()}, with descriptions ${content.overview.withDescription.toLocaleString()}, with topics ${content.overview.withTopics.toLocaleString()}, avg tags/tagged video ${content.overview.avgTagsPerTaggedVideo.toFixed(2)}`,
    '',
    ...summarizeCountStats('Top categories', content.categories, 8),
    '',
    ...summarizeCountStats('Top topics', content.topics, 8),
    '',
    ...summarizeCountStats('Duration buckets', content.durations, 8),
    '',
    ...summarizeCountStats('Intent cues', content.intent, 8),
    '',
    'Estimated shorts share:',
    `  Short count: ${shorts.shortCount.toLocaleString()} (${formatPercent(shorts.shortShare, 1)})`,
    `  Long count: ${shorts.longCount.toLocaleString()} (${formatPercent(shorts.longShare, 1)})`,
    `  Score threshold: ${shorts.scoreThreshold}`,
    `  Signal hits — hashtag ${shorts.hashtagSignalHits.toLocaleString()}, tag ${shorts.tagSignalHits.toLocaleString()}, keyword ${shorts.keywordSignalHits.toLocaleString()}, duration ${shorts.durationSignalHits.toLocaleString()}`,
    '',
    ...summarizeCountStats('Title keywords', content.keywords.titleKeywords, 12),
    '',
    ...summarizeCountStats('Description keywords', content.keywords.descriptionKeywords, 12),
    '',
    ...summarizeCountStats('Tag keywords', content.keywords.tagKeywords, 12),
  ];

  return [
    `Dashboard calculations write-up for ${snapshot.datasetLabel} (${snapshot.scopeLabel})`,
    '',
    ...overviewSection,
    '',
    ...attentionSection,
    '',
    ...contentSection,
  ].join('\n');
}

export function buildDashboardTemplateSnapshot(args: {
  rows: any[];
  annotations?: Record<string, Annotation>;
  importedChannelMetadata?: ImportedChannelMetadataState | null;
  datasetLabel?: string | null;
  scope: DashboardScope;
  scopeLabel?: string;
}): DashboardTemplateSnapshot {
  const normalized = normalizeTemplateRows(args.rows, args.annotations, args.importedChannelMetadata);
  const baseSnapshot = {
    datasetLabel: args.datasetLabel?.trim() || 'Untitled dataset',
    sourceLabel: 'Playlist Surfer',
    scopeLabel: args.scopeLabel || (args.scope === 'full' ? 'full dataset' : 'filtered subset'),
    snapshotTs: Date.now(),
    validVideoRows: normalized.filter((row) => row.title && row.viewCount !== null).length,
    columns: deriveColumns(normalized),
    content: deriveContentInsights(normalized),
    overview: deriveOverviewInsights(normalized),
    provenance: deriveProvenanceInsights(normalized),
  };

  return {
    ...baseSnapshot,
    summaryText: buildSummaryText(baseSnapshot),
    detailedSummaryText: buildDetailedSummaryText(baseSnapshot),
  };
}
