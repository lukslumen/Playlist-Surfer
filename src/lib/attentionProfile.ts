import type { DashboardTemplateVideoRecord } from './dashboardTemplateTypes';
import { median } from './overviewProfile';

// The attention tab: how unequally views, likes and comments are spread over videos and channels, how
// engagement relates to reach, and which videos stand out against their own channel.

export type AttentionMetric = 'views' | 'likes' | 'comments';
export type AttentionUnit = 'videos' | 'channels';

export interface ConcentrationCurve {
  /** Items with a value for the metric. */
  count: number;
  total: number;
  /** Share of the total held by the top 1%, 10% and 20% of items. */
  top1: number;
  top10: number;
  top20: number;
  gini: number;
  /** Lorenz-style points, items sorted from largest: x = share of items, y = cumulative share of total. */
  points: Array<[number, number]>;
}

export interface AttentionVideo {
  videoId: string;
  title: string;
  channel: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** (likes + comments) per 1,000 views. */
  engagement: number | null;
  /** Views ÷ the channel's median views; null for channels with fewer than MIN_CHANNEL_VIDEOS videos. */
  vsChannel: number | null;
}

export interface AttentionProfile {
  curves: Record<AttentionUnit, Record<AttentionMetric, ConcentrationCurve>>;
  /** Up to SCATTER_LIMIT videos with views and engagement, always including the stand-outs. */
  scatter: AttentionVideo[];
  scatterTotal: number;
  /** Union of the top videos by views, engagement and vs-channel, so each sort shows its true top. */
  ranked: AttentionVideo[];
  medianEngagement: number | null;
  breakoutCount: number;
  channelsWithNorm: number;
  minViewsForEngagement: number;
}

export const MIN_CHANNEL_VIDEOS = 3;
export const BREAKOUT_RATIO = 3;
export const SCATTER_LIMIT = 1500;
export const RANK_LIMIT = 200;
/** Engagement rates of videos with very few views are mostly noise. */
export const MIN_VIEWS_FOR_ENGAGEMENT = 1000;
const CURVE_POINTS = 100;

export function gini(values: number[]): number {
  const sorted = values.filter((value) => value >= 0).sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (sorted.length < 2 || !total) return 0;
  let weighted = 0;
  sorted.forEach((value, index) => { weighted += (index + 1) * value; });
  return (2 * weighted) / (sorted.length * total) - (sorted.length + 1) / sorted.length;
}

export function concentrationCurve(rawValues: number[]): ConcentrationCurve {
  const values = rawValues.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => b - a);
  const total = values.reduce((sum, value) => sum + value, 0);
  const count = values.length;
  const prefix: number[] = [];
  let running = 0;
  values.forEach((value) => { running += value; prefix.push(running); });
  const shareOfTop = (fraction: number) => {
    if (!count || !total) return 0;
    const items = Math.max(1, Math.ceil(count * fraction));
    return prefix[Math.min(items, count) - 1] / total;
  };
  const points: Array<[number, number]> = [[0, 0]];
  if (count && total) {
    const steps = Math.min(CURVE_POINTS, count);
    for (let step = 1; step <= steps; step += 1) {
      const items = Math.round((step / steps) * count);
      points.push([items / count, prefix[items - 1] / total]);
    }
  }
  return { count, total, top1: shareOfTop(0.01), top10: shareOfTop(0.1), top20: shareOfTop(0.2), gini: gini(values), points };
}

function channelKey(record: DashboardTemplateVideoRecord) {
  return record.channelId || record.channelTitle || '(unknown channel)';
}

/** Every video with its attention measures; the CSV exports use this for the complete list. */
export function attentionVideos(records: DashboardTemplateVideoRecord[]) {
  const videos: AttentionVideo[] = [];
  const viewsByChannel = new Map<string, number[]>();
  const channelTotals = new Map<string, Record<AttentionMetric, number>>();

  records.forEach((record) => {
    const key = channelKey(record);
    const totals = channelTotals.get(key) ?? { views: 0, likes: 0, comments: 0 };
    totals.views += record.viewCount ?? 0;
    totals.likes += record.likeCount ?? 0;
    totals.comments += record.commentCount ?? 0;
    channelTotals.set(key, totals);
    if (record.viewCount !== null) {
      const list = viewsByChannel.get(key) ?? [];
      list.push(record.viewCount);
      viewsByChannel.set(key, list);
    }
  });

  const channelMedian = new Map<string, number>();
  viewsByChannel.forEach((list, key) => {
    if (list.length >= MIN_CHANNEL_VIDEOS) {
      const value = median(list);
      if (value !== null && value > 0) channelMedian.set(key, value);
    }
  });

  records.forEach((record, index) => {
    const views = record.viewCount;
    const hasEngagement = record.likeCount !== null || record.commentCount !== null;
    const engagement = views !== null && views >= MIN_VIEWS_FOR_ENGAGEMENT && hasEngagement
      ? (((record.likeCount ?? 0) + (record.commentCount ?? 0)) / views) * 1000
      : null;
    const norm = channelMedian.get(channelKey(record));
    videos.push({
      videoId: record.videoId || `row-${index}`,
      title: record.title || record.videoId || 'Untitled',
      channel: record.channelTitle,
      views,
      likes: record.likeCount,
      comments: record.commentCount,
      engagement,
      vsChannel: views !== null && norm ? views / norm : null,
    });
  });

  return { videos, channelMedian, channelTotals };
}

export function buildAttentionProfile(records: DashboardTemplateVideoRecord[]): AttentionProfile {
  const { videos, channelMedian, channelTotals } = attentionVideos(records);

  const metricValues = (metric: AttentionMetric) => videos
    .map((video) => (metric === 'views' ? video.views : metric === 'likes' ? video.likes : video.comments))
    .filter((value): value is number => value !== null);
  const channelValues = (metric: AttentionMetric) => [...channelTotals.values()].map((totals) => totals[metric]);
  const curves = {
    videos: { views: concentrationCurve(metricValues('views')), likes: concentrationCurve(metricValues('likes')), comments: concentrationCurve(metricValues('comments')) },
    channels: { views: concentrationCurve(channelValues('views')), likes: concentrationCurve(channelValues('likes')), comments: concentrationCurve(channelValues('comments')) },
  };

  const topBy = (score: (video: AttentionVideo) => number | null) => videos
    .filter((video) => score(video) !== null)
    .sort((a, b) => (score(b) as number) - (score(a) as number))
    .slice(0, RANK_LIMIT);
  const byViews = topBy((video) => video.views);
  const byEngagement = topBy((video) => video.engagement);
  const byChannel = topBy((video) => video.vsChannel);
  const ranked = [...new Map([...byViews, ...byEngagement, ...byChannel].map((video) => [video.videoId, video])).values()];

  // Scatter: every video when few; otherwise an even sample across the view range plus all stand-outs.
  const plottable = videos.filter((video) => video.views !== null && video.views > 0 && video.engagement !== null);
  let scatter = plottable;
  if (plottable.length > SCATTER_LIMIT) {
    const standOuts = new Map([...byEngagement.slice(0, 100), ...byChannel.slice(0, 100), ...byViews.slice(0, 100)]
      .filter((video) => video.engagement !== null)
      .map((video) => [video.videoId, video]));
    const sortedByViews = [...plottable].sort((a, b) => (a.views as number) - (b.views as number));
    const room = Math.max(0, SCATTER_LIMIT - standOuts.size);
    const step = sortedByViews.length / Math.max(1, room);
    for (let position = 0; position < room; position += 1) {
      const video = sortedByViews[Math.floor(position * step)];
      if (video) standOuts.set(video.videoId, video);
    }
    scatter = [...standOuts.values()];
  }

  return {
    curves,
    scatter,
    scatterTotal: plottable.length,
    ranked,
    medianEngagement: median(videos.map((video) => video.engagement).filter((value): value is number => value !== null)),
    breakoutCount: videos.filter((video) => video.vsChannel !== null && video.vsChannel >= BREAKOUT_RATIO).length,
    channelsWithNorm: channelMedian.size,
    minViewsForEngagement: MIN_VIEWS_FOR_ENGAGEMENT,
  };
}
