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
  DashboardTemplateCoverageMetric,
  DashboardTemplateIssue,
  DashboardTemplateOverviewInsights,
  DashboardTemplateSnapshot,
  DashboardTemplateVideoRecord,
} from './dashboardTemplateTypes';
import { buildOverviewProfile } from './overviewProfile';
import { buildAttentionProfile } from './attentionProfile';
import { buildTimeProfile } from './timeProfile';
import { buildVernacularProfile, termIndex } from './vernacularProfile';
import { languageName } from './overviewProfile';

// Builds the dashboard snapshot: normalized video records, the data-health checks, the profile of each
// tab, and a plain-text write-up of all of it for copying into notes or a methods section.

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

export function inferIntentFromText(text: string): string {
  if (!text) return 'other';
  for (const candidate of INTENT_PATTERNS) {
    if (candidate.pattern.test(text)) return candidate.label;
  }
  return 'other';
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

/** cyrb53: a fast 53-bit string hash; collisions are negligible next to the other key fields. */
function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
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
      // A hash, not the text: 100k full descriptions in keys cost hundreds of MB.
      hashText(row.description.trim().toLowerCase()),
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
    ?? row?.channel_publishedAt
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

function resolveChannelSubscribers(row: any, importedChannelMetadata?: ImportedChannelMetadataState | null): number | null {
  const direct = parseNumber(row?.channel_subscriberCount ?? row?.channel_subscriber_count ?? row?.channelSubscriberCount);
  if (direct !== null) return direct;
  const importedRow = resolveImportedChannelMetadataRow(row, importedChannelMetadata);
  return parseNumber(importedRow?.channel_subscriber_count ?? importedRow?.subscriberCount);
}

/** YouTube Data Tools' isShort flag ("yes"/"no"); also accepts true/false and 1/0. Null when absent. */
export function parseShortFlag(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(text)) return true;
  if (['no', 'false', '0', 'n'].includes(text)) return false;
  return null;
}

/** Rows as the dashboard's normalized video records (also used for on-demand exports). */
export function normalizeTemplateRows(rows: any[], annotations: Record<string, Annotation> = {}, importedChannelMetadata?: ImportedChannelMetadataState | null): DashboardTemplateVideoRecord[] {
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
      isShort: parseShortFlag(row?.isShort ?? row?.is_short),
      isShortRaw: row?.isShort ?? row?.is_short ?? undefined,
      channelSubscribers: resolveChannelSubscribers(row, importedChannelMetadata),
    };
  });
}


const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const formatCompact = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : compactFormat.format(value));
const formatPercent = (share: number, digits = 1) => (Number.isFinite(share) ? `${(share * 100).toFixed(digits)}%` : 'n/a');
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type SnapshotBase = Omit<DashboardTemplateSnapshot, 'summaryText' | 'detailedSummaryText'>;

function buildSummaryText(snapshot: SnapshotBase): string {
  const profile = snapshot.profile;
  return [
    `Dashboard snapshot for ${snapshot.datasetLabel} (${snapshot.scopeLabel})`,
    ...(profile?.summary ?? []),
    `Status: ${snapshot.overview.overallStatus}`,
  ].join('\n');
}

function topList(items: Array<{ label: string; videos: number; share: number }>, limit: number): string[] {
  return items.slice(0, limit).map((item, index) => `  ${index + 1}. ${item.label}: ${item.videos.toLocaleString('en-US')} videos (${formatPercent(item.share)})`);
}

function buildDetailedSummaryText(snapshot: SnapshotBase): string {
  const overview = snapshot.overview;
  const profile = snapshot.profile;
  const attention = snapshot.attention;
  const vernacular = snapshot.vernacular;
  const time = snapshot.time;
  const lines: string[] = [`Dashboard write-up for ${snapshot.datasetLabel} (${snapshot.scopeLabel}), generated ${new Date(snapshot.snapshotTs).toISOString().slice(0, 16).replace('T', ' ')} UTC`, ''];

  lines.push('OVERVIEW');
  if (profile) {
    lines.push(...profile.summary, '');
    lines.push(`Videos: ${profile.videos.toLocaleString('en-US')} · channels: ${profile.channels.toLocaleString('en-US')} · total views: ${formatCompact(profile.totalViews)} · median views: ${formatCompact(profile.medianViews)} (middle 80%: ${formatCompact(profile.p10Views)}–${formatCompact(profile.p90Views)})`);
    lines.push(`Length: ${profile.lengths.map((bucket) => `${bucket.label} ${formatPercent(bucket.share, 0)}`).join(', ') || 'n/a'}`);
    lines.push(`Views per video: ${profile.views.map((bucket) => `${bucket.label} ${formatPercent(bucket.share, 0)}`).join(', ') || 'n/a'}`);
    lines.push(`Categories: ${profile.categories.map((entry) => `${entry.label} ${formatPercent(entry.share, 0)}`).join(', ') || 'n/a'}`);
    lines.push(`Languages (${profile.languageSource}): ${profile.languages.map((entry) => `${entry.label} ${formatPercent(entry.share, 0)}`).join(', ') || 'n/a'}`);
  }
  lines.push(`Data health: ${overview.overallStatus} (${overview.statusReason})`);
  lines.push(`Coverage: ${overview.coverage.map((metric) => `${metric.label} ${formatPercent(metric.presentShare, 0)}`).join(', ')}`);
  lines.push(`Duplicate videos: ${overview.duplicateCount.toLocaleString('en-US')} · unreadable dates: ${overview.malformedDateCount.toLocaleString('en-US')}`);
  overview.caveats.forEach((caveat) => lines.push(`  [${caveat.severity}] ${caveat.text}`));

  if (attention) {
    lines.push('', 'ATTENTION');
    (['videos', 'channels'] as const).forEach((unit) => {
      (['views', 'likes', 'comments'] as const).forEach((metric) => {
        const curve = attention.curves[unit][metric];
        if (!curve.count) return;
        lines.push(`${unit} by ${metric}: top 1% hold ${formatPercent(curve.top1)}, top 10% ${formatPercent(curve.top10)}, top 20% ${formatPercent(curve.top20)} · Gini ${curve.gini.toFixed(2)} (n = ${curve.count.toLocaleString('en-US')})`);
      });
    });
    lines.push(`Median engagement: ${attention.medianEngagement === null ? 'n/a' : attention.medianEngagement.toFixed(1)} likes and comments per 1,000 views (videos with ${attention.minViewsForEngagement.toLocaleString('en-US')}+ views)`);
    lines.push(`Breakout videos (3× or more their channel's median views): ${attention.breakoutCount.toLocaleString('en-US')} (channels with a norm: ${attention.channelsWithNorm.toLocaleString('en-US')})`);
    const top = (score: (video: (typeof attention.ranked)[number]) => number | null) => [...attention.ranked].filter((video) => score(video) !== null).sort((a, b) => (score(b) as number) - (score(a) as number)).slice(0, 10);
    lines.push('Most viewed:', ...top((video) => video.views).map((video, index) => `  ${index + 1}. ${video.title} (${video.channel}): ${formatCompact(video.views)} views`));
    lines.push('Most engaging per view:', ...top((video) => video.engagement).map((video, index) => `  ${index + 1}. ${video.title}: ${video.engagement?.toFixed(1)} per 1K views`));
    lines.push('Best against their channel:', ...top((video) => video.vsChannel).map((video, index) => `  ${index + 1}. ${video.title} (${video.channel}): ${video.vsChannel?.toFixed(1)}× channel median`));
  }

  if (vernacular) {
    lines.push('', 'VERNACULAR');
    lines.push(`Stopwords: ${vernacular.stopwordLanguages.map((code) => languageName(code)).join(', ')}${vernacular.exclusions.length ? ` · hidden terms: ${vernacular.exclusions.join(', ')}` : ''}`);
    ([['words', 'Title words'], ['phrases', 'Title phrases'], ['hashtags', 'Hashtags'], ['tags', 'Tags'], ['topics', 'Topics']] as const).forEach(([unit, label]) => {
      const terms = vernacular.terms[unit];
      lines.push(`${label} (in ${formatPercent(vernacular.videos ? vernacular.coverage[unit] / vernacular.videos : 0, 0)} of videos):`, ...(terms.length ? topList(terms, 15) : ['  none']));
    });
    const labels = new Map(vernacular.network.nodes.map((node) => [node.id, node.label]));
    lines.push('Strongest tag/hashtag pairs:', ...vernacular.network.edges.slice(0, 10).map((edge, index) => `  ${index + 1}. ${labels.get(edge.source)} + ${labels.get(edge.target)}: ${edge.weight} videos`));
  }

  if (time && time.datedVideos) {
    lines.push('', 'TIME');
    const dayTotals = time.rhythm.utc.map((hours) => hours.reduce((total, value) => total + value, 0));
    const hourTotals = Array.from({ length: 24 }, (_, hour) => time.rhythm.utc.reduce((total, hours) => total + hours[hour], 0));
    lines.push(`Busiest weekday (UTC): ${DAY_NAMES[dayTotals.indexOf(Math.max(...dayTotals))]} · busiest hour (UTC): ${String(hourTotals.indexOf(Math.max(...hourTotals))).padStart(2, '0')}:00`);
    lines.push(`Median views by ${time.periodUnit}: ${time.viewsByDate.medians.map((entry) => `${time.periods.find((period) => period.startTs === entry.startTs)?.label}: ${formatCompact(entry.median)}`).join(', ') || 'n/a'}`);
    if (time.channelCount > 1) lines.push(`Most active channels: ${time.channels.slice(0, 5).map((channel) => `${channel.label} (${channel.videos})`).join(', ')}`);
    (['hashtags', 'tags', 'words'] as const).forEach((unit) => {
      const rows = time.terms[unit];
      if (!rows.length) return;
      lines.push(`${unit} over time (${time.periods.map((period) => period.label).join(' | ')}):`, ...rows.map((row) => `  ${row.label}: ${row.shares.map((share) => formatPercent(share, 0)).join(' | ')}`));
    });
  }
  return lines.join('\n');
}

export function buildDashboardTemplateSnapshot(args: {
  rows: any[];
  annotations?: Record<string, Annotation>;
  importedChannelMetadata?: ImportedChannelMetadataState | null;
  datasetLabel?: string | null;
  scope: DashboardScope;
  scopeLabel?: string;
  /** Terms the project excludes from vernacular analysis. */
  vernacularExclusions?: string[];
}): DashboardTemplateSnapshot {
  const normalized = normalizeTemplateRows(args.rows, args.annotations, args.importedChannelMetadata);
  // Extract every video's terms once; the vernacular and time profiles both use them.
  const terms = termIndex(normalized, args.vernacularExclusions);
  const baseSnapshot: SnapshotBase = {
    datasetLabel: args.datasetLabel?.trim() || 'Untitled dataset',
    sourceLabel: 'Playlist Surfer',
    scopeLabel: args.scopeLabel || (args.scope === 'full' ? 'full dataset' : 'filtered subset'),
    snapshotTs: Date.now(),
    validVideoRows: normalized.filter((row) => row.title && row.viewCount !== null).length,
    overview: deriveOverviewInsights(normalized),
    profile: buildOverviewProfile(normalized),
    attention: buildAttentionProfile(normalized),
    vernacular: buildVernacularProfile(normalized, { index: terms }),
    time: buildTimeProfile(normalized, { index: terms }),
  };

  return {
    ...baseSnapshot,
    summaryText: buildSummaryText(baseSnapshot),
    detailedSummaryText: buildDetailedSummaryText(baseSnapshot),
  };
}
