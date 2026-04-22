import type { DashboardTemplateSnapshot } from './lib/dashboardTemplateTypes';

export interface ColumnSchema {
  column_name: string;
  column_type: string;
  source_column_name?: string;
  display_column_name?: string;
  detected_schema?: string;
  semantic_type?: string;
  width_hint?: 'tiny' | 'small' | 'medium' | 'wide' | 'xwide';
}

export interface SavedView {
  id: string;
  name: string;
  columnState: any;
  filterModel: any;
  sortModel?: any;
  visibleColumns?: string[];
  createdAt: number;
}

export interface QuoteRef {
  id: string;
  text: string;
  startIndex: number;
  endIndex: number;
  createdAt: number;
}

export interface TimestampRef {
  id: string;
  seconds: number;
  label: string;
  createdAt: number;
}

export interface Annotation {
  tags: string[];
  notes?: string;
  transcriptOverride?: string;
  quoteRefs?: QuoteRef[];
  timestampRefs?: TimestampRef[];
}

export type InclusionView = 'included' | 'excluded';
export type ViewScope = 'videos' | 'channels';
export type VideoSelectionMode = 'none' | 'explicit' | 'allVisible';

export interface VideoSelectionState {
  mode: VideoSelectionMode;
  ids: string[];
  anchorVideoId: string | null;
  focusVideoId: string | null;
}

export interface IncludeExcludeAction {
  kind: 'exclude' | 'restore';
  videoIds: string[];
  scope?: ViewScope;
  selectionMode?: 'manual' | 'filtered_bulk';
  filterSummary?: string;
}

export type ThemeMode = 'dark' | 'warm-light' | 'pink-pop';

export interface SpecialMappings {
  mergeKeyColumn?: string;
  transcriptColumn?: string;
  descriptionColumn?: string;
  tagColumn?: string;
}

export type ImportKind = 'video' | 'channelMetadata';
export type ChannelMetadataRelationshipType = 'channelId' | 'normalizedChannelTitle';

export interface ChannelMetadataImportAuditEntry {
  sourceFileName: string;
  importedAt: string;
  relationshipType: ChannelMetadataRelationshipType;
  incomingRowCount: number;
  updatedCount: number;
  skippedCount: number;
}

export interface ImportedChannelMetadataState {
  byKey: Record<string, Record<string, any>>;
  columns: string[];
  imports: ChannelMetadataImportAuditEntry[];
}

export type DashboardScope = 'full' | 'filtered';
export type DashboardTabId = 'overview' | 'temporal' | 'inequality' | 'content' | 'locale' | 'reliability';
export type DashboardTemplateTab = 'overview' | 'attention' | 'content' | 'thumbnails' | 'linking';

export type SourceKind = 'base' | 'enrichment' | 'generated';

export interface SourceRegistryEntry {
  id: string;
  label: string;
  kind: SourceKind;
  rowCount: number;
  contributedColumns: string[];
  missing?: boolean;
  createdAt: string;
}

export interface SourceRegistryState {
  byId: Record<string, SourceRegistryEntry>;
  orderedIds: string[];
  primarySourceId?: string | null;
}

export interface SourceVisibilityState {
  hiddenSourceIds: string[];
  hiddenColumnSourceIdsByScope: Record<ViewScope, string[]>;
}

export interface RowLineageEntry {
  rowId: string;
  baseSourceId: string;
  contributorSourceIds: string[];
}

export interface RowLineageState {
  byRowId: Record<string, RowLineageEntry>;
}

export type ColumnScope = ViewScope | 'both';

export interface ColumnLineageEntry {
  column: string;
  sourceId: string;
  generated: boolean;
  scope: ColumnScope;
}

export interface ColumnLineageState {
  byColumn: Record<string, ColumnLineageEntry>;
}

export type LinkingBaseBucket = 'cross-platform' | 'intra-platform' | 'marketplace' | 'crowdfunding' | 'routing' | 'other';

export interface LinkingGeneratedRowMetadata {
  linking_linked: 'yes' | 'no';
  linking_url_count: number;
  linking_domain_count: number;
  linking_base_labels: string[];
  linking_recipe: string;
  linking_top_domains: string[];
  linking_malformed_count: number;
  linking_shortener_count: number;
  linking_raw_links: string[];
  linking_raw_domains: string[];
}

export interface GeneratedMetadataRow {
  content_intent: string;
  linking?: LinkingGeneratedRowMetadata;
}

export interface GeneratedMetadataState {
  byVideoId: Record<string, GeneratedMetadataRow>;
}

export interface LinkingDomainOverride {
  domain: string;
  baseBucket?: LinkingBaseBucket;
  note?: string;
  updatedAt: string;
}

export interface LinkingMentionAuditRecord {
  rowId: string;
  category: string;
  rawUrl: string;
  normalizedUrl: string;
  domain: string;
  baseBucket: LinkingBaseBucket;
  autoAssigned: boolean;
  reason: string;
  malformed: boolean;
  shortener: boolean;
}

export interface LinkingDomainAuditRecord {
  domain: string;
  mentions: number;
  rows: number;
  autoBaseBucket: LinkingBaseBucket;
  currentBaseBucket: LinkingBaseBucket;
  /** Back-compat alias for currentBaseBucket */
  baseBucket: LinkingBaseBucket;
  autoReason: string;
  currentReason: string;
  /** Back-compat alias for currentReason */
  reason: string;
  overridden: boolean;
  unmapped: boolean;
  classificationSource: 'auto' | 'manual';
  overrideNote?: string;
  updatedAt?: string;
}

export interface LinkingRowAuditRecord {
  rowId: string;
  recipe: string;
  baseLabels: string[];
  domains: string[];
  urlCount: number;
}

export interface LinkingSourceCandidateProfile {
  column: string;
  score: number;
  reason: string;
  nonEmptyRows: number;
  urlishRows: number;
  urlishShare: number;
  estimatedUrlMentions: number;
  sampleValues: string[];
}

export interface LinkingSnapshotState {
  sourceColumn: string;
  generatedAt: string;
  datasetFingerprint: string;
  stageAFingerprint: string;
  overrideVersion: number;
  hasLinkedRows: boolean;
  model: any;
  mentionAudit: LinkingMentionAuditRecord[];
  domainAudit: LinkingDomainAuditRecord[];
  rowAudit: LinkingRowAuditRecord[];
}

export interface LinkingState {
  selectedSourceColumn: string | null;
  selectedSourceUpdatedAt?: string;
  stale: boolean;
  staleReason?: string;
  datasetFingerprint?: string;
  sourceVisibilityFingerprint?: string;
  overrideVersion: number;
  sourceCandidateProfiles: LinkingSourceCandidateProfile[];
  parseCacheByKey: Record<string, any>;
  overridesByDomain: Record<string, LinkingDomainOverride>;
  snapshot: LinkingSnapshotState | null;
}

export interface ChannelLinkingSnapshotState {
  generatedAt: string;
  datasetFingerprint: string;
  rowUniverseCount: number;
  byChannelKey: Record<string, Record<string, string | number | null>>;
}

export interface ChannelLinkingState {
  stale: boolean;
  staleReason?: string;
  snapshot: ChannelLinkingSnapshotState | null;
}

export type DashboardThumbnailScopeKey = 'full' | 'filtered-temp' | `savedView:${string}`;
export type DashboardThumbnailPersistentScopeKey = 'full' | `savedView:${string}`;

export interface DashboardThumbnailSortRule {
  columnId: string;
  direction: 'asc' | 'desc';
  order: number;
}

export interface DashboardThumbnailCandidate {
  videoId: string;
  dedupeKey: string;
  title: string;
  sourceUrl: string;
  rank: number;
}

export interface DashboardThumbnailCacheEntry {
  videoId: string;
  dedupeKey: string;
  title: string;
  rank: number;
  sourceUrl: string;
  status: 'pending' | 'loaded' | 'failed';
  mimeType?: string;
  byteLength?: number;
  fileName?: string;
  error?: string;
  bytes?: Uint8Array;
  objectUrl?: string;
}

export interface DashboardThumbnailCacheSnapshot {
  scopeKey: DashboardThumbnailScopeKey;
  label: string;
  rowCount: number;
  totalCandidates: number;
  calculatedAt: string;
  datasetVersionAtCalculation: number;
  filteredViewVersionAtCalculation?: number;
  savedViewsVersionAtCalculation?: number;
  sortSignature?: string;
  entries: DashboardThumbnailCacheEntry[];
}

export interface DashboardThumbnailLoadProgress {
  scopeKey: DashboardThumbnailScopeKey;
  label: string;
  total: number;
  completed: number;
  failed: number;
  loading: boolean;
}

export interface LongTaskProgress {
  title: string;
  detail?: string;
  completed: number;
  total: number;
  indeterminate?: boolean;
}

export interface DashboardThumbnailArchiveEntry {
  videoId: string;
  dedupeKey: string;
  title: string;
  rank: number;
  sourceUrl: string;
  status: 'loaded' | 'failed';
  mimeType?: string;
  byteLength?: number;
  fileName?: string;
  error?: string;
}

export interface DashboardThumbnailArchiveScopeIndex {
  scopeKey: DashboardThumbnailPersistentScopeKey;
  label: string;
  rowCount: number;
  totalCandidates: number;
  calculatedAt: string;
  datasetVersionAtCalculation: number;
  savedViewsVersionAtCalculation?: number;
  sortSignature?: string;
  entries: DashboardThumbnailArchiveEntry[];
}

export interface DashboardThumbnailCacheIndex {
  version: number;
  scopes: Record<string, DashboardThumbnailArchiveScopeIndex>;
}

export interface DashboardHotspot {
  id: string;
  kind: 'preset' | 'section' | 'panel';
  action?: DashboardTabId;
  line: number;
  lineEnd: number;
  colStart: number;
  colEnd: number;
  helpTitle?: string;
  helpBody?: string;
  helpCaveat?: string;
}

export interface DashboardRenderResult {
  text: string;
  hotspots: DashboardHotspot[];
  width: number;
  height: number;
}

export interface DashboardShareItem {
  label: string;
  count?: number;
  share: number;
  value?: number;
}

export interface DashboardHistogramBin {
  label: string;
  count: number;
}

export interface DatasetDashboardStats {
  videoCount: number;
  uniqueChannelCount: number;
  totalVideoComments: number;
  categoryCount: number;
  languageCount: number;
  uploadSpanDays: number;
  warnings: string[];
  coverage: {
    descriptionsPresentPct: number;
    tagsPresentPct: number;
    thumbnailsPresentPct: number;
    transcriptsPresentPct: number;
    captionsAvailablePct: number;
  };
  time: {
    oldestUpload: string | null;
    newestUpload: string | null;
    medianAgeDays: number | null;
    uploadBins: DashboardHistogramBin[];
    recencyBuckets?: DashboardHistogramBin[];
    ageBuckets?: DashboardHistogramBin[];
    uploadsPerDay?: number | null;
    uploadsPerYear?: number | null;
  };
  composition: {
    topCategories: DashboardShareItem[];
    topLanguages: DashboardShareItem[];
    topCategoriesByViews?: DashboardShareItem[];
    topLanguagesByViews?: DashboardShareItem[];
    keywordTokens?: DashboardShareItem[];
    longTailCategoryShare?: number | null;
  };
  attention: {
    medianViews: number | null;
    p75Views?: number | null;
    p90Views: number | null;
    top10ViewShare: number | null;
    medianViewsPerDay: number | null;
    top1ViewShare?: number | null;
    top5ViewShare?: number | null;
    top50ViewShare?: number | null;
    giniViews?: number | null;
    hhiViews?: number | null;
  };
  channelMix: {
    topChannelsByRows: DashboardShareItem[];
    topChannelsByViews: DashboardShareItem[];
    dominance: 'low' | 'moderate' | 'high';
    top5RowsShare?: number | null;
    top5ViewsShare?: number | null;
    hhiViews?: number | null;
  };
  comments: {
    totalVideoComments: number;
    medianCommentsPerVideo: number | null;
    top10CommentShare: number | null;
  };
  dataQuality: {
    transcriptCoveragePct: number;
    tagCoveragePct: number;
    captionAvailabilityPct: number;
    descriptionCoveragePct: number;
    commentsNote: string;
    viewsComparability: string;
  };
}

export interface DatasetDashboardSnapshot {
  scope: DashboardScope;
  stats: DatasetDashboardStats;
  template?: DashboardTemplateSnapshot;
  rowCount: number;
  calculatedAt: string;
  datasetVersionAtCalculation: number;
  filteredViewVersionAtCalculation?: number;
}

export interface SavedViewDashboardSnapshot {
  savedViewId: string;
  savedViewName: string;
  stats: DatasetDashboardStats;
  template?: DashboardTemplateSnapshot;
  rowCount: number;
  calculatedAt: string;
  datasetVersionAtCalculation: number;
  savedViewsVersionAtCalculation: number;
}

export interface WatchHistoryEntry {
  videoId: string;
  title: string;
  firstWatchedAt: string;
  lastWatchedAt: string;
  totalWatchSeconds: number;
  qualifyingSessionCount: number;
  playStartCount: number;
  durationSeconds?: number | null;
}

export type ResearchHistoryEventType =
  | 'import_replace_completed'
  | 'import_merge_completed'
  | 'special_mapping_updated'
  | 'saved_view_created'
  | 'saved_view_deleted'
  | 'tag_applied'
  | 'column_deleted'
  | 'column_restored'
  | 'columns_restored_all'
  | 'videos_excluded'
  | 'videos_restored'
  | 'dashboard_snapshots_recalculated'
  | 'source_visibility_toggled'
  | 'source_visibility_bulk_changed'
  | 'source_column_visibility_toggled'
  | 'linking_source_selected'
  | 'linking_summary_generated'
  | 'linking_summary_refreshed'
  | 'linking_bucket_override_created'
  | 'linking_bucket_override_changed'
  | 'linking_bucket_override_reverted'
  | 'channel_linking_refreshed';

export interface ResearchHistoryEvent {
  id: string;
  type: ResearchHistoryEventType;
  createdAt: string;
  summary: string;
  details?: string;
  affectedIds?: string[];
  meta?: Record<string, string | number | boolean | null | undefined>;
  reverted?: boolean;
}

export type ResearchLogSectionId =
  | 'overview'
  | 'diary'
  | 'corpusProcessing'
  | 'views'
  | 'watchHistory'
  | 'researchActions'
  | 'notesAppendix'
  | 'dashboard'
  | 'exportPreview';

export type ResearchLogCommentSectionId =
  | 'corpusProcessing'
  | 'views'
  | 'watchHistory'
  | 'researchActions'
  | 'notesAppendix'
  | 'dashboard'
  | 'exportPreview';

export interface ExcludedVideoMeta {
  videoId: string;
  reason?: string;
  excludedAt: string;
  restoredAt?: string | null;
  exclusionMode?: 'manual' | 'filtered_bulk';
  exclusionScope?: ViewScope;
  exclusionFilterSummary?: string;
}

export interface ChannelMetadataRow {
  channel_key: string;
  channel_name: string;
  channel_id: string | null;
  video_count_in_dataset: number;
  total_views_in_dataset: number;
  total_likes_in_dataset: number | null;
  total_comments_in_dataset: number | null;
  earliest_publish_date: string | null;
  latest_publish_date: string | null;
}

export interface ChannelMetadataSnapshot {
  rows: ChannelMetadataRow[];
  calculatedAt: string;
  datasetVersionAtCalculation: number;
  inclusionViewAtCalculation: InclusionView;
  filteredViewVersionAtCalculation?: number;
  videoCorpusFingerprintAtCalculation?: string;
  exclusionMembershipFingerprintAtCalculation?: string;
  cacheKeyAtCalculation?: string;
}

export interface ResearchLogMarkdownOptions {
  includeNotesAppendix: boolean;
  includeDashboardSection: boolean;
}

export interface AppState {
  fileName: string | null;
  schema: ColumnSchema[];
  isRightPanelCollapsed: boolean;
  selectedRow: any | null;
  savedViews: SavedView[];
  activeViewId: string | null;
  annotations: Record<string, Annotation>;
  projectOverview: string;
  projectNotes: string;
  researchLogSectionComments: Partial<Record<ResearchLogCommentSectionId, string>>;
  theme: ThemeMode;
}

export type MergeMode = 'add-update' | 'update-only' | 'add-only';
export type ConflictStrategy = 'keep-existing' | 'use-new' | 'review';
export type RowConflictChoice = 'existing' | 'new';

export interface DuplicateGroup {
  key: string;
  rowIndices: number[];
  rows: any[];
}

export interface MergePreview {
  matchedCount: number;
  unmatchedIncomingCount: number;
  newColumns: string[];
  matchedColumns: Array<{ existingColumn: string; incomingColumn: string }>;
  unmatchedIncomingColumns: string[];
  conflictColumns: Array<{ column: string; incomingColumn: string; count: number }>;
  duplicateGroupsExisting: DuplicateGroup[];
  duplicateGroupsIncoming: DuplicateGroup[];
}

export interface MergeOptions {
  mergeMode: MergeMode;
  columnMapping: Record<string, string>;
  conflictStrategies: Record<string, ConflictStrategy>;
  rowConflictDecisions: Record<string, Record<string, RowConflictChoice>>;
  unmatchedRowMode: 'all' | 'none' | 'custom';
  selectedUnmatchedKeys: string[];
  specialMappings?: Partial<SpecialMappings>;
  existingDuplicateSelections?: Record<string, number>;
  incomingDuplicateSelections?: Record<string, number>;
}

export interface ImportOptions {
  mode: 'replace' | 'merge';
  importKind?: ImportKind;
  channelMetadataRelationship?: ChannelMetadataRelationshipType;
  joinColumn: string;
  incomingJoinColumn?: string;
  selectedColumns: string[];
  specialMappings?: Partial<SpecialMappings>;
  dedupeSelections?: Record<string, number>;
  mergeOptions?: MergeOptions;
}

export interface ImportSubmission {
  options: ImportOptions;
  incomingRows: any[];
}

export type ExportFormat = 'csv' | 'markdown' | 'project';

export interface ExportOptions {
  format: ExportFormat;
  selectedColumns: string[];
  includeFilteredRows: boolean;
  includeNotesColumn: boolean;
  includeUserTagsColumn: boolean;
  markdownOptions?: ResearchLogMarkdownOptions;
  projectName?: string;
}

export interface ProjectArchiveManifest {
  version: number;
  projectName: string;
  originalFileName: string | null;
  exportedAt: string;
  schema: ColumnSchema[];
  sourceSchema?: ColumnSchema[];
  visibleColumns: string[];
  channelVisibleColumns?: string[];
  videoColumnWidths?: Record<string, number>;
  channelColumnWidths?: Record<string, number>;
  savedViews: SavedView[];
  activeViewId: string | null;
  annotations: Record<string, Annotation>;
  channelNotesById?: Record<string, string>;
  channelTagsById?: Record<string, string[]>;
  projectOverview?: string;
  projectNotes: string;
  researchLogSectionComments?: Partial<Record<ResearchLogCommentSectionId, string>>;
  researchHistory?: ResearchHistoryEvent[];
  watchHistoryByVideoId?: Record<string, WatchHistoryEntry>;
  transcriptColumn?: string;
  deletedColumns?: string[];
  specialMappings?: Partial<SpecialMappings>;
  excluded_videos?: string[];
  excludedVideoMetaById?: Record<string, ExcludedVideoMeta>;
  uiState?: {
    theme: ThemeMode;
    isRightPanelCollapsed: boolean;
  };
  dashboardSnapshots?: Partial<Record<DashboardScope, DatasetDashboardSnapshot>>;
  savedViewDashboardSnapshots?: Record<string, SavedViewDashboardSnapshot>;
  savedViewsVersion?: number;
  thumbnailCacheIndex?: DashboardThumbnailCacheIndex;
  channelMetadataSnapshot?: ChannelMetadataSnapshot | null;
  importedChannelMetadata?: ImportedChannelMetadataState | null;
  viewScope?: ViewScope;
  sourceRegistry?: SourceRegistryState;
  sourceVisibility?: SourceVisibilityState;
  rowLineage?: RowLineageState;
  columnLineage?: ColumnLineageState;
  generatedMetadata?: GeneratedMetadataState;
  linkingState?: LinkingState;
  channelLinkingState?: ChannelLinkingState;
}
