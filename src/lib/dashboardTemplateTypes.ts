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
};

export type DashboardTemplateCountStat = {
  label: string;
  count: number;
  share: number;
};

export type DashboardTemplateContentOverviewStats = {
  videos: number;
  withCategory: number;
  withTags: number;
  withDescription: number;
  withTopics: number;
  avgTagsPerTaggedVideo: number;
};

export type DashboardTemplateKeywordStats = {
  titleKeywords: DashboardTemplateCountStat[];
  descriptionKeywords: DashboardTemplateCountStat[];
  tagKeywords: DashboardTemplateCountStat[];
};

export type DashboardTemplateShortsEstimate = {
  shortCount: number;
  longCount: number;
  shortShare: number;
  longShare: number;
  hashtagSignalHits: number;
  tagSignalHits: number;
  keywordSignalHits: number;
  durationSignalHits: number;
  scoreThreshold: number;
};

export type DashboardTemplateContentInsights = {
  overview: DashboardTemplateContentOverviewStats;
  categories: DashboardTemplateCountStat[];
  topics: DashboardTemplateCountStat[];
  intent: DashboardTemplateCountStat[];
  durations: DashboardTemplateCountStat[];
  shortsEstimate: DashboardTemplateShortsEstimate;
  keywords: DashboardTemplateKeywordStats;
};

export type DashboardTemplateTimelineOverview = {
  validDateCount: number;
  validDateShare: number;
  firstLabel: string;
  lastLabel: string;
  rangeDays: number;
  binning: 'daily' | 'weekly';
  totalBins: number;
  peakCount: number;
  maxBinCount: number;
};

export type DashboardTemplateProvenanceOverview = {
  totalVideos: number;
  upload: DashboardTemplateTimelineOverview;
  channelAge: DashboardTemplateTimelineOverview;
};

export type DashboardTemplateTimePoint = {
  key: string;
  startTs: number;
  label: string;
  count: number;
  movingAvg: number;
  isPeak: boolean;
};

export type DashboardTemplateLanguageRow = {
  label: string;
  declaredCount: number;
  audioCount: number;
  declaredShare: number;
  audioShare: number;
};

export type DashboardTemplateProvenanceInsights = {
  overview: DashboardTemplateProvenanceOverview;
  timeSeries: DashboardTemplateTimePoint[];
  uploadTimestamps: number[];
  minTs: number | null;
  maxTs: number | null;
  channelAgeSeries: DashboardTemplateTimePoint[];
  channelAgeTimestamps: number[];
  channelAgeMinTs: number | null;
  channelAgeMaxTs: number | null;
  languageRows: DashboardTemplateLanguageRow[];
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

export type DashboardTemplateBoxStats = {
  min: number;
  p10: number;
  q1: number;
  median: number;
  q3: number;
  p90: number;
  max: number;
  gini?: number;
  ratioP90ToMedian?: number;
  sampleSize?: number;
  medianLikes?: number;
  likesTop10Share?: number;
};

export type DashboardTemplateSegment = {
  key: 'top1' | 'nextBucket' | 'restTop10' | 'rest90';
  label: string;
  share: number;
  rawValue: number;
};

export type DashboardTemplateRankedItem = {
  rank: number;
  label: string;
  fullLabel: string;
  share: number;
  rawValue: number;
  kind?: 'video' | 'channel';
  videoId?: string;
  channelId?: string | null;
  channelName?: string;
};

export type DashboardTemplateColumn = {
  key: 'video' | 'channel' | 'engagement';
  title: string;
  metricLabel: string;
  headlineLabel: string;
  headlineShare: number;
  concentration: DashboardTemplateSegment[];
  boxStats: DashboardTemplateBoxStats;
  rankingTitle: string;
  ranking: DashboardTemplateRankedItem[];
  available: boolean;
  missingFields?: string[];
};

export type DashboardTemplateSnapshot = {
  datasetLabel: string;
  sourceLabel: string;
  scopeLabel: string;
  snapshotTs: number;
  validVideoRows: number;
  columns: DashboardTemplateColumn[];
  content: DashboardTemplateContentInsights;
  overview: DashboardTemplateOverviewInsights;
  provenance: DashboardTemplateProvenanceInsights;
  summaryText: string;
  detailedSummaryText: string;
};
