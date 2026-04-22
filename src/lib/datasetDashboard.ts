import { DatasetDashboardStats, DashboardHistogramBin, DashboardShareItem } from '../types';
import { resolveTranscript, resolveVideoDescription, resolveVideoTags } from './data';
import { maxOf, minOf } from './largeData';

function getFirstValue(row: any, candidates: string[]) {
  for (const key of candidates) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : (value > 1e9 ? value * 1000 : value);
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function truthyFlag(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  return !['', '0', 'false', 'no', 'none', 'null', 'n'].includes(normalized);
}

function normalizeLanguage(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.split(/[-_]/)[0].toLowerCase() || null;
}

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  if (next === undefined) return sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

function shareOfTopN(values: number[], count: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => b - a);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  const top = sorted.slice(0, Math.min(count, sorted.length)).reduce((sum, value) => sum + value, 0);
  return top / total;
}

function topShare(values: number[]): number | null {
  return shareOfTopN(values, Math.max(1, Math.ceil(values.length * 0.1)));
}

function gini(values: number[]): number | null {
  const sorted = [...values].filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return null;
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  let cumulative = 0;
  for (let index = 0; index < n; index += 1) {
    cumulative += (2 * (index + 1) - n - 1) * sorted[index];
  }
  const coefficient = cumulative / (n * total);
  return Number(Math.max(0, coefficient).toFixed(4));
}

function hhiFromShares(shares: number[]): number | null {
  if (!shares.length) return null;
  return shares.reduce((sum, share) => sum + share * share, 0);
}

function shareItemsFromCounts(counts: Map<string, number>, total: number, limit = 5): DashboardShareItem[] {
  if (!total) return [];
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count, share: count / total }));
}

function shareItemsFromValues(values: Map<string, number>, total: number, limit = 5): DashboardShareItem[] {
  if (!total) return [];
  return [...values.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, value]) => ({ label, value, share: value / total }));
}

function buildUploadBins(dates: Date[]): DashboardHistogramBin[] {
  if (!dates.length) return [];
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const first = sorted[0].getTime();
  const last = sorted[sorted.length - 1].getTime();
  const binCount = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(sorted.length))));
  if (last === first) {
    return [{ label: sorted[0].toISOString().slice(0, 10), count: sorted.length }];
  }
  const width = (last - first) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    label: new Date(first + width * index).toISOString().slice(0, 10),
    count: 0,
  }));
  sorted.forEach((date) => {
    const idx = Math.min(binCount - 1, Math.floor((date.getTime() - first) / width));
    bins[idx].count += 1;
  });
  return bins;
}

function bucketCounts(values: number[], buckets: Array<{ label: string; test: (value: number) => boolean }>): DashboardHistogramBin[] {
  const counts = buckets.map((bucket) => ({ label: bucket.label, count: 0 }));
  values.forEach((value) => {
    const match = buckets.findIndex((bucket) => bucket.test(value));
    if (match >= 0) counts[match].count += 1;
  });
  return counts;
}

function percent(count: number, total: number): number {
  if (!total) return 0;
  return count / total;
}

function hasAnyColumn(rows: any[], candidates: string[]): boolean {
  if (!rows.length) return false;
  const keys = Object.keys(rows[0] || {});
  return candidates.some((candidate) => keys.includes(candidate) || keys.some((key) => key.toLowerCase() === candidate.toLowerCase()));
}

const STOPWORDS = new Set([
  'the','a','an','and','or','but','for','with','from','that','this','these','those','you','your','about','into','over','after','before','how','why','what','when','where','who','are','was','were','is','be','been','being','have','has','had','its','it','they','them','their','our','ours','his','her','hers','she','he','we','i','to','of','in','on','at','by','as','if','than','then','too','very','can','could','should','would','will','just','not','no','yes','do','does','did','so','up','out','off','my','me',
]);

function tokenizeKeywords(rows: any[]): DashboardShareItem[] {
  const SAMPLE_LIMIT = 2500;
  const counts = new Map<string, number>();
  rows.slice(0, SAMPLE_LIMIT).forEach((row) => {
    const text = [
      getFirstValue(row, ['videoTitle', 'title', 'video_title']) || '',
      (resolveVideoDescription(row) || '').slice(0, 240),
    ].join(' ').toLowerCase();
    const tokens = text
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
    new Set(tokens).forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
  });
  const total = Math.max(1, Math.min(rows.length, SAMPLE_LIMIT));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 16)
    .map(([label, count]) => ({ label, count, share: count / total }));
}

export function buildDatasetDashboardStats(rows: any[]): DatasetDashboardStats {
  const videoCount = rows.length;
  const channelCounts = new Map<string, number>();
  const channelViews = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const categoryViews = new Map<string, number>();
  const languageCounts = new Map<string, number>();
  const languageViews = new Map<string, number>();
  const uploadDates: Date[] = [];
  const agesInDays: number[] = [];
  const viewValues: number[] = [];
  const viewsPerDayValues: number[] = [];
  const commentValues: number[] = [];
  let totalViews = 0;
  let totalVideoComments = 0;
  let descriptionPresent = 0;
  let tagsPresent = 0;
  let thumbnailsPresent = 0;
  let transcriptsPresent = 0;
  let captionsPresent = 0;

  const now = Date.now();

  rows.forEach((row) => {
    const channel = String(getFirstValue(row, ['channelTitle', 'channel', 'ChannelTitle']) || '').trim();
    if (channel) channelCounts.set(channel, (channelCounts.get(channel) || 0) + 1);

    const views = parseNumber(getFirstValue(row, ['viewCount', 'views', 'Views'])) || 0;
    viewValues.push(views);
    totalViews += views;
    if (channel) channelViews.set(channel, (channelViews.get(channel) || 0) + views);

    const comments = parseNumber(getFirstValue(row, ['commentCount', 'comments', 'Comments'])) || 0;
    commentValues.push(comments);
    totalVideoComments += comments;

    const published = parseDate(getFirstValue(row, ['publishedAtSQL', 'publishedAt', 'published_at', 'date']));
    if (published) {
      uploadDates.push(published);
      const ageDays = Math.max(1, Math.floor((now - published.getTime()) / 86400000));
      agesInDays.push(ageDays);
      viewsPerDayValues.push(views / ageDays);
    }

    const category = String(getFirstValue(row, ['videoCategoryLabel', 'category', 'videoCategory']) || '').trim();
    if (category) {
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
      categoryViews.set(category, (categoryViews.get(category) || 0) + views);
    }

    const language = normalizeLanguage(getFirstValue(row, ['defaultLanguage', 'defaultLAudioLanguage', 'language']));
    if (language) {
      languageCounts.set(language, (languageCounts.get(language) || 0) + 1);
      languageViews.set(language, (languageViews.get(language) || 0) + views);
    }

    if (resolveVideoDescription(row).trim()) descriptionPresent += 1;
    if (resolveVideoTags(row).length > 0) tagsPresent += 1;
    if (truthyFlag(getFirstValue(row, ['thumbnail_maxres', 'thumbnail_default', 'thumbnail_medium', 'thumbnail_high', 'thumbnail']))) thumbnailsPresent += 1;
    if (resolveTranscript(row).trim()) transcriptsPresent += 1;
    if (truthyFlag(getFirstValue(row, ['caption', 'captions']))) captionsPresent += 1;
  });

  const uniqueChannelCount = channelCounts.size;
  const categoryCount = categoryCounts.size;
  const languageCount = languageCounts.size;

  const uploadTimestamps = uploadDates.map((date) => date.getTime());
  const oldest = uploadTimestamps.length ? new Date(minOf(uploadTimestamps)) : null;
  const newest = uploadTimestamps.length ? new Date(maxOf(uploadTimestamps)) : null;
  const uploadSpanDays = oldest && newest ? Math.max(0, Math.round((newest.getTime() - oldest.getTime()) / 86400000)) : 0;
  const transcriptCoverage = percent(transcriptsPresent, videoCount);
  const tagCoverage = percent(tagsPresent, videoCount);
  const captionCoverage = percent(captionsPresent, videoCount);
  const descriptionCoverage = percent(descriptionPresent, videoCount);

  const warnings: string[] = [];
  if (hasAnyColumn(rows, ['position', 'rank', 'searchTerm', 'searchQuery', 'query'])) warnings.push('Search/ranked sample');
  if (videoCount > 0 && transcriptsPresent < videoCount && hasAnyColumn(rows, ['transcript', 'text'])) warnings.push('Transcripts missing');
  if (videoCount > 0 && tagsPresent < videoCount && hasAnyColumn(rows, ['tags', 'videoTags', 'video_tags'])) warnings.push('Tags incomplete');
  if (captionCoverage > 0 && captionCoverage < 0.2) warnings.push('Captions rare');
  if (!hasAnyColumn(rows, ['dislikeCount', 'dislikes'])) warnings.push('Dislikes unavailable');
  if (!hasAnyColumn(rows, ['subscriberCount', 'subscribers'])) warnings.push('Subscriber data not present');

  const topChannelsByRows = shareItemsFromCounts(channelCounts, videoCount, 8);
  const topChannelsByViews = shareItemsFromValues(channelViews, totalViews, 8);
  const dominantShare = topChannelsByViews[0]?.share ?? topChannelsByRows[0]?.share ?? 0;
  const dominance = dominantShare >= 0.5 ? 'high' : dominantShare >= 0.25 ? 'moderate' : 'low';

  const recencyBuckets = bucketCounts(agesInDays, [
    { label: '30d', test: (value) => value <= 30 },
    { label: '90d', test: (value) => value > 30 && value <= 90 },
    { label: '365d', test: (value) => value > 90 && value <= 365 },
    { label: 'older', test: (value) => value > 365 },
  ]);

  const ageBuckets = bucketCounts(agesInDays, [
    { label: '<90d', test: (value) => value < 90 },
    { label: '<1y', test: (value) => value >= 90 && value < 365 },
    { label: '1-2y', test: (value) => value >= 365 && value < 730 },
    { label: '2-4y', test: (value) => value >= 730 && value < 1460 },
    { label: '4y+', test: (value) => value >= 1460 },
  ]);

  const topCategories = shareItemsFromCounts(categoryCounts, videoCount, 8);
  const topLanguages = shareItemsFromCounts(languageCounts, videoCount, 8);
  const topCategoriesByViews = shareItemsFromValues(categoryViews, totalViews, 8);
  const topLanguagesByViews = shareItemsFromValues(languageViews, totalViews, 8);
  const longTailCategoryShare = Math.max(0, 1 - topCategories.slice(0, 5).reduce((sum, item) => sum + item.share, 0));
  const channelViewShares = totalViews > 0 ? [...channelViews.values()].map((value) => value / totalViews) : [];

  return {
    videoCount,
    uniqueChannelCount,
    totalVideoComments,
    categoryCount,
    languageCount,
    uploadSpanDays,
    warnings,
    coverage: {
      descriptionsPresentPct: descriptionCoverage,
      tagsPresentPct: tagCoverage,
      thumbnailsPresentPct: percent(thumbnailsPresent, videoCount),
      transcriptsPresentPct: transcriptCoverage,
      captionsAvailablePct: captionCoverage,
    },
    time: {
      oldestUpload: oldest ? oldest.toISOString() : null,
      newestUpload: newest ? newest.toISOString() : null,
      medianAgeDays: median(agesInDays),
      uploadBins: buildUploadBins(uploadDates),
      recencyBuckets,
      ageBuckets,
      uploadsPerDay: videoCount > 0 ? videoCount / Math.max(uploadSpanDays, 1) : null,
      uploadsPerYear: uploadSpanDays > 0 ? videoCount / Math.max(uploadSpanDays / 365, 1 / 365) : videoCount,
    },
    composition: {
      topCategories,
      topLanguages,
      topCategoriesByViews,
      topLanguagesByViews,
      keywordTokens: tokenizeKeywords(rows),
      longTailCategoryShare,
    },
    attention: {
      medianViews: median(viewValues),
      p75Views: quantile(viewValues, 0.75),
      p90Views: quantile(viewValues, 0.9),
      top10ViewShare: topShare(viewValues),
      medianViewsPerDay: median(viewsPerDayValues),
      top1ViewShare: shareOfTopN(viewValues, 1),
      top5ViewShare: shareOfTopN(viewValues, 5),
      top50ViewShare: shareOfTopN(viewValues, 50),
      giniViews: gini(viewValues),
      hhiViews: hhiFromShares(viewValues.length && totalViews > 0 ? viewValues.map((value) => value / totalViews) : []),
    },
    channelMix: {
      topChannelsByRows,
      topChannelsByViews,
      dominance,
      top5RowsShare: topChannelsByRows.slice(0, 5).reduce((sum, item) => sum + item.share, 0),
      top5ViewsShare: topChannelsByViews.slice(0, 5).reduce((sum, item) => sum + item.share, 0),
      hhiViews: hhiFromShares(channelViewShares),
    },
    comments: {
      totalVideoComments,
      medianCommentsPerVideo: median(commentValues),
      top10CommentShare: topShare(commentValues),
    },
    dataQuality: {
      transcriptCoveragePct: transcriptCoverage,
      tagCoveragePct: tagCoverage,
      captionAvailabilityPct: captionCoverage,
      descriptionCoveragePct: descriptionCoverage,
      commentsNote: 'Comments are video-level counts only.',
      viewsComparability: 'Views are directly comparable at a glance; recency still matters.',
    },
  };
}
