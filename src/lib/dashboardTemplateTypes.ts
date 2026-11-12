import type { AttentionProfile } from './attentionProfile';
import type { TimeProfile } from './timeProfile';
import type { VernacularProfile } from './vernacularProfile';

export type DashboardTemplateVideoRecord = {
  title: string;
  description: string;
  channelTitle: string;
  channelId?: string | null;
  thumbnailUrl: string;
  transcript: string;
  tags: string[];
  videoCategoryLabel: string;
  topicCategories: string[];
  durationSec: number | null;
  caption: string;
  defaultLanguage: string;
  defaultAudioLanguage: string;
  viewCount: number | null;
  commentCount: number | null;
  likeCount: number | null;
  videoId?: string;
  publishedAt?: string;
  channelCreatedAt?: string;
  /** YouTube Data Tools' Shorts flag; null when the export has no isShort column. */
  isShort?: boolean | null;
  /** The flag as stored ("yes", "true", …), for drill-down filters. */
  isShortRaw?: string;
  /** The channel's subscriber count, from per-video channel columns or imported channel metadata. */
  channelSubscribers?: number | null;
};

export type DashboardTemplateCoverageMetric = {
  key: string;
  label: string;
  presentCount: number;
  missingCount: number;
  presentShare: number;
  missingShare: number;
};

export type DashboardTemplateIssue = {
  severity: 'high' | 'medium' | 'low';
  text: string;
};

export type DashboardTemplateQualityStatus = 'good' | 'usable with caveats' | 'limited' | 'poor';

export type DashboardTemplateOverviewInsights = {
  totalVideos: number;
  totalRows: number;
  uniqueChannels: number;
  uniqueVideoIds: number;
  totalViews: number;
  totalComments: number;
  totalLikes: number;
  validPublishCount: number;
  malformedDateCount: number;
  newestPublishTs: number | null;
  oldestPublishTs: number | null;
  medianPublishTs: number | null;
  coverage: DashboardTemplateCoverageMetric[];
  duplicateCount: number;
  duplicateRate: number;
  exactDuplicateRowCount: number;
  exactDuplicateRowRate: number;
  zeroViewRate: number;
  zeroCommentRate: number;
  zeroLikeRate: number;
  oneVideoChannelCount: number;
  oneVideoChannelShare: number;
  overallStatus: DashboardTemplateQualityStatus;
  statusReason: string;
  caveats: DashboardTemplateIssue[];
};

export type DashboardTemplateSnapshot = {
  datasetLabel: string;
  sourceLabel: string;
  scopeLabel: string;
  snapshotTs: number;
  validVideoRows: number;
  overview: DashboardTemplateOverviewInsights;
  /** Missing in snapshots saved before the overview was redesigned; those need regenerating. */
  profile?: DashboardOverviewProfile;
  /** Missing in snapshots saved before the dashboards were redesigned; those need regenerating. */
  attention?: AttentionProfile;
  vernacular?: VernacularProfile;
  time?: TimeProfile;
  summaryText: string;
  detailedSummaryText: string;
};

/** One bar of the overview's upload timeline: a calendar day, week, month, quarter or year. */
export type DashboardOverviewTimeBin = {
  startTs: number;
  /** Exclusive end, so a drill-down covers exactly this bin. */
  endTs: number;
  label: string;
  count: number;
};

/** One bar of a bucketed distribution (length, views). `max` is exclusive; null means no upper bound. */
export type DashboardOverviewBucket = {
  key: string;
  label: string;
  min: number;
  max: number | null;
  count: number;
  share: number;
};

export type DashboardOverviewShare = {
  label: string;
  /** What a drill-down filters on; absent for catch-alls like "Other" or "Not set". */
  filterValue?: string;
  count: number;
  share: number;
};

/** What the overview tab shows: headline numbers, a plain-language summary and the main distributions. */
export type DashboardOverviewProfile = {
  videos: number;
  channels: number;
  /** The channel's name when the dataset has exactly one. */
  singleChannelName: string | null;
  firstPublishedTs: number | null;
  lastPublishedTs: number | null;
  datedCount: number;
  totalViews: number;
  medianViews: number | null;
  p10Views: number | null;
  p90Views: number | null;
  medianDurationSec: number | null;
  /** Median of (likes + comments) per 1,000 views, over videos with views. */
  medianEngagementPerThousand: number | null;
  summary: string[];
  uploads: {
    unit: 'day' | 'week' | 'month' | 'quarter' | 'year';
    bins: DashboardOverviewTimeBin[];
    maxCount: number;
    busiest: DashboardOverviewTimeBin | null;
  };
  lengths: DashboardOverviewBucket[];
  lengthUnknownCount: number;
  views: DashboardOverviewBucket[];
  viewsUnknownCount: number;
  categories: DashboardOverviewShare[];
  languages: DashboardOverviewShare[];
  /** Shorts vs regular videos, from the export's isShort flag; empty when the export has none. */
  formats: DashboardOverviewShare[];
  /** Median subscribers of the channels in the set (from channel metadata), or null. */
  medianChannelSubscribers: number | null;
  /** Which language field the languages were counted from. */
  languageSource: 'audio' | 'declared';
};

/** A click in the overview that filters the explorer to the videos behind it. Ranges exclude `max`/`endTs`. */
export type OverviewDrilldown =
  | { kind: 'published'; startTs: number; endTs: number }
  | { kind: 'length'; min: number; max: number | null }
  | { kind: 'views'; min: number; max: number | null }
  | { kind: 'category'; value: string }
  | { kind: 'language'; value: string; source: 'audio' | 'declared' }
  /** Shorts or regular videos; `value` is the isShort value as stored. */
  | { kind: 'format'; value: string }
  /** A vernacular term; `value` is the spelling stored in the data (the raw value for topics). */
  | { kind: 'term'; unit: 'words' | 'phrases' | 'hashtags' | 'tags' | 'topics'; value: string };
