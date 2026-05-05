import { useState, useCallback, useEffect, useRef, useMemo, useReducer, useTransition } from 'react';
import { flushSync } from 'react-dom';
import { GridApi } from 'ag-grid-community';
import { motion, AnimatePresence } from 'motion/react';
import { useDuckDB } from './hooks/useDuckDB';
import {
  AppState,
  ChannelLinkingState,
  ColumnSchema,
  ColumnLineageState,
  SavedView,
  Annotation,
  IncludeExcludeAction,
  InclusionView,
  ExportOptions,
  ProjectArchiveManifest,
  ImportSubmission,
  SpecialMappings,
  DashboardScope,
  DashboardTemplateTab,
  DashboardThumbnailArchiveEntry,
  DashboardThumbnailCacheIndex,
  DashboardThumbnailCacheSnapshot,
  DashboardThumbnailLoadProgress,
  DashboardThumbnailSortRule,
  DatasetDashboardSnapshot,
  ExcludedVideoMeta,
  ChannelMetadataSnapshot,
  ChannelMetadataRelationshipType,
  ImportedChannelMetadataState,
  ResearchHistoryEvent,
  ResearchLogCommentSectionId,
  ResearchLogMarkdownOptions,
  SavedViewDashboardSnapshot,
  ViewScope,
  WatchHistoryEntry,
  SourceRegistryState,
  SourceVisibilityState,
  RowLineageState,
  GeneratedMetadataState,
  LinkingDomainOverride,
  LinkingState,
  LinkingGeneratedRowMetadata,
  LongTaskProgress,
  SourceKind,
} from './types';
import {
  EMPTY_EXPLORER_SELECTION,
  EMPTY_SCOPE_SELECTION,
  clearScopeSelectionAction,
  getScopeSelection,
  pruneScopeSelectionAction,
  selectionReducer,
  setScopeSelectionAction,
  type ScopeSelectionState,
  type ScopeSelectionUpdate,
} from './lib/selectionState';
import TopBar from './components/TopBar';
import MetadataGrid from './components/MetadataGrid';
import DetailPanel from './components/DetailPanel';
import ChannelSummaryPanel from './components/ChannelSummaryPanel';
import { ExportDialog, ColumnVisibilitySelector, ResearchLogDialog, ImportDialog, DatasetDashboardDialog, KeyboardShortcutsDialog, CommandPaletteDialog } from './components/Dialogs';
import {
  applyFriendlyColumnMappings,
  applyMerge,
  buildBatchCopyClipboardPayload,
  buildChannelMetadataRows,
  buildImportedChannelMetadataState,
  buildDisplayRows,
  buildDisplaySchema,
  buildResearchLogMarkdown,
  collectVideoIds,
  convertRowsToCsv,
  createProjectManifest,
  deleteColumnFromProject,
  deriveSchemaFromRows,
  partitionRowsByInclusion,
  detectSpecialMappings,
  downloadBlob,
  cleanupAutoSeededResearchDiary,
  detectImportKind,
  NOTES_COLUMN,
  formatDateDisplay,
  isDurationColumn,
  resolveTagFilterColumn,
  resolveChannelId,
  resolveChannelName,
  detectIncomingChannelIdColumn,
  detectIncomingChannelTitleColumn,
  resolveTranscript,
  resolveVideoTitle,
  resolveVideoId,
  sanitizeFileName,
  stripDeletedColumnsFromRows,
  stripDeletedColumnsFromSchema,
  mergeChannelMetadataRows,
  buildGeneratedMetadataSchema,
  overlayGeneratedMetadataRows,
  TRANSCRIPT_COLUMN,
  USER_TAGS_COLUMN,
  VIDEO_DESCRIPTION_COLUMN,
  type BatchCopyExportMode,
} from './lib/data';
import { createStoredZip, decodeTextFile, readStoredZip } from './lib/archive';
import { parseListString } from './components/CustomFilters';
import { BooleanMapSchema, buildUnifiedFilterState, detectBooleanMapColumns, detectListLikeColumns, ExplorerFilterModel, isTagLikeColumn } from './lib/filterCoordinator';
import { extractUserTagsFromAnnotations, mergeAnnotationsWithUserTags, stripTagsFromAnnotations, userTagsReducer } from './lib/userTags';
import { buildDatasetDashboardStats } from './lib/datasetDashboard';
import { buildDashboardTemplateSnapshot, inferIntentFromText } from './lib/dashboardTemplate';
import {
  aggregateChannelLinkingFromVideoRows,
  applyLinkingDomainOverride,
  buildChannelLinkingSnapshot,
  buildLinkingStageA,
  buildLinkingStageAAsync,
  buildLinkingStageB,
  buildLinkingStageBAsync,
  profileLinkingColumnCandidates,
  revertLinkingDomainOverride,
  type LinkingStageAResult,
} from './lib/linkingDashboard';
import {
  LAST_PROJECT_AUTOSAVE_VERSION,
  loadLastProjectAutosaveSnapshot,
  saveLastProjectAutosaveSnapshot,
  shouldAttemptLastProjectRestore,
} from './lib/projectAutosave';
import {
  THUMBNAIL_LIMIT,
  buildSavedViewThumbnailScopeKey,
  buildThumbnailSortSignature,
  inferFileExtensionFromMimeType,
  isPersistentThumbnailScopeKey,
  isSavedViewThumbnailScopeKey,
  resolveThumbnailCacheLabel,
  sanitizeThumbnailPathSegment,
  selectThumbnailCandidates,
} from './lib/dashboardThumbnails';
import { cn } from './lib/utils';

const STORAGE_KEY = 'tubedata_explorer_state';
const FILTERED_TEMP_THUMBNAIL_SCOPE = 'filtered-temp';
const THUMBNAIL_ZOOM_STEPS = [88, 104, 128, 156, 192, 240, 320, 440, 620, 860, 1120];
const GENERATED_SOURCE_ID = 'generated:metadata';
const LINKING_GENERATED_COLUMNS = [
  'linking_linked',
  'linking_url_count',
  'linking_domain_count',
  'linking_base_labels',
  'linking_recipe',
  'linking_top_domains',
  'linking_malformed_count',
  'linking_shortener_count',
  'linking_raw_links',
  'linking_raw_domains',
];
const LINKING_FILTER_COLUMNS = new Set<string>([
  ...LINKING_GENERATED_COLUMNS,
]);

function buildSourceId(prefix: string, label: string) {
  const slug = sanitizeFileName(label || 'source', 'source')
    .replace(/\.csv$/i, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${prefix}:${slug || 'source'}:${Date.now().toString(36)}`;
}

function createEmptySourceRegistry(): SourceRegistryState {
  return {
    byId: {},
    orderedIds: [],
    primarySourceId: null,
  };
}

function createEmptySourceVisibility(): SourceVisibilityState {
  return {
    hiddenSourceIds: [],
    hiddenColumnSourceIdsByScope: {
      videos: [],
      channels: [],
    },
  };
}

function createEmptyRowLineage(): RowLineageState {
  return { byRowId: {} };
}

function createEmptyColumnLineage(): ColumnLineageState {
  return { byColumn: {} };
}

function createEmptyGeneratedMetadata(): GeneratedMetadataState {
  return { byVideoId: {} };
}

function createEmptyLinkingState(): LinkingState {
  return {
    selectedSourceColumn: null,
    stale: false,
    staleReason: undefined,
    datasetFingerprint: undefined,
    sourceVisibilityFingerprint: undefined,
    overrideVersion: 0,
    sourceCandidateProfiles: [],
    parseCacheByKey: {},
    overridesByDomain: {},
    snapshot: null,
  };
}

function createEmptyChannelLinkingState(): ChannelLinkingState {
  return {
    stale: false,
    staleReason: undefined,
    snapshot: null,
  };
}

function resolveRowLineageKey(row: any, index: number) {
  return resolveVideoId(row) || `row:${index}`;
}

function resolveChannelRowKey(row: any) {
  return String(row?.channel_key || row?.channel_id || row?.channel_name || '').trim();
}

function getDefaultChannelVisibleColumns(columnNames: string[]) {
  const preferred = [
    'channel_name',
    'channel_id',
    'video_count_in_dataset',
    'total_views_in_dataset',
    'total_likes_in_dataset',
    'total_comments_in_dataset',
    'earliest_publish_date',
    'latest_publish_date',
    'channel_linked_video_count',
    'channel_unique_domains',
    'channel_top_domains',
    'channel_linking_recipe_mix',
    CHANNEL_USER_TAGS_COLUMN,
  ];
  const ordered = preferred.filter((column) => columnNames.includes(column));
  return ordered.length ? ordered : columnNames.slice(0, Math.min(8, columnNames.length));
}

function shouldHideRedundantChannelIdentityColumn(column: ColumnSchema, schema: ColumnSchema[]) {
  const columnName = column.column_name;
  const rawName = column.source_column_name || columnName;
  const displayName = (column.display_column_name || '').toLowerCase();
  const semanticType = column.semantic_type || '';
  const hasCanonicalChannelName = schema.some((entry) => entry.column_name === 'channel_name');
  const hasCanonicalChannelId = schema.some((entry) => entry.column_name === 'channel_id');

  if (columnName === 'channel_name' || columnName === 'channel_id') return false;

  if (hasCanonicalChannelName) {
    const isDuplicateChannelName = semanticType === 'channel-name'
      || displayName.startsWith('channel name')
      || ['channelTitle', 'channel_title'].includes(columnName)
      || (rawName === 'title' && displayName.startsWith('channel name'));
    if (isDuplicateChannelName) return true;
  }

  if (hasCanonicalChannelId) {
    const isDuplicateChannelId = semanticType === 'channel-id'
      || displayName.startsWith('channel id')
      || ['channelId', 'Channel_ID', 'channelID', 'id'].includes(columnName);
    if (isDuplicateChannelId) return true;
  }

  return false;
}

function getDefaultVideoVisibleColumns(schema: ColumnSchema[]) {
  return schema
    .filter((column) => !shouldHideRedundantChannelIdentityColumn(column, schema))
    .map((column) => column.column_name);
}

function joinUnique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildSourceVisibilityFingerprint(sourceVisibility: SourceVisibilityState) {
  const hiddenRows = [...(sourceVisibility.hiddenSourceIds || [])].sort().join('|');
  const hiddenVideoCols = [...(sourceVisibility.hiddenColumnSourceIdsByScope?.videos || [])].sort().join('|');
  const hiddenChannelCols = [...(sourceVisibility.hiddenColumnSourceIdsByScope?.channels || [])].sort().join('|');
  return `rows:${hiddenRows};videos:${hiddenVideoCols};channels:${hiddenChannelCols}`;
}

function buildDatasetFingerprint(args: {
  datasetVersion: number;
  inclusionView: InclusionView;
  rowCount: number;
  sourceVisibility: SourceVisibilityState;
}) {
  return [
    `v${args.datasetVersion}`,
    `inc:${args.inclusionView}`,
    `rows:${args.rowCount}`,
    buildSourceVisibilityFingerprint(args.sourceVisibility),
  ].join(';');
}

function resolveRecoverableInclusionView(args: {
  preferred: InclusionView;
  includedRowCount: number;
  excludedRowCount: number;
}): InclusionView {
  const { preferred, includedRowCount, excludedRowCount } = args;
  if (preferred === 'included' && includedRowCount === 0 && excludedRowCount > 0) return 'excluded';
  if (preferred === 'excluded' && excludedRowCount === 0 && includedRowCount > 0) return 'included';
  return preferred;
}

function computeSourceVisibilityInclusionCounts(args: {
  rows: any[];
  rowLineage: RowLineageState;
  sourceVisibility: SourceVisibilityState;
  excludedVideoIds: string[];
}) {
  const hiddenSourceIdSet = new Set(args.sourceVisibility.hiddenSourceIds || []);
  const sourceMaskedRows = hiddenSourceIdSet.size
    ? args.rows.filter((row, index) => {
        const rowId = resolveRowLineageKey(row, index);
        const lineage = args.rowLineage.byRowId[rowId];
        if (!lineage?.baseSourceId) return true;
        return !hiddenSourceIdSet.has(lineage.baseSourceId);
      })
    : args.rows;

  const partition = partitionRowsByInclusion(sourceMaskedRows, new Set(args.excludedVideoIds || []));
  return {
    includedRowCount: partition.included.length,
    excludedRowCount: partition.excluded.length,
  };
}

function flattenGeneratedMetadataForOverlay(entry: GeneratedMetadataState['byVideoId'][string] | undefined) {
  if (!entry) return null;
  const linking = entry.linking;
  return {
    content_intent: entry.content_intent || 'other',
    linking_linked: linking?.linking_linked || 'no',
    linking_url_count: linking?.linking_url_count ?? 0,
    linking_domain_count: linking?.linking_domain_count ?? 0,
    linking_base_labels: linking?.linking_base_labels ?? [],
    linking_recipe: linking?.linking_recipe || 'none',
    linking_top_domains: linking?.linking_top_domains ?? [],
    linking_malformed_count: linking?.linking_malformed_count ?? 0,
    linking_shortener_count: linking?.linking_shortener_count ?? 0,
    linking_raw_links: linking?.linking_raw_links ?? [],
    linking_raw_domains: linking?.linking_raw_domains ?? [],
  };
}

function normalizeJoinKey(value: unknown) {
  const text = String(value ?? '').trim();
  return text ? text.toLowerCase() : '';
}

function ensureGeneratedColumnLineage(lineage: ColumnLineageState): ColumnLineageState {
  const next = { ...lineage.byColumn };
  if (!next.content_intent) {
    next.content_intent = { column: 'content_intent', sourceId: GENERATED_SOURCE_ID, generated: true, scope: 'videos' };
  }
  LINKING_GENERATED_COLUMNS.forEach((column) => {
    if (!next[column]) {
      next[column] = { column, sourceId: GENERATED_SOURCE_ID, generated: true, scope: 'videos' };
    }
  });
  const channelColumns = [
    'channel_linked_video_count',
    'channel_total_urls',
    'channel_unique_domains',
    'channel_top_domains',
    'channel_linking_recipe_mix',
    'channel_base_share_cross_platform',
    'channel_base_share_intra_platform',
    'channel_base_share_marketplace',
    'channel_base_share_crowdfunding',
    'channel_base_share_routing',
    'channel_base_share_other',
  ];
  channelColumns.forEach((column) => {
    if (!next[column]) {
      next[column] = { column, sourceId: GENERATED_SOURCE_ID, generated: true, scope: 'channels' };
    }
  });
  return { byColumn: next };
}

function withSourceRegistryCounts(args: {
  sourceRegistry: SourceRegistryState;
  rowLineage: RowLineageState;
  defaultRowCount?: number;
}) {
  const counts = new Map<string, number>();
  Object.values(args.rowLineage.byRowId).forEach((entry) => {
    if (!entry.baseSourceId) return;
    counts.set(entry.baseSourceId, (counts.get(entry.baseSourceId) || 0) + 1);
  });
  const byId: SourceRegistryState['byId'] = {};
  Object.entries(args.sourceRegistry.byId).forEach(([sourceId, source]) => {
    byId[sourceId] = {
      ...source,
      rowCount: counts.has(sourceId)
        ? (counts.get(sourceId) || 0)
        : (source.kind === 'base' ? (args.defaultRowCount ?? source.rowCount) : source.rowCount),
    };
  });
  return {
    ...args.sourceRegistry,
    byId,
  };
}

function buildDefaultProjectSourceState(args: {
  rows: any[];
  schema: Array<{ column_name: string }>;
  fileName: string | null;
}) {
  const now = new Date().toISOString();
  const baseSourceId = buildSourceId('source/base', args.fileName || 'dataset');
  const sourceRegistry: SourceRegistryState = {
    byId: {
      [baseSourceId]: {
        id: baseSourceId,
        label: args.fileName || 'dataset.csv',
        kind: 'base',
        rowCount: args.rows.length,
        contributedColumns: args.schema.map((column) => column.column_name),
        createdAt: now,
      },
      [GENERATED_SOURCE_ID]: {
        id: GENERATED_SOURCE_ID,
        label: 'Generated metadata',
        kind: 'generated',
        rowCount: 0,
        contributedColumns: ['content_intent', ...LINKING_GENERATED_COLUMNS],
        createdAt: now,
      },
    },
    orderedIds: [baseSourceId, GENERATED_SOURCE_ID],
    primarySourceId: baseSourceId,
  };
  const rowLineage: RowLineageState = {
    byRowId: Object.fromEntries(
      args.rows.map((row, index) => {
        const rowId = resolveRowLineageKey(row, index);
        return [rowId, { rowId, baseSourceId, contributorSourceIds: [baseSourceId] }];
      }),
    ),
  };
  const columnLineage: ColumnLineageState = ensureGeneratedColumnLineage({
    byColumn: Object.fromEntries(
      args.schema.map((column) => ([
        column.column_name,
        {
          column: column.column_name,
          sourceId: baseSourceId,
          generated: false,
          scope: 'videos',
        },
      ])),
    ),
  });
  return {
    sourceRegistry,
    sourceVisibility: createEmptySourceVisibility(),
    rowLineage,
    columnLineage,
  };
}

function reconcileSourceVisibility(sourceVisibility: SourceVisibilityState, sourceRegistry: SourceRegistryState): SourceVisibilityState {
  const validIds = new Set(sourceRegistry.orderedIds);
  return {
    hiddenSourceIds: (sourceVisibility.hiddenSourceIds || []).filter((id) => validIds.has(id)),
    hiddenColumnSourceIdsByScope: {
      videos: (sourceVisibility.hiddenColumnSourceIdsByScope?.videos || []).filter((id) => validIds.has(id)),
      channels: (sourceVisibility.hiddenColumnSourceIdsByScope?.channels || []).filter((id) => validIds.has(id)),
    },
  };
}

function createObjectUrl(bytes: Uint8Array, mimeType = 'image/jpeg') {
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

function hashFingerprint(seed: number, value: string) {
  let next = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, 16777619) >>> 0;
  }
  return next >>> 0;
}

function buildStableFingerprint(values: string[]) {
  let hash = 2166136261;
  values.forEach((value) => {
    hash = hashFingerprint(hash, value);
    hash = hashFingerprint(hash, '\n');
  });
  return `${values.length}:${(hash >>> 0).toString(36)}`;
}

function buildVideoCorpusFingerprint(rows: any[], schema: Array<{ column_name: string }>) {
  const rowKeys = rows.map((row) => {
    const videoId = resolveVideoId(row) || '';
    const channelId = resolveChannelId(row) || '';
    const views = row?.viewCount ?? row?.view_count ?? row?.views ?? row?.Views ?? '';
    const likes = row?.likeCount ?? row?.like_count ?? row?.likes ?? row?.Likes ?? '';
    const comments = row?.commentCount ?? row?.comment_count ?? row?.comments ?? row?.Comments ?? '';
    const publishedAt = row?.publishedAt ?? row?.published_at ?? row?.publishDate ?? row?.publish_date ?? row?.upload_date ?? row?.date ?? '';
    return `${videoId}|${channelId}|${views}|${likes}|${comments}|${publishedAt}`;
  });
  const schemaKey = schema.map((column) => column.column_name).join('|');
  return `rows:${rows.length};schema:${schema.length}:${buildStableFingerprint([schemaKey, ...rowKeys])}`;
}

function buildExcludedMembershipFingerprint(videoIds: string[]) {
  const uniqueSorted = Array.from(new Set(videoIds.filter(Boolean))).sort();
  return `excluded:${uniqueSorted.length}:${buildStableFingerprint(uniqueSorted)}`;
}

function buildChannelMetadataCacheKey(args: {
  videoCorpusFingerprint: string;
  exclusionMembershipFingerprint: string;
  inclusionView: InclusionView;
}) {
  return [
    args.videoCorpusFingerprint,
    args.exclusionMembershipFingerprint,
    `inc:${args.inclusionView}`,
  ].join(';');
}

function buildThumbnailEntriesFromCacheSeed(args: {
  candidates: Array<{
    videoId: string;
    dedupeKey: string;
    title: string;
    rank: number;
    sourceUrl: string;
    candidateUrls?: string[];
  }>;
  seedSnapshot?: DashboardThumbnailCacheSnapshot;
}): DashboardThumbnailCacheSnapshot['entries'] {
  const seedByDedupe = new Map<string, DashboardThumbnailCacheSnapshot['entries'][number]>();
  (args.seedSnapshot?.entries || []).forEach((entry) => {
    if (!entry?.dedupeKey) return;
    if (!seedByDedupe.has(entry.dedupeKey)) seedByDedupe.set(entry.dedupeKey, entry);
  });
  return args.candidates.map((candidate) => {
    const candidateUrls = Array.from(new Set(
      (candidate.candidateUrls || [])
        .map((url) => String(url || '').trim())
        .filter(Boolean),
    ));
    const initialUrl = candidateUrls[0] || candidate.sourceUrl || '';
    const initialCandidateIndex = initialUrl ? 0 : -1;
    const initialStatus: DashboardThumbnailCacheSnapshot['entries'][number]['status'] = initialUrl ? 'pending' : 'failed';
    const baseEntry = {
      videoId: candidate.videoId,
      dedupeKey: candidate.dedupeKey,
      title: candidate.title,
      rank: candidate.rank,
      sourceUrl: initialUrl,
      candidateUrls,
      activeUrl: initialUrl,
      fallbackIndex: 0,
      activeCandidateIndex: initialCandidateIndex,
      status: initialStatus,
      error: initialUrl ? undefined : 'No valid thumbnail URL',
    };
    const seededEntry = seedByDedupe.get(candidate.dedupeKey);
    if (!seededEntry) return baseEntry;
    const seededActiveUrl = String(seededEntry.activeUrl || seededEntry.sourceUrl || '').trim();
    const seededActiveIndexFromUrl = seededActiveUrl ? candidateUrls.findIndex((url) => url === seededActiveUrl) : -1;
    const seededFallbackIndex = seededEntry.fallbackIndex ?? (seededActiveIndexFromUrl >= 0 ? seededActiveIndexFromUrl : 0);
    const seededIndex = Number.isFinite(seededEntry.activeCandidateIndex)
      ? Number(seededEntry.activeCandidateIndex)
      : Number(seededFallbackIndex);
    const normalizedSeededIndex = Number.isFinite(seededIndex)
      ? Math.max(0, Math.min(Math.floor(seededIndex), Math.max(candidateUrls.length - 1, 0)))
      : 0;
    if (seededEntry.status === 'loaded' && seededEntry.bytes?.length) {
      const mimeType = seededEntry.mimeType || 'image/jpeg';
      const bytes = new Uint8Array(seededEntry.bytes);
      const seededUrl = seededActiveUrl || candidateUrls[normalizedSeededIndex] || initialUrl;
      return {
        ...baseEntry,
        status: 'loaded' as const,
        sourceUrl: seededUrl || baseEntry.sourceUrl,
        activeUrl: seededUrl || baseEntry.activeUrl,
        fallbackIndex: normalizedSeededIndex,
        activeCandidateIndex: normalizedSeededIndex,
        mimeType,
        byteLength: seededEntry.byteLength ?? bytes.length,
        bytes,
        objectUrl: createObjectUrl(bytes, mimeType),
      };
    }
    if (seededEntry.status === 'loaded' && seededActiveUrl) {
      return {
        ...baseEntry,
        status: 'loaded' as const,
        sourceUrl: seededActiveUrl,
        activeUrl: seededActiveUrl,
        fallbackIndex: normalizedSeededIndex,
        activeCandidateIndex: normalizedSeededIndex,
      };
    }
    if (seededEntry.status === 'failed' && candidateUrls.length > 0) {
      return {
        ...baseEntry,
        status: 'failed' as const,
        activeUrl: '',
        fallbackIndex: Math.max(0, candidateUrls.length - 1),
        activeCandidateIndex: Math.max(0, candidateUrls.length - 1),
        error: seededEntry.error || 'Failed to load thumbnail',
      };
    }
    return baseEntry;
  });
}

function summarizeThumbnailProgress(entries: DashboardThumbnailCacheSnapshot['entries']) {
  const total = entries.length;
  const failed = entries.filter((entry) => entry.status === 'failed').length;
  const completed = entries.filter((entry) => entry.status !== 'pending').length;
  return {
    total,
    completed,
    failed,
    loading: completed < total,
  };
}

function revokeThumbnailUrls(snapshot?: DashboardThumbnailCacheSnapshot) {
  if (!snapshot) return;
  snapshot.entries.forEach((entry) => {
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  });
}

function revokeDroppedThumbnailUrls(previous?: DashboardThumbnailCacheSnapshot, next?: DashboardThumbnailCacheSnapshot) {
  if (!previous) return;
  const nextUrls = new Set((next?.entries || []).map((entry) => entry.objectUrl).filter((value): value is string => Boolean(value)));
  previous.entries.forEach((entry) => {
    if (entry.objectUrl && !nextUrls.has(entry.objectUrl)) {
      URL.revokeObjectURL(entry.objectUrl);
    }
  });
}

function getArchiveEntry(files: Record<string, Uint8Array>, targetName: string) {
  return files[targetName] || Object.entries(files).find(([name]) => name === targetName || name.endsWith(`/${targetName}`))?.[1];
}

function stripNotesFromAnnotations(annotations: Record<string, Annotation>) {
  return Object.fromEntries(
    Object.entries(annotations).map(([videoId, annotation]) => {
      const { notes, ...rest } = annotation;
      return [videoId, rest];
    }),
  ) as Record<string, Annotation>;
}

function buildLegacyNotesFromAnnotations(annotations: Record<string, Annotation>) {
  const notesByVideoId: Record<string, string> = {};
  Object.entries(annotations).forEach(([videoId, annotation]) => {
    const notes = annotation?.notes;
    if (typeof notes === 'string' && notes.trim().length > 0) {
      notesByVideoId[videoId] = notes;
    }
  });
  return notesByVideoId;
}

function buildNoteArchiveFiles(notesByVideoId: Record<string, string>, folder: string) {
  return Object.entries(notesByVideoId)
    .filter(([, notes]) => notes.trim().length > 0)
    .map(([videoId, notes]) => ({
      name: `${folder}/video_notes/${videoId}.txt`,
      data: notes,
    }));
}

function extractNotesFromArchive(files: Record<string, Uint8Array>) {
  const notes: Record<string, string> = {};
  Object.entries(files).forEach(([name, data]) => {
    const match = name.match(/(?:^|\/)video_notes\/([^/]+)\.txt$/i);
    if (!match) return;
    notes[match[1]] = decodeTextFile(data);
  });
  return notes;
}

function extractAnnotationsFromRows(rows: any[], seed: Record<string, Annotation> = {}) {
  const nextAnnotations: Record<string, Annotation> = { ...seed };

  rows.forEach((row) => {
    const videoId = resolveVideoId(row);
    if (!videoId) return;

    const tags = row[USER_TAGS_COLUMN] || row.User_Tags;

    if (tags) {
      nextAnnotations[videoId] = {
        ...nextAnnotations[videoId],
        tags: parseListString(tags),
        transcriptOverride: nextAnnotations[videoId]?.transcriptOverride,
        quoteRefs: nextAnnotations[videoId]?.quoteRefs || [],
        timestampRefs: nextAnnotations[videoId]?.timestampRefs || [],
      };
    }
  });

  return nextAnnotations;
}

function applySupportMappings(
  rows: any[],
  mappings: Partial<SpecialMappings> = {},
  options: {
    previousMappings?: Partial<SpecialMappings>;
    sourceSchemaColumns?: Set<string>;
  } = {},
) {
  const previousMappings = options.previousMappings || {};
  const sourceSchemaColumns = options.sourceSchemaColumns;
  return rows.map((row) => {
    const next = { ...row };
    if (mappings.transcriptColumn && mappings.transcriptColumn in row) {
      next[TRANSCRIPT_COLUMN] = row[mappings.transcriptColumn];
    } else if (
      previousMappings.transcriptColumn
      && previousMappings.transcriptColumn !== TRANSCRIPT_COLUMN
      && !sourceSchemaColumns?.has(TRANSCRIPT_COLUMN)
    ) {
      delete next[TRANSCRIPT_COLUMN];
    }
    if (mappings.descriptionColumn && mappings.descriptionColumn in row) {
      next[VIDEO_DESCRIPTION_COLUMN] = row[mappings.descriptionColumn];
    } else if (
      previousMappings.descriptionColumn
      && previousMappings.descriptionColumn !== VIDEO_DESCRIPTION_COLUMN
      && !sourceSchemaColumns?.has(VIDEO_DESCRIPTION_COLUMN)
    ) {
      delete next[VIDEO_DESCRIPTION_COLUMN];
    }
    if (mappings.tagColumn && mappings.tagColumn in row) {
      next.videoTags = parseListString(row[mappings.tagColumn]);
    } else if (
      previousMappings.tagColumn
      && previousMappings.tagColumn !== 'videoTags'
      && !sourceSchemaColumns?.has('videoTags')
    ) {
      delete next.videoTags;
    }
    return next;
  });
}

function isEditableShortcutTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return !!element.closest([
    'input',
    'textarea',
    'select',
    '[contenteditable]',
    '.ag-popup',
    '.ag-popup-editor',
    '.ag-cell-inline-editing',
    '.ag-rich-select',
    '.ag-large-text',
    '.ag-menu',
    '.ag-input-field-input',
    '.ag-text-field-input',
    '[data-markdown-editor]',
  ].join(','));
}

function isGridShortcutTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return Boolean(element.closest('[data-metadata-grid-root="true"]'));
}

function hasShortcutModifier(event: KeyboardEvent) {
  return event.ctrlKey || event.metaKey;
}

function matchesAltShiftShortcut(event: KeyboardEvent, key: string) {
  return !hasShortcutModifier(event) && event.altKey && event.shiftKey && event.code === `Key${key.toUpperCase()}`;
}

function matchesStandardShortcut(event: KeyboardEvent, key: string) {
  return hasShortcutModifier(event) && !event.shiftKey && !event.altKey && event.code === `Key${key.toUpperCase()}`;
}

function matchesStandardShiftShortcut(event: KeyboardEvent, key: string) {
  return hasShortcutModifier(event) && event.shiftKey && !event.altKey && event.code === `Key${key.toUpperCase()}`;
}

function normalizeVideoIds(videoIds: string[], validIds: Set<string>) {
  return Array.from(new Set(videoIds.filter((videoId) => validIds.has(videoId))));
}

async function copyTextToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard is not available in this environment.');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('Fallback clipboard copy failed.');
  }
}

function buildScopeSelectionFromKeys(keys: string[], detailKey?: string | null): ScopeSelectionState {
  const selectedKeys = Array.from(new Set((keys || []).map((key) => String(key || '').trim()).filter(Boolean)));
  if (!selectedKeys.length) {
    return {
      ...EMPTY_SCOPE_SELECTION,
      detailKey: detailKey ?? null,
    };
  }
  const resolvedDetail = detailKey && selectedKeys.includes(detailKey)
    ? detailKey
    : selectedKeys[selectedKeys.length - 1];
  return {
    selectedKeys,
    anchorKey: selectedKeys[0],
    focusKey: selectedKeys[selectedKeys.length - 1],
    detailKey: resolvedDetail,
  };
}

type IncludeExcludeUndoEntry = IncludeExcludeAction & { historyEventId?: string };

type AppNavigationEntry = {
  viewScope: ViewScope;
  inclusionView: InclusionView;
  activeViewId: string | null;
  filterModel: ExplorerFilterModel;
  channelFilterModel: ExplorerFilterModel;
  selectedVideoId: string | null;
  channelId: string | null;
  channelName: string | null;
  videoScopeChannelKeys: string[] | null;
  isChannelDrilldownFilterActive: boolean;
  drilldownPreviousVideoFilter: ExplorerFilterModel | null;
};

function createHistoryId(prefix = 'event') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function formatDurationLabel(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${remainder}s`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

function summarizeFilterModel(filterModel: ExplorerFilterModel) {
  const entries = Object.entries(filterModel || {});
  if (!entries.length) return 'No active filters';
  return entries.map(([column, model]) => {
    const anyModel = model as any;
    if (anyModel?.selections && typeof anyModel.selections === 'object') {
      const parts = Object.entries(anyModel.selections).map(([key, state]) => `${key}:${state === 'true' ? 'yes' : 'no'}`).slice(0, 4);
      const total = Object.keys(anyModel.selections).length;
      const suffix = total > 4 ? ` (+${total - 4} more)` : '';
      return `${column}: ${parts.join(', ')}${suffix}`;
    }
    if (Array.isArray(anyModel?.values)) {
      const values = anyModel.values.map((value: any) => String(value)).slice(0, 4);
      const suffix = anyModel.values.length > 4 ? ` (+${anyModel.values.length - 4} more)` : '';
      return `${column}: [${values.join(', ')}]${suffix}`;
    }
    const operator = anyModel?.operator || anyModel?.type || 'contains';
    const value = anyModel?.value ?? anyModel?.filter ?? '';
    return `${column}: ${operator} ${String(value)}`;
  }).join(' | ');
}

function formatVideoTitleChannelLabel(row: any) {
  const title = resolveVideoTitle(row).trim() || 'Untitled video';
  const channel = resolveChannelName(row).trim() || 'Unknown channel';
  return `${title} — ${channel}`;
}

function buildAlphabetizedVideoTitleChannelList(rows: any[]) {
  const byVideoId = new Map<string, string>();
  rows.forEach((row) => {
    const videoId = resolveVideoId(row);
    if (!videoId || byVideoId.has(videoId)) return;
    byVideoId.set(videoId, formatVideoTitleChannelLabel(row));
  });
  return Array.from(byVideoId.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}


function describeFilterModelEntry(column: string, model: any) {
  if (model?.selections && typeof model.selections === 'object') {
    const parts = Object.entries(model.selections).map(([key, state]) => `${key}: ${state === 'true' ? 'Yes' : 'No'}`).slice(0, 4);
    const total = Object.keys(model.selections).length;
    const suffix = total > 4 ? ` (+${total - 4} more)` : '';
    return `${parts.join(', ')}${suffix}`;
  }
  if (Array.isArray(model?.values)) {
    const values = model.values.map((value: any) => String(value)).slice(0, 4);
    const suffix = model.values.length > 4 ? ` (+${model.values.length - 4} more)` : '';
    return `${values.join(', ')}${suffix}`;
  }
  const operator = model?.operator || model?.type || 'contains';
  const value = model?.value ?? model?.filter ?? '';
  return `${operator} ${String(value)}`.trim();
}

function resolveEditViewFilterKind(columnName: string, columnType: string, listLikeColumns: Set<string>, booleanMapColumns: Record<string, BooleanMapSchema> = {}) {
  if (booleanMapColumns[columnName]) return 'booleanMap' as const;
  if (isTagLikeColumn(columnName, columnType, listLikeColumns)) return 'tag' as const;
  if (isDurationColumn(columnName)) return 'duration' as const;
  const type = columnType.toLowerCase();
  const isNumeric = type.includes('int') || type.includes('double') || type.includes('float') || type.includes('decimal') || type.includes('numeric');
  return isNumeric ? 'number' as const : 'text' as const;
}

function summarizeDashboardSnapshot(snapshot: DatasetDashboardSnapshot | SavedViewDashboardSnapshot | undefined) {
  if (!snapshot) return 'No entries recorded';
  const views = snapshot.stats.attention.medianViews ?? 0;
  const comments = snapshot.stats.comments.totalVideoComments ?? 0;
  const warnings = snapshot.stats.warnings.slice(0, 2);
  return [
    `Median views: ${Math.round(views).toLocaleString()}`,
    `Comments: ${Math.round(comments).toLocaleString()}`,
    warnings.length ? `Warnings: ${warnings.join(', ')}` : 'Warnings: none',
  ].join('\n');
}

function parseDateLabel(timestamp: string | number | null | undefined) {
  if (!timestamp) return 'n/a';
  return formatDateDisplay(new Date(timestamp).toISOString());
}

function buildTagUsageSummary(userTagsByVideoId: Record<string, string[]>) {
  const counts = new Map<string, number>();
  Object.values(userTagsByVideoId).forEach((tags) => {
    const unique = new Set(tags || []);
    unique.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12);
}

function appendNotesBlock(existingNotes: string | null | undefined, nextBlock: string | null | undefined) {
  const incoming = String(nextBlock ?? '').trim();
  const current = String(existingNotes ?? '').trimEnd();
  if (!incoming) return current;
  return current ? `${current}\n\n${incoming}` : incoming;
}

const CHANNEL_USER_TAGS_COLUMN = 'channel_user_tags';

const CHANNEL_BASE_SCHEMA = [
  { column_name: 'channel_name', column_type: 'VARCHAR' },
  { column_name: 'channel_id', column_type: 'VARCHAR' },
  { column_name: CHANNEL_USER_TAGS_COLUMN, column_type: 'VARCHAR[]' },
  { column_name: 'video_count_in_dataset', column_type: 'BIGINT' },
  { column_name: 'total_views_in_dataset', column_type: 'BIGINT' },
  { column_name: 'total_likes_in_dataset', column_type: 'BIGINT' },
  { column_name: 'total_comments_in_dataset', column_type: 'BIGINT' },
  { column_name: 'earliest_publish_date', column_type: 'TIMESTAMP' },
  { column_name: 'latest_publish_date', column_type: 'TIMESTAMP' },
];

function findVideoChannelColumn(schema: { column_name: string }[]) {
  const preferred = ['channel_name', 'channelTitle', 'channel', 'ChannelTitle'];
  for (const candidate of preferred) {
    if (schema.some((column) => column.column_name === candidate)) return candidate;
  }
  const fallback = schema.find((column) => column.column_name.toLowerCase().includes('channel'));
  return fallback?.column_name ?? null;
}

function findVideoChannelIdColumn(schema: { column_name: string }[]) {
  const preferred = ['channelId', 'channel_id', 'Channel_ID', 'channelID'];
  for (const candidate of preferred) {
    if (schema.some((column) => column.column_name === candidate)) return candidate;
  }
  const fallback = schema.find((column) => {
    const normalized = column.column_name.toLowerCase();
    return normalized.includes('channel') && normalized.includes('id');
  });
  return fallback?.column_name ?? null;
}

function findDashboardCategoryColumn(schema: { column_name: string }[]) {
  const preferred = ['video_category', 'video_category_label', 'category', 'categories'];
  for (const candidate of preferred) {
    const match = schema.find((column) => column.column_name.toLowerCase() == candidate.toLowerCase());
    if (match) return match.column_name;
  }
  const fallback = schema.find((column) => {
    const normalized = column.column_name.toLowerCase();
    return normalized.includes('category') && !normalized.includes('topic');
  });
  return fallback?.column_name ?? null;
}

function findDashboardTopicColumn(schema: { column_name: string }[]) {
  const preferred = ['topic_categories', 'topics', 'topic', 'topicCategories'];
  for (const candidate of preferred) {
    const match = schema.find((column) => column.column_name.toLowerCase() == candidate.toLowerCase());
    if (match) return match.column_name;
  }
  const fallback = schema.find((column) => column.column_name.toLowerCase().includes('topic'));
  return fallback?.column_name ?? null;
}

function findDashboardDurationColumn(schema: { column_name: string }[]) {
  const preferred = ['duration', 'duration_seconds', 'length', 'runtime'];
  for (const candidate of preferred) {
    const match = schema.find((column) => column.column_name.toLowerCase() === candidate.toLowerCase());
    if (match) return match.column_name;
  }
  const fallback = schema.find((column) => isDurationColumn(column.column_name));
  return fallback?.column_name ?? null;
}

function findDashboardIntentColumn(schema: { column_name: string }[]) {
  const preferred = ['content_intent', 'intent'];
  for (const candidate of preferred) {
    const match = schema.find((column) => column.column_name.toLowerCase() === candidate.toLowerCase());
    if (match) return match.column_name;
  }
  const fallback = schema.find((column) => column.column_name.toLowerCase().includes('intent'));
  return fallback?.column_name ?? null;
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    if (typeof window === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function readFileBufferWithProgress(file: File, onProgress?: (completed: number, total: number) => void) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}.`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was cancelled.`));
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    reader.onload = () => {
      const result = reader.result;
      if (!(result instanceof ArrayBuffer)) {
        reject(new Error(`Failed to read ${file.name}.`));
        return;
      }
      onProgress?.(file.size || result.byteLength, file.size || result.byteLength || 1);
      resolve(result);
    };
    reader.readAsArrayBuffer(file);
  });
}

function LongTaskOverlay({ progress }: { progress: LongTaskProgress | null }) {
  if (!progress) return null;
  const total = Math.max(progress.total, 1);
  const completed = Math.min(Math.max(progress.completed, 0), total);
  const ratio = completed / total;
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));

  return (
    <div className="pointer-events-none fixed inset-0 z-[140] flex items-center justify-center bg-black/18 px-4">
      <div className="pointer-events-auto w-full max-w-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-5 shadow-2xl">
        <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--text-muted)]">Working</div>
        <div className="mt-2 text-lg font-semibold text-[var(--text-main)]">{progress.title}</div>
        {progress.detail ? <div className="mt-1 text-sm text-[var(--text-muted)]">{progress.detail}</div> : null}
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--bg-primary)]">
          <div
            className={cn('h-full rounded-full bg-[var(--accent)] transition-all duration-200', progress.indeterminate && 'animate-pulse')}
            style={{ width: `${Math.max(ratio * 100, completed > 0 ? 6 : 2)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span>{completed.toLocaleString()} / {total.toLocaleString()} steps</span>
          <span>{percent}%</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { isReady, isIngesting, error: dbError, readCSVBuffer } = useDuckDB();
  const persisted = useMemo(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const initial = saved ? JSON.parse(saved) : {};
    return {
      ...initial,
      annotations: stripTagsFromAnnotations(stripNotesFromAnnotations(initial.annotations ?? {})),
      userTagsByVideoId: initial.userTagsByVideoId ?? extractUserTagsFromAnnotations(initial.annotations ?? {}),
      notesByVideoId: initial.notesByVideoId ?? buildLegacyNotesFromAnnotations(initial.annotations ?? {}),
      channelNotesById: initial.channelNotesById ?? {},
      channelTagsById: initial.channelTagsById ?? {},
      projectOverview: initial.projectOverview ?? '',
      projectNotes: cleanupAutoSeededResearchDiary(initial.projectNotes ?? ''),
      researchLogSectionComments: initial.researchLogSectionComments ?? {},
      researchHistory: initial.researchHistory ?? [],
      watchHistoryByVideoId: initial.watchHistoryByVideoId ?? {},
      savedViewDashboardSnapshots: initial.savedViewDashboardSnapshots ?? {},
      savedViewsVersion: initial.savedViewsVersion ?? 0,
      excludedVideoMetaById: initial.excludedVideoMetaById ?? {},
      channelMetadataSnapshot: initial.channelMetadataSnapshot ?? null,
      importedChannelMetadata: initial.importedChannelMetadata ?? null,
      viewScope: initial.viewScope === 'channels' ? 'channels' : 'videos',
      channelFilterModel: initial.channelFilterModel ?? {},
      videoColumnWidths: initial.videoColumnWidths ?? {},
      channelColumnWidths: initial.channelColumnWidths ?? {},
      sourceRegistry: initial.sourceRegistry ?? createEmptySourceRegistry(),
      sourceVisibility: initial.sourceVisibility ?? createEmptySourceVisibility(),
      rowLineage: initial.rowLineage ?? createEmptyRowLineage(),
      columnLineage: initial.columnLineage ?? createEmptyColumnLineage(),
      generatedMetadata: initial.generatedMetadata ?? createEmptyGeneratedMetadata(),
      linkingState: initial.linkingState ?? createEmptyLinkingState(),
      channelLinkingState: initial.channelLinkingState ?? createEmptyChannelLinkingState(),
      researchLogMarkdownOptions: initial.researchLogMarkdownOptions ?? {
        includeNotesAppendix: true,
        includeDashboardSection: true,
      },
    };
  }, []);
  const [state, setState] = useState<AppState>(() => ({
    fileName: null,
    schema: [],
    isRightPanelCollapsed: persisted.isRightPanelCollapsed ?? true,
    savedViews: persisted.savedViews ?? [],
    activeViewId: persisted.activeViewId ?? null,
    annotations: persisted.annotations ?? {},
    projectOverview: persisted.projectOverview ?? '',
    projectNotes: cleanupAutoSeededResearchDiary(persisted.projectNotes ?? ''),
    researchLogSectionComments: persisted.researchLogSectionComments ?? {},
    theme: persisted.theme === 'dark' ? 'dark' : 'warm-light',
  }));
  const [sourceRows, setSourceRows] = useState<any[]>([]);
  const [sourceSchema, setSourceSchema] = useState<any[]>([]);
  const [notesByVideoId, setNotesByVideoId] = useState<Record<string, string>>(persisted.notesByVideoId ?? {});
  const [channelNotesById, setChannelNotesById] = useState<Record<string, string>>(persisted.channelNotesById ?? {});
  const [channelTagsById, setChannelTagsById] = useState<Record<string, string[]>>(persisted.channelTagsById ?? {});
  const [userTagsByVideoId, dispatchUserTags] = useReducer(userTagsReducer, persisted.userTagsByVideoId ?? {});
  const [deletedColumns, setDeletedColumns] = useState<string[]>(() => {
    return persisted.deletedColumns ?? [];
  });
  const [specialMappings, setSpecialMappings] = useState<Partial<SpecialMappings>>(() => {
    return persisted.specialMappings ?? {};
  });
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [, startFilterTransition] = useTransition();
  const [isTagWritePending, startTagWriteTransition] = useTransition();
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const [isResearchLogOpen, setIsResearchLogOpen] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [isAppFullscreen, setIsAppFullscreen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [dashboardScope, setDashboardScope] = useState<DashboardScope>('full');
  const [dashboardActiveTab, setDashboardActiveTab] = useState<DashboardTemplateTab>('overview');
  const [dashboardSnapshots, setDashboardSnapshots] = useState<Partial<Record<DashboardScope, DatasetDashboardSnapshot>>>(() => {
    return persisted.dashboardSnapshots ?? {};
  });
  const [savedViewDashboardSnapshots, setSavedViewDashboardSnapshots] = useState<Record<string, SavedViewDashboardSnapshot>>(() => {
    return persisted.savedViewDashboardSnapshots ?? {};
  });
  const [videoSortRules, setVideoSortRules] = useState<DashboardThumbnailSortRule[]>([]);
  const [thumbnailCaches, setThumbnailCaches] = useState<Record<string, DashboardThumbnailCacheSnapshot>>({});
  const [thumbnailLoadProgress, setThumbnailLoadProgress] = useState<DashboardThumbnailLoadProgress | null>(null);
  const [thumbnailZoomIndex, setThumbnailZoomIndex] = useState(2);
  const [inclusionView, setInclusionView] = useState<InclusionView>(() => persisted.inclusionView === 'excluded' ? 'excluded' : 'included');
  const [excludedVideoIds, setExcludedVideoIds] = useState<string[]>(() => persisted.excludedVideoIds ?? []);
  const [excludedVideoMetaById, setExcludedVideoMetaById] = useState<Record<string, ExcludedVideoMeta>>(() => persisted.excludedVideoMetaById ?? {});
  const [selectionState, dispatchSelection] = useReducer(selectionReducer, EMPTY_EXPLORER_SELECTION, () => {
    const legacySelectedRow = (persisted as any)?.selectedRow;
    const legacyVideoId = String((persisted as any)?.selectedVideoId || resolveVideoId(legacySelectedRow) || '').trim();
    const legacyChannelKey = String(
      (persisted as any)?.selectedChannelKey
      || legacySelectedRow?.channel_key
      || (legacySelectedRow?.channel_id ? `id:${String(legacySelectedRow.channel_id).trim()}` : '')
      || (legacySelectedRow?.channel_name ? `name:${String(legacySelectedRow.channel_name).trim().toLowerCase()}` : '')
      || '',
    ).trim();
    return {
      videos: buildScopeSelectionFromKeys(legacyVideoId ? [legacyVideoId] : [], legacyVideoId || null),
      channels: buildScopeSelectionFromKeys(legacyChannelKey ? [legacyChannelKey] : [], legacyChannelKey || null),
    };
  });
  const [includeExcludeUndoStack, setIncludeExcludeUndoStack] = useState<IncludeExcludeUndoEntry[]>([]);
  const [includeExcludeRedoStack, setIncludeExcludeRedoStack] = useState<IncludeExcludeUndoEntry[]>([]);
  const [isKeyboardHelpOpen, setIsKeyboardHelpOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [openAnnotationsRequestKey, setOpenAnnotationsRequestKey] = useState(0);
  const [pendingViewerTarget, setPendingViewerTarget] = useState<
    | { kind: 'video'; videoId: string }
    | { kind: 'channel'; channelId?: string | null; channelName?: string }
    | null
  >(null);
  const [saveViewRequestKey, setSaveViewRequestKey] = useState(0);
  const [importRequestKey, setImportRequestKey] = useState(0);
  const [researchHistory, setResearchHistory] = useState<ResearchHistoryEvent[]>(() => persisted.researchHistory ?? []);
  const [watchHistoryByVideoId, setWatchHistoryByVideoId] = useState<Record<string, WatchHistoryEntry>>(() => persisted.watchHistoryByVideoId ?? {});
  const [savedViewsVersion, setSavedViewsVersion] = useState<number>(() => persisted.savedViewsVersion ?? 0);
  const [researchLogMarkdownOptions, setResearchLogMarkdownOptions] = useState<ResearchLogMarkdownOptions>(() => persisted.researchLogMarkdownOptions ?? {
    includeNotesAppendix: true,
    includeDashboardSection: true,
  });
  const [viewScope, setViewScope] = useState<ViewScope>(() => persisted.viewScope ?? 'videos');
  const [channelMetadataSnapshot, setChannelMetadataSnapshot] = useState<ChannelMetadataSnapshot | null>(() => persisted.channelMetadataSnapshot ?? null);
  const [importedChannelMetadata, setImportedChannelMetadata] = useState<ImportedChannelMetadataState | null>(() => persisted.importedChannelMetadata ?? null);
  const [channelFilterModel, setChannelFilterModel] = useState<ExplorerFilterModel>(() => persisted.channelFilterModel ?? {});
  const [videoColumnWidths, setVideoColumnWidths] = useState<Record<string, number>>(() => persisted.videoColumnWidths ?? {});
  const [channelColumnWidths, setChannelColumnWidths] = useState<Record<string, number>>(() => persisted.channelColumnWidths ?? {});
  const [videoScopeChannelKeys, setVideoScopeChannelKeys] = useState<string[] | null>(null);
  const [navigationHistory, setNavigationHistory] = useState<AppNavigationEntry[]>([]);
  const [navigationCursor, setNavigationCursor] = useState(-1);
  const [defaultGridResetStage, setDefaultGridResetStage] = useState<0 | 1>(0);
  const [sourceRegistry, setSourceRegistry] = useState<SourceRegistryState>(() => persisted.sourceRegistry ?? createEmptySourceRegistry());
  const [sourceVisibility, setSourceVisibility] = useState<SourceVisibilityState>(() => persisted.sourceVisibility ?? createEmptySourceVisibility());
  const [rowLineage, setRowLineage] = useState<RowLineageState>(() => persisted.rowLineage ?? createEmptyRowLineage());
  const [columnLineage, setColumnLineage] = useState<ColumnLineageState>(() => persisted.columnLineage ?? createEmptyColumnLineage());
  const [generatedMetadata, setGeneratedMetadata] = useState<GeneratedMetadataState>(() => persisted.generatedMetadata ?? createEmptyGeneratedMetadata());
  const [linkingState, setLinkingState] = useState<LinkingState>(() => persisted.linkingState ?? createEmptyLinkingState());
  const [channelLinkingState, setChannelLinkingState] = useState<ChannelLinkingState>(() => persisted.channelLinkingState ?? createEmptyChannelLinkingState());
  const [isGeneratingChannelMetadata, setIsGeneratingChannelMetadata] = useState(false);
  const [datasetVersion, setDatasetVersion] = useState(0);
  const [filteredViewVersion, setFilteredViewVersion] = useState(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingSchema, setPendingSchema] = useState<any[]>([]);
  const [pendingRows, setPendingRows] = useState<any[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImportSubmitting, setIsImportSubmitting] = useState(false);
  const [longTaskProgress, setLongTaskProgress] = useState<LongTaskProgress | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    return persisted.visibleColumns ?? [];
  });
  const [channelVisibleColumns, setChannelVisibleColumns] = useState<string[]>(() => {
    return persisted.channelVisibleColumns ?? [];
  });
  const [gridReadyVersion, setGridReadyVersion] = useState(0);
  const [filterModel, setFilterModel] = useState<ExplorerFilterModel>({});
  const gridApiRef = useRef<GridApi | null>(null);
  const thumbnailLoadTokenRef = useRef(0);
  const thumbnailCachesRef = useRef<Record<string, DashboardThumbnailCacheSnapshot>>({});
  const drilldownPreviousVideoFilterRef = useRef<ExplorerFilterModel | null>(null);
  const selectionScrollModeRef = useRef<'none' | 'middle'>('none');
  const latestPersistedStateRef = useRef<Record<string, any> | null>(persisted);
  const sourceRowsRef = useRef<any[]>([]);
  const sourceSchemaRef = useRef<any[]>([]);
  const isAutoRestoreInFlightRef = useRef(false);
  const [isChannelDrilldownFilterActive, setIsChannelDrilldownFilterActive] = useState(false);
  const navigationRestoreInFlightRef = useRef(false);
  const lastNavigationKeyRef = useRef<string | null>(null);
  const initialSelectionResolvedRef = useRef<{ videos: boolean; channels: boolean }>({ videos: false, channels: false });
  const videoSelection = selectionState.videos;
  const channelSelection = selectionState.channels;
  const selectedChannelKeys = channelSelection.selectedKeys;

  const applyScopeSelection = useCallback((scope: ViewScope, update: ScopeSelectionUpdate) => {
    dispatchSelection(setScopeSelectionAction(scope, update));
  }, []);

  const clearScopeSelection = useCallback((scope: ViewScope, preserveDetail = true) => {
    dispatchSelection(clearScopeSelectionAction(scope, preserveDetail));
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => setIsAppFullscreen(Boolean(document.fullscreenElement));
    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  const handleToggleAppFullscreen = useCallback(() => {
    const root = document.documentElement;
    if (!document.fullscreenElement) {
      if (!root?.requestFullscreen) return;
      void root.requestFullscreen().catch((error) => {
        console.warn('[fullscreen] Failed to enter app fullscreen.', error);
      });
      return;
    }
    if (!document.exitFullscreen) return;
    void document.exitFullscreen().catch((error) => {
      console.warn('[fullscreen] Failed to exit app fullscreen.', error);
    });
  }, []);

  const updateLongTaskProgress = useCallback((progress: LongTaskProgress | null) => {
    flushSync(() => {
      setLongTaskProgress(progress);
    });
  }, []);

  const workingSchema = useMemo(() => stripDeletedColumnsFromSchema(sourceSchema, deletedColumns), [sourceSchema, deletedColumns]);
  const baseRows = useMemo(() => stripDeletedColumnsFromRows(sourceRows, deletedColumns), [sourceRows, deletedColumns]);
  const sourceVideoIdSet = useMemo(() => new Set(collectVideoIds(sourceRows)), [sourceRows]);
  const hiddenSourceIdSet = useMemo(() => new Set(sourceVisibility.hiddenSourceIds || []), [sourceVisibility.hiddenSourceIds]);
  const sourceMaskedRows = useMemo(() => {
    if (!hiddenSourceIdSet.size) return baseRows;
    return baseRows.filter((row, index) => {
      const rowId = resolveRowLineageKey(row, index);
      const lineage = rowLineage.byRowId[rowId];
      if (!lineage?.baseSourceId) return true;
      return !hiddenSourceIdSet.has(lineage.baseSourceId);
    });
  }, [baseRows, hiddenSourceIdSet, rowLineage.byRowId]);
  const excludedVideoIdSet = useMemo(() => new Set(excludedVideoIds), [excludedVideoIds]);
  const inclusionPartition = useMemo(() => partitionRowsByInclusion(sourceMaskedRows, excludedVideoIdSet), [sourceMaskedRows, excludedVideoIdSet]);
  const includedBaseRows = inclusionPartition.included;
  const excludedBaseRows = inclusionPartition.excluded;
  const activeBaseRows = useMemo(
    () => (inclusionView === 'excluded' ? excludedBaseRows : includedBaseRows),
    [excludedBaseRows, includedBaseRows, inclusionView],
  );

  const computedContentIntentByVideoId = useMemo(() => {
    const next: Record<string, string> = {};
    baseRows.forEach((row) => {
      const videoId = resolveVideoId(row);
      if (!videoId) return;
      const title = resolveVideoTitle(row);
      const description = String(
        row?.[VIDEO_DESCRIPTION_COLUMN]
        ?? row?.description
        ?? row?.videoDescription
        ?? '',
      );
      next[videoId] = inferIntentFromText(`${title} ${description}`);
    });
    return next;
  }, [baseRows]);
  const effectiveGeneratedMetadataByVideoId = useMemo(() => {
    const byVideoId = generatedMetadata.byVideoId || {};
    const allIds = new Set<string>([
      ...Object.keys(byVideoId),
      ...Object.keys(computedContentIntentByVideoId),
    ]);
    const next: GeneratedMetadataState['byVideoId'] = {};
    allIds.forEach((videoId) => {
      const persistedEntry = byVideoId[videoId];
      next[videoId] = {
        content_intent: computedContentIntentByVideoId[videoId] || persistedEntry?.content_intent || 'other',
        linking: persistedEntry?.linking,
      };
    });
    return next;
  }, [computedContentIntentByVideoId, generatedMetadata.byVideoId]);
  const generatedOverlayByVideoId = useMemo<Record<string, Record<string, any>>>(() => {
    const entries = Object.entries(effectiveGeneratedMetadataByVideoId as GeneratedMetadataState['byVideoId'])
      .map(([videoId, entry]) => [videoId, flattenGeneratedMetadataForOverlay(entry)] as const)
      .filter(([, value]) => Boolean(value));
    return Object.fromEntries(entries) as Record<string, Record<string, any>>;
  }, [effectiveGeneratedMetadataByVideoId]);
  const generatedSchema = useMemo(() => buildGeneratedMetadataSchema(generatedOverlayByVideoId), [generatedOverlayByVideoId]);
  const workingSchemaWithGenerated = useMemo(() => {
    if (!generatedSchema.length) return workingSchema;
    const existing = new Set(workingSchema.map((column) => column.column_name));
    const additions = generatedSchema.filter((column) => !existing.has(column.column_name));
    return [...workingSchema, ...additions];
  }, [generatedSchema, workingSchema]);
  const activeBaseRowsWithGenerated = useMemo(
    () => overlayGeneratedMetadataRows(activeBaseRows, generatedOverlayByVideoId),
    [activeBaseRows, generatedOverlayByVideoId],
  );
  const includedBaseRowsWithGenerated = useMemo(
    () => overlayGeneratedMetadataRows(includedBaseRows, generatedOverlayByVideoId),
    [generatedOverlayByVideoId, includedBaseRows],
  );
  const displaySchema = useMemo(() => buildDisplaySchema(workingSchemaWithGenerated, userTagsByVideoId), [workingSchemaWithGenerated, userTagsByVideoId]);
  const displayRows = useMemo(() => buildDisplayRows(activeBaseRowsWithGenerated, userTagsByVideoId), [activeBaseRowsWithGenerated, userTagsByVideoId]);
  const channelScopedDisplayRows = useMemo(() => {
    if (!videoScopeChannelKeys?.length) return displayRows;
    const allowed = new Set(videoScopeChannelKeys);
    return displayRows.filter((row) => {
      const channelId = resolveChannelId(row);
      const channelName = resolveChannelName(row);
      const channelKey = channelId ? `id:${channelId}` : `name:${channelName.toLowerCase()}`;
      return Boolean(channelKey) && allowed.has(channelKey);
    });
  }, [displayRows, videoScopeChannelKeys]);
  const booleanMapColumns = useMemo(() => detectBooleanMapColumns(displayRows, displaySchema), [displayRows, displaySchema]);
  const listLikeColumns = useMemo(() => detectListLikeColumns(displayRows, displaySchema, booleanMapColumns), [booleanMapColumns, displayRows, displaySchema]);
  const unifiedFilterState = useMemo(() => buildUnifiedFilterState({
    rows: channelScopedDisplayRows,
    schema: displaySchema,
    filterModel,
    listLikeColumns,
    booleanMapColumns,
  }), [booleanMapColumns, channelScopedDisplayRows, displaySchema, filterModel, listLikeColumns]);
  const rows = unifiedFilterState.filteredRows;
  const visibleVideoIds = useMemo(() => collectVideoIds(rows), [rows]);
  const videoCorpusFingerprint = useMemo(
    () => buildVideoCorpusFingerprint(sourceRows, sourceSchema),
    [sourceRows, sourceSchema],
  );
  const exclusionMembershipFingerprint = useMemo(
    () => buildExcludedMembershipFingerprint(excludedVideoIds),
    [excludedVideoIds],
  );
  const currentChannelMetadataCacheKey = useMemo(() => buildChannelMetadataCacheKey({
    videoCorpusFingerprint,
    exclusionMembershipFingerprint,
    inclusionView,
  }), [exclusionMembershipFingerprint, inclusionView, videoCorpusFingerprint]);
  const isChannelMetadataFresh = useMemo(() => Boolean(
    channelMetadataSnapshot
    && (
      (channelMetadataSnapshot.cacheKeyAtCalculation
        ? channelMetadataSnapshot.cacheKeyAtCalculation === currentChannelMetadataCacheKey
        : (
          channelMetadataSnapshot.datasetVersionAtCalculation === datasetVersion
          && channelMetadataSnapshot.inclusionViewAtCalculation === inclusionView
        ))
    ),
  ), [channelMetadataSnapshot, currentChannelMetadataCacheKey, datasetVersion, inclusionView]);
  const channelRows = useMemo(() => {
    if (!channelMetadataSnapshot?.rows?.length) return [];
    return mergeChannelMetadataRows(channelMetadataSnapshot.rows, importedChannelMetadata);
  }, [channelMetadataSnapshot, importedChannelMetadata]);
  const hasChannelUserTags = useMemo(
    () => Object.values(channelTagsById).some((tags) => Array.isArray(tags) && tags.length > 0),
    [channelTagsById],
  );
  const scopedChannelRows = useMemo(() => {
    if (!channelRows.length || !activeBaseRows.length) return [];
    const scopedChannelKeys = new Set<string>();
    activeBaseRows.forEach((row) => {
      const channelId = resolveChannelId(row);
      const channelName = resolveChannelName(row);
      const channelKey = channelId ? `id:${channelId}` : `name:${channelName.toLowerCase()}`;
      if (channelKey) scopedChannelKeys.add(channelKey);
    });
    if (!scopedChannelKeys.size) return [];

    const scopedCachedRows = channelRows.filter((row) => scopedChannelKeys.has(resolveChannelRowKey(row)));
    const coveredKeys = new Set(scopedCachedRows.map((row) => resolveChannelRowKey(row)).filter(Boolean));
    const missingSourceRows = activeBaseRows.filter((row) => {
      const channelId = resolveChannelId(row);
      const channelName = resolveChannelName(row);
      const channelKey = channelId ? `id:${channelId}` : `name:${channelName.toLowerCase()}`;
      return Boolean(channelKey) && !coveredKeys.has(channelKey);
    });
    if (!missingSourceRows.length) return scopedCachedRows;

    const scopedFallbackRows = buildChannelMetadataRows(missingSourceRows, importedChannelMetadata)
      .filter((row) => {
        const channelKey = resolveChannelRowKey(row);
        return Boolean(channelKey) && !coveredKeys.has(channelKey);
      });
    return [...scopedCachedRows, ...scopedFallbackRows];
  }, [activeBaseRows, channelRows, importedChannelMetadata]);
  const channelRowsWithTags = useMemo(() => {
    if (!scopedChannelRows.length) return scopedChannelRows;
    if (!hasChannelUserTags) return scopedChannelRows;
    return scopedChannelRows.map((row) => {
      const channelKey = resolveChannelRowKey(row);
      const tags = channelKey ? (channelTagsById[channelKey] || []) : [];
      return {
        ...row,
        [CHANNEL_USER_TAGS_COLUMN]: tags,
      };
    });
  }, [channelTagsById, hasChannelUserTags, scopedChannelRows]);
  const channelRowsWithLinking = useMemo(() => {
    if (!channelRowsWithTags.length) return channelRowsWithTags;
    if (!channelLinkingState.snapshot?.byChannelKey || channelLinkingState.stale) return channelRowsWithTags;
    const byChannelKey = channelLinkingState.snapshot.byChannelKey;
    return channelRowsWithTags.map((row) => {
      const key = String(row?.channel_key || '');
      const linking = byChannelKey[key];
      if (!linking) return row;
      return { ...row, ...linking };
    });
  }, [channelLinkingState.snapshot?.byChannelKey, channelLinkingState.stale, channelRowsWithTags]);
  const channelSchema = useMemo(() => {
    const rawSchema = deriveSchemaFromRows(channelRowsWithLinking, CHANNEL_BASE_SCHEMA);
    const hasCanonicalChannelName = rawSchema.some((column) => column.column_name === 'channel_name');
    return rawSchema.filter((column) => !(hasCanonicalChannelName && column.column_name === 'title'));
  }, [channelRowsWithLinking]);
  const channelBooleanMapColumns = useMemo(() => detectBooleanMapColumns(channelRowsWithLinking, channelSchema), [channelRowsWithLinking, channelSchema]);
  const channelListLikeColumns = useMemo(() => detectListLikeColumns(channelRowsWithLinking, channelSchema, channelBooleanMapColumns), [channelBooleanMapColumns, channelRowsWithLinking, channelSchema]);
  const unifiedChannelFilterState = useMemo(() => buildUnifiedFilterState({
    rows: channelRowsWithLinking,
    schema: channelSchema,
    filterModel: channelFilterModel,
    listLikeColumns: channelListLikeColumns,
    booleanMapColumns: channelBooleanMapColumns,
  }), [channelBooleanMapColumns, channelFilterModel, channelListLikeColumns, channelRowsWithLinking, channelSchema]);
  const filteredChannelRows = unifiedChannelFilterState.filteredRows;
  const selectedChannelRows = useMemo(
    () => filteredChannelRows.filter((row) => selectedChannelKeys.includes(resolveChannelRowKey(row))),
    [filteredChannelRows, selectedChannelKeys],
  );
  const channelVideoRowsByKey = useMemo(() => {
    const next = new Map<string, any[]>();
    activeBaseRows.forEach((row) => {
      const channelId = resolveChannelId(row);
      const channelName = resolveChannelName(row);
      const channelKey = channelId ? `id:${channelId}` : `name:${channelName.toLowerCase()}`;
      const current = next.get(channelKey);
      if (current) current.push(row);
      else next.set(channelKey, [row]);
    });
    return next;
  }, [activeBaseRows]);
  const selectedChannelVideoRowsForActions = useMemo(
    () => selectedChannelKeys.flatMap((channelKey) => channelVideoRowsByKey.get(channelKey) || []),
    [channelVideoRowsByKey, selectedChannelKeys],
  );
  const areAllFilteredChannelsSelectedForAction = useMemo(() => {
    if (!filteredChannelRows.length || !selectedChannelKeys.length) return false;
    const filteredKeys = filteredChannelRows.map((row) => resolveChannelRowKey(row)).filter(Boolean);
    if (filteredKeys.length === 0 || filteredKeys.length !== selectedChannelKeys.length) return false;
    const selectedSet = new Set(selectedChannelKeys);
    return filteredKeys.every((key) => selectedSet.has(key));
  }, [filteredChannelRows, selectedChannelKeys]);
  const channelFilteredColumns = unifiedChannelFilterState.filteredColumns;
  const displayedRowCount = viewScope === 'channels' ? filteredChannelRows.length : rows.length;
  const totalScopeRowCount = viewScope === 'channels' ? channelRowsWithLinking.length : displayRows.length;
  const activeGridRows = viewScope === 'channels' ? filteredChannelRows : rows;
  const activeGridSchema = viewScope === 'channels' ? channelSchema : displaySchema;
  const activeGridListLikeColumns = viewScope === 'channels' ? channelListLikeColumns : listLikeColumns;
  const activeGridBooleanMapColumns = viewScope === 'channels' ? channelBooleanMapColumns : booleanMapColumns;
  const activeGridTagValuesByColumn = viewScope === 'channels'
    ? unifiedChannelFilterState.tagValueIndexByColumn
    : unifiedFilterState.tagValueIndexByColumn;
  const activeGridFilterModel = viewScope === 'channels' ? channelFilterModel : filterModel;
  const selectedVideoIdsForActions = viewScope === 'videos' ? videoSelection.selectedKeys : [];
  const selectedVideoCount = selectedVideoIdsForActions.length;
  const sourceMaskedRowByVideoId = useMemo(() => {
    const next = new Map<string, any>();
    sourceMaskedRows.forEach((row) => {
      const videoId = resolveVideoId(row);
      if (!videoId || next.has(videoId)) return;
      next.set(videoId, row);
    });
    return next;
  }, [sourceMaskedRows]);
  const areAllFilteredVideosSelectedForAction = useMemo(() => {
    if (!visibleVideoIds.length || !selectedVideoIdsForActions.length) return false;
    if (visibleVideoIds.length !== selectedVideoIdsForActions.length) return false;
    const selectedSet = new Set(selectedVideoIdsForActions);
    return visibleVideoIds.every((videoId) => selectedSet.has(videoId));
  }, [selectedVideoIdsForActions, visibleVideoIds]);
  const selectedRowsForBatchCopy = useMemo(() => {
    if (viewScope !== 'videos' || selectedVideoIdsForActions.length === 0) return [];
    const rowByVideoId = new Map<string, any>();
    rows.forEach((row) => {
      const videoId = resolveVideoId(row);
      if (!videoId || rowByVideoId.has(videoId)) return;
      rowByVideoId.set(videoId, row);
    });
    return selectedVideoIdsForActions
      .map((videoId) => rowByVideoId.get(videoId))
      .filter((row): row is any => Boolean(row));
  }, [rows, selectedVideoIdsForActions, viewScope]);
  const batchSharedTags = useMemo(() => {
    if (viewScope !== 'videos' || selectedVideoIdsForActions.length <= 1) return [];
    const selectedVideoIds = Array.from(new Set(selectedVideoIdsForActions));
    let sharedTags: string[] | null = null;

    selectedVideoIds.forEach((videoId) => {
      const tags = Array.isArray(userTagsByVideoId[videoId]) ? userTagsByVideoId[videoId] as string[] : [];
      const uniqueTags = Array.from(new Set(
        tags
          .map((tag) => String(tag).trim())
          .filter((tag): tag is string => tag.length > 0),
      ));
      if (sharedTags === null) {
        sharedTags = uniqueTags;
        return;
      }
      const tagSet = new Set(uniqueTags);
      sharedTags = sharedTags.filter((tag) => tagSet.has(tag));
    });

    return sharedTags || [];
  }, [selectedVideoIdsForActions, userTagsByVideoId, viewScope]);
  const visibleVideoIdSet = useMemo(() => new Set<string>(visibleVideoIds), [visibleVideoIds]);
  const batchSelectionKey = useMemo(() => {
    if (viewScope === 'channels') return 'inactive';
    if (selectedVideoCount <= 1) return 'inactive';
    return `explicit:${selectedVideoCount}:${selectedVideoIdsForActions[0] || ''}:${selectedVideoIdsForActions[selectedVideoIdsForActions.length - 1] || ''}:${filteredViewVersion}`;
  }, [filteredViewVersion, selectedVideoCount, selectedVideoIdsForActions, viewScope]);
  const hasUserTags = useMemo(() => Object.keys(userTagsByVideoId).length > 0, [userTagsByVideoId]);
  const filteredColumns = unifiedFilterState.filteredColumns;
  const schemaColumnNames = useMemo(() => displaySchema.map((column) => column.column_name), [displaySchema]);
  const channelSchemaColumnNames = useMemo(() => channelSchema.map((column) => column.column_name), [channelSchema]);
  const activeScopeVisibleColumns = useMemo(() => {
    const hiddenColumnSourceIds = new Set(sourceVisibility.hiddenColumnSourceIdsByScope?.[viewScope] || []);
    const isHiddenBySource = (column: string) => {
      const lineage = columnLineage.byColumn[column];
      if (!lineage?.sourceId) return false;
      return hiddenColumnSourceIds.has(lineage.sourceId);
    };
    if (viewScope === 'channels') {
      const activeSet = new Set(channelSchemaColumnNames);
      return channelVisibleColumns.filter((column) => activeSet.has(column) && !isHiddenBySource(column));
    }
    return visibleColumns.filter((column) => !isHiddenBySource(column));
  }, [channelSchemaColumnNames, channelVisibleColumns, columnLineage.byColumn, sourceVisibility.hiddenColumnSourceIdsByScope, viewScope, visibleColumns]);
  const activeFilterColumns = useMemo(() => activeGridSchema.map((column) => ({
    column: column.column_name,
    kind: resolveEditViewFilterKind(column.column_name, column.column_type, activeGridListLikeColumns, activeGridBooleanMapColumns),
  })), [activeGridBooleanMapColumns, activeGridListLikeColumns, activeGridSchema]);
  const activeFilterKindLookup = useMemo(() => Object.fromEntries(activeFilterColumns.map((entry) => [entry.column, entry.kind])), [activeFilterColumns]);
  const activeEditFilters = useMemo(() => Object.entries(activeGridFilterModel || {}).map(([column, model]) => ({
    column,
    summary: describeFilterModelEntry(column, model),
    kind: activeFilterKindLookup[column] || 'text',
    model,
  })), [activeFilterKindLookup, activeGridFilterModel]);
  const rowCountByBaseSource = useMemo(() => {
    const counts: Record<string, number> = {};
    sourceMaskedRows.forEach((row, index) => {
      const rowId = resolveRowLineageKey(row, index);
      const sourceId = rowLineage.byRowId[rowId]?.baseSourceId;
      if (!sourceId) return;
      counts[sourceId] = (counts[sourceId] || 0) + 1;
    });
    return counts;
  }, [rowLineage.byRowId, sourceMaskedRows]);
  const sourceLabelById = useMemo(() => (
    Object.fromEntries(
      sourceRegistry.orderedIds.map((id) => [id, sourceRegistry.byId[id]?.label || id]),
    ) as Record<string, string>
  ), [sourceRegistry.byId, sourceRegistry.orderedIds]);
  const columnSourceByColumn = useMemo(() => (
    Object.fromEntries(
      Object.entries(columnLineage.byColumn as ColumnLineageState['byColumn']).map(([column, entry]) => [column, entry.sourceId]),
    ) as Record<string, string>
  ), [columnLineage.byColumn]);
  const sourceItemsForVisibility = useMemo(() => (
    sourceRegistry.orderedIds
      .filter((sourceId) => sourceRegistry.byId[sourceId]?.kind !== 'generated')
      .map((sourceId) => {
        const source = sourceRegistry.byId[sourceId];
        const rowHidden = (sourceVisibility.hiddenSourceIds || []).includes(sourceId);
        const columnHidden = (sourceVisibility.hiddenColumnSourceIdsByScope?.[viewScope] || []).includes(sourceId);
        const hasRowContributions = Boolean(rowCountByBaseSource[sourceId] ?? 0);
        const hasColumnContributions = Object.values(columnLineage.byColumn as ColumnLineageState['byColumn']).some((entry) => entry.sourceId === sourceId && !entry.generated);
        const hasMergedIntoExistingRows = Object.values(rowLineage.byRowId as RowLineageState['byRowId']).some((entry) => entry.baseSourceId !== sourceId && (entry.contributorSourceIds || []).includes(sourceId));
        const canDelete = source?.kind === 'enrichment'
          && sourceId !== sourceRegistry.primarySourceId
          && !hasMergedIntoExistingRows
          && (hasRowContributions || hasColumnContributions);
        return {
          id: sourceId,
          label: source?.label || sourceId,
          kind: (source?.kind || 'enrichment') as SourceKind,
          rowCount: source?.rowCount ?? 0,
          visibleRowCount: rowHidden ? 0 : (rowCountByBaseSource[sourceId] ?? 0),
          missing: source?.missing,
          rowHidden,
          columnHidden,
          canDelete,
          deleteTitle: canDelete
            ? 'Delete this imported source from the current project.'
            : (source?.kind === 'base'
              ? 'The base dataset cannot be deleted here.'
              : (hasMergedIntoExistingRows
                ? 'This source changed existing rows and cannot be cleanly removed from this menu.'
                : 'This source cannot be safely deleted from this menu.')),
        };
      })
  ), [
    columnLineage.byColumn,
    rowCountByBaseSource,
    rowLineage.byRowId,
    sourceRegistry.byId,
    sourceRegistry.orderedIds,
    sourceRegistry.primarySourceId,
    sourceVisibility.hiddenColumnSourceIdsByScope,
    sourceVisibility.hiddenSourceIds,
    viewScope,
  ]);
  const linkingSourceItems = useMemo(() => (
    sourceRegistry.orderedIds
      .filter((id) => sourceRegistry.byId[id]?.kind !== 'generated')
      .map((id) => ({
      id,
      label: sourceRegistry.byId[id]?.label || id,
      visible: !(sourceVisibility.hiddenSourceIds || []).includes(id),
      }))
  ), [sourceRegistry.byId, sourceRegistry.orderedIds, sourceVisibility.hiddenSourceIds]);

  const handleGridSelectionChange = useCallback((update: ScopeSelectionUpdate) => {
    if (viewScope === 'channels') {
      const validKeys = new Set(filteredChannelRows.map((row) => resolveChannelRowKey(row)).filter(Boolean));
      const selectedKeys = update.selectedKeys.filter((key) => validKeys.has(key));
      applyScopeSelection('channels', {
        ...update,
        selectedKeys,
        anchorKey: selectedKeys.length
          ? ((update.anchorKey && selectedKeys.includes(update.anchorKey)) ? update.anchorKey : selectedKeys[0])
          : null,
        focusKey: selectedKeys.length
          ? ((update.focusKey && selectedKeys.includes(update.focusKey)) ? update.focusKey : selectedKeys[selectedKeys.length - 1])
          : null,
        detailKey: update.detailKey ?? channelSelection.detailKey,
      });
      if (selectedKeys.length > 1) {
        setState((previous) => (previous.isRightPanelCollapsed ? { ...previous, isRightPanelCollapsed: false } : previous));
      }
      return;
    }

    const selectedKeys = update.selectedKeys.filter((key) => visibleVideoIdSet.has(key));
    applyScopeSelection('videos', {
      ...update,
      selectedKeys,
      anchorKey: selectedKeys.length
        ? ((update.anchorKey && selectedKeys.includes(update.anchorKey)) ? update.anchorKey : selectedKeys[0])
        : null,
      focusKey: selectedKeys.length
        ? ((update.focusKey && selectedKeys.includes(update.focusKey)) ? update.focusKey : selectedKeys[selectedKeys.length - 1])
        : null,
      detailKey: update.detailKey ?? videoSelection.detailKey,
    });
  }, [applyScopeSelection, channelSelection.detailKey, filteredChannelRows, videoSelection.detailKey, viewScope, visibleVideoIdSet]);

  useEffect(() => {
    thumbnailCachesRef.current = thumbnailCaches;
  }, [thumbnailCaches]);

  useEffect(() => {
    sourceRowsRef.current = sourceRows;
  }, [sourceRows]);

  useEffect(() => {
    sourceSchemaRef.current = sourceSchema;
  }, [sourceSchema]);

  useEffect(() => () => {
    (Object.values(thumbnailCachesRef.current) as DashboardThumbnailCacheSnapshot[]).forEach((snapshot) => revokeThumbnailUrls(snapshot));
  }, []);

  const flushAutosaveSnapshotNow = useCallback(async (reason: string) => {
    if (!sourceRows.length || !sourceSchema.length) {
      return;
    }
    const snapshot = {
      version: LAST_PROJECT_AUTOSAVE_VERSION,
      savedAt: new Date().toISOString(),
      fileName: state.fileName ?? null,
      sourceSchema,
      rows: sourceRows,
    };
    try {
      await saveLastProjectAutosaveSnapshot(snapshot);
    } catch (error) {
      console.warn(`[autosave] Failed to persist snapshot (${reason}).`, error);
    }
  }, [sourceRows, sourceSchema, state.fileName]);

  useEffect(() => {
    const nextPersistedState = {
      isRightPanelCollapsed: state.isRightPanelCollapsed,
      savedViews: state.savedViews,
      activeViewId: state.activeViewId,
      annotations: state.annotations,
      userTagsByVideoId,
      projectOverview: state.projectOverview,
      projectNotes: state.projectNotes,
      researchLogSectionComments: state.researchLogSectionComments,
      researchHistory,
      watchHistoryByVideoId,
      savedViewsVersion,
      inclusionView,
      excludedVideoIds,
      excludedVideoMetaById,
      visibleColumns,
      channelVisibleColumns,
      theme: state.theme,
      deletedColumns,
      specialMappings,
      dashboardSnapshots,
      savedViewDashboardSnapshots,
      channelMetadataSnapshot,
      importedChannelMetadata,
      viewScope,
      channelFilterModel,
      selectedVideoId: videoSelection.detailKey || videoSelection.focusKey || videoSelection.anchorKey || videoSelection.selectedKeys[0] || null,
      selectedChannelKey: channelSelection.detailKey || channelSelection.focusKey || channelSelection.anchorKey || channelSelection.selectedKeys[0] || null,
      videoColumnWidths,
      channelColumnWidths,
      sourceRegistry,
      sourceVisibility,
      rowLineage,
      columnLineage,
      generatedMetadata,
      linkingState,
      channelLinkingState,
      researchLogMarkdownOptions,
      notesByVideoId,
      channelNotesById,
      channelTagsById,
    };
    latestPersistedStateRef.current = nextPersistedState;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;
    const persist = () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPersistedState));
    };

    if ('requestIdleCallback' in window) {
      idleId = (window as Window & { requestIdleCallback: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number }).requestIdleCallback(
        () => persist(),
        { timeout: 1200 },
      );
    } else {
      timeoutId = globalThis.setTimeout(persist, 120);
    }

    return () => {
      if (idleId !== null && 'cancelIdleCallback' in window) {
        (window as Window & { cancelIdleCallback: (handle: number) => void }).cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    state.isRightPanelCollapsed,
    state.savedViews,
    state.activeViewId,
    state.annotations,
    state.projectOverview,
    state.projectNotes,
    state.researchLogSectionComments,
    state.theme,
    researchHistory,
    watchHistoryByVideoId,
    savedViewsVersion,
    inclusionView,
    excludedVideoIds,
    excludedVideoMetaById,
    visibleColumns,
    channelVisibleColumns,
    deletedColumns,
    specialMappings,
    dashboardSnapshots,
    savedViewDashboardSnapshots,
    channelMetadataSnapshot,
    importedChannelMetadata,
    viewScope,
    channelFilterModel,
    videoSelection.anchorKey,
    videoSelection.detailKey,
    videoSelection.focusKey,
    videoSelection.selectedKeys,
    channelSelection.anchorKey,
    channelSelection.detailKey,
    channelSelection.focusKey,
    channelSelection.selectedKeys,
    videoColumnWidths,
    channelColumnWidths,
    sourceRegistry,
    sourceVisibility,
    rowLineage,
    columnLineage,
    generatedMetadata,
    linkingState,
    channelLinkingState,
    researchLogMarkdownOptions,
    notesByVideoId,
    channelNotesById,
    channelTagsById,
    userTagsByVideoId,
  ]);

  useEffect(() => {
    const flushLatestPersistedState = () => {
      const snapshot = latestPersistedStateRef.current;
      void flushAutosaveSnapshotNow('page-lifecycle');
      if (!snapshot) return;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch (error) {
        console.warn('Failed to flush local storage on page lifecycle event:', error);
      }
    };

    window.addEventListener('pagehide', flushLatestPersistedState);
    window.addEventListener('beforeunload', flushLatestPersistedState);
    return () => {
      window.removeEventListener('pagehide', flushLatestPersistedState);
      window.removeEventListener('beforeunload', flushLatestPersistedState);
    };
  }, [flushAutosaveSnapshotNow]);

  useEffect(() => {
    if (!sourceRows.length || !sourceSchema.length) return;
    void flushAutosaveSnapshotNow('dataset-change');
  }, [flushAutosaveSnapshotNow, sourceRows.length, sourceSchema.length]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  useEffect(() => {
    if (hasUserTags && !visibleColumns.includes(USER_TAGS_COLUMN)) {
      setVisibleColumns((current) => [...current, USER_TAGS_COLUMN]);
    }
  }, [hasUserTags, visibleColumns]);

  useEffect(() => {
    if (!channelSchema.length) return;
    const channelColumnNames = channelSchema.map((column) => column.column_name);
    setChannelVisibleColumns((current) => {
      if (current.length === 0) return getDefaultChannelVisibleColumns(channelColumnNames);
      const retained = current.filter((column) => channelColumnNames.includes(column));
      const additions = channelColumnNames.filter((column) => !retained.includes(column));
      const next = [...retained, ...additions];
      if (next.length === current.length && next.every((column, index) => column === current[index])) {
        return current;
      }
      return next;
    });
  }, [channelSchema]);

  useEffect(() => {
    if (!hasChannelUserTags) return;
    if (!channelSchema.some((column) => column.column_name === CHANNEL_USER_TAGS_COLUMN)) return;
    setChannelVisibleColumns((current) => (
      current.includes(CHANNEL_USER_TAGS_COLUMN)
        ? current
        : [...current, CHANNEL_USER_TAGS_COLUMN]
    ));
  }, [channelSchema, hasChannelUserTags]);

  useEffect(() => {
    dispatchSelection(pruneScopeSelectionAction('channels', filteredChannelRows.map((row) => resolveChannelRowKey(row)).filter(Boolean)));
  }, [filteredChannelRows]);

  useEffect(() => {
    if (!state.activeViewId) return;
    const activeView = state.savedViews.find((view) => view.id === state.activeViewId);
    setFilterModel(activeView?.filterModel || {});
  }, [state.activeViewId, state.savedViews]);

  const selectedVideoId = viewScope === 'videos'
    ? (videoSelection.detailKey || videoSelection.focusKey || videoSelection.anchorKey || videoSelection.selectedKeys[videoSelection.selectedKeys.length - 1] || null)
    : null;
  const detailVideoId = selectedVideoId;
  const detailRow = useMemo(() => {
    if (viewScope !== 'videos' || !detailVideoId) return null;
    return rows.find((row) => resolveVideoId(row) === detailVideoId) || null;
  }, [detailVideoId, rows, viewScope]);
  const selectedChannelDetailRow = useMemo(() => {
    if (viewScope !== 'channels') return null;
    const selectedKey = channelSelection.detailKey
      || channelSelection.focusKey
      || channelSelection.anchorKey
      || selectedChannelKeys[0]
      || '';
    if (selectedKey) {
      const matchedByState = filteredChannelRows.find((row) => resolveChannelRowKey(row) === selectedKey);
      if (matchedByState) return matchedByState;
    }
    if (selectedChannelRows.length > 0) return selectedChannelRows[0];
    return filteredChannelRows[0] || null;
  }, [channelSelection.anchorKey, channelSelection.detailKey, channelSelection.focusKey, filteredChannelRows, selectedChannelKeys, selectedChannelRows, viewScope]);
  const hasLoadedData = workingSchema.length > 0 && baseRows.length > 0;
  const currentProjectName = useMemo(() => (state.fileName || 'ytde_project').replace(/\.(csv|zip)$/i, ''), [state.fileName]);

  const appendResearchHistory = useCallback((event: Omit<ResearchHistoryEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string }) => {
    setResearchHistory((current) => [
      ...current,
      {
        id: event.id || createHistoryId('history'),
        createdAt: event.createdAt || new Date().toISOString(),
        ...event,
      },
    ]);
  }, []);

  const markResearchHistoryEventReverted = useCallback((eventId?: string) => {
    if (!eventId) return;
    setResearchHistory((current) => current.map((event) => (
      event.id === eventId ? { ...event, reverted: true } : event
    )));
  }, []);

  const clearChannelDrilldownState = useCallback((options?: { restoreVideoFilters?: boolean }) => {
    const shouldRestore = options?.restoreVideoFilters !== false;
    if (shouldRestore && isChannelDrilldownFilterActive) {
      setState((previous) => ({ ...previous, activeViewId: null }));
      setFilterModel(drilldownPreviousVideoFilterRef.current ?? {});
    }
    drilldownPreviousVideoFilterRef.current = null;
    setIsChannelDrilldownFilterActive(false);
  }, [isChannelDrilldownFilterActive]);

  const clearChannelScopedVideoUniverse = useCallback(() => {
    setVideoScopeChannelKeys(null);
  }, []);

  const resetVideoLayoutToDefault = useCallback(() => {
    setVisibleColumns(getDefaultVideoVisibleColumns(displaySchema));
    setVideoColumnWidths({});
  }, [displaySchema]);

  const resetChannelLayoutToDefault = useCallback(() => {
    setChannelVisibleColumns(getDefaultChannelVisibleColumns(channelSchema.map((column) => column.column_name)));
    setChannelColumnWidths({});
  }, [channelSchema]);

  const restoreNavigationEntry = useCallback((entry: AppNavigationEntry) => {
    navigationRestoreInFlightRef.current = true;
    drilldownPreviousVideoFilterRef.current = entry.drilldownPreviousVideoFilter ?? null;
    setDefaultGridResetStage(0);
    setInclusionView(entry.inclusionView);
    setVideoScopeChannelKeys(entry.videoScopeChannelKeys ?? null);
    setIsChannelDrilldownFilterActive(entry.isChannelDrilldownFilterActive);
    setChannelFilterModel(entry.channelFilterModel || {});
    clearScopeSelection('videos', false);
    clearScopeSelection('channels', false);
    setState((previous) => ({ ...previous, activeViewId: entry.activeViewId }));
    setFilterModel(entry.filterModel || {});
    if (entry.viewScope === 'channels') {
      setViewScope('channels');
      setPendingViewerTarget(entry.channelId || entry.channelName ? { kind: 'channel', channelId: entry.channelId, channelName: entry.channelName || undefined } : null);
      return;
    }
    setViewScope('videos');
    setPendingViewerTarget(entry.selectedVideoId ? { kind: 'video', videoId: entry.selectedVideoId } : null);
  }, [clearScopeSelection]);

  const navigateHistoryByOffset = useCallback((offset: -1 | 1) => {
    setNavigationCursor((current) => {
      const target = current + offset;
      const entry = navigationHistory[target];
      if (!entry) return current;
      restoreNavigationEntry(entry);
      return target;
    });
  }, [navigationHistory, restoreNavigationEntry]);

  const markDerivedSnapshotsStale = useCallback((reason: string) => {
    setLinkingState((current) => ({
      ...current,
      stale: true,
      staleReason: reason,
      sourceCandidateProfiles: [],
    }));
    setChannelLinkingState((current) => ({
      ...current,
      stale: true,
      staleReason: reason,
    }));
  }, []);

  const clearAllThumbnailCaches = useCallback(() => {
    thumbnailLoadTokenRef.current = Math.max(thumbnailLoadTokenRef.current + 1, hydratedSessionCounter);
    setThumbnailLoadProgress(null);
    setThumbnailCaches((current) => {
      (Object.values(current as Record<string, DashboardThumbnailCacheSnapshot>) as DashboardThumbnailCacheSnapshot[]).forEach((snapshot) => revokeThumbnailUrls(snapshot));
      return {};
    });
  }, []);

  useEffect(() => {
    dispatchSelection(pruneScopeSelectionAction('videos', visibleVideoIds));
  }, [visibleVideoIds]);

  useEffect(() => {
    if (rows.length === 0) {
      initialSelectionResolvedRef.current.videos = false;
      return;
    }
    if (viewScope === 'videos' && selectedVideoId) {
      initialSelectionResolvedRef.current.videos = true;
    }
  }, [rows.length, selectedVideoId, viewScope]);

  useEffect(() => {
    if (viewScope !== 'videos') return;
    if (selectedVideoId) return;
    if (initialSelectionResolvedRef.current.videos) return;
    const fallbackVideoId = resolveVideoId(rows[0]);
    if (!fallbackVideoId) return;
    initialSelectionResolvedRef.current.videos = true;
    applyScopeSelection('videos', {
      selectedKeys: [fallbackVideoId],
      anchorKey: fallbackVideoId,
      focusKey: fallbackVideoId,
      detailKey: fallbackVideoId,
    });
  }, [applyScopeSelection, rows, selectedVideoId, viewScope]);

  const hydrateProject = useCallback((args: {
    rows: any[];
    schema?: any[];
    fileName: string | null;
    visible?: string[];
    channelVisible?: string[];
    videoColumnWidths?: Record<string, number>;
    channelColumnWidths?: Record<string, number>;
    annotations?: Record<string, Annotation>;
    notesByVideoId?: Record<string, string>;
    channelNotesById?: Record<string, string>;
    channelTagsById?: Record<string, string[]>;
    savedViews?: SavedView[];
    activeViewId?: string | null;
    projectOverview?: string;
    projectNotes?: string;
    researchLogSectionComments?: Partial<Record<ResearchLogCommentSectionId, string>>;
    researchHistory?: ResearchHistoryEvent[];
    watchHistoryByVideoId?: Record<string, WatchHistoryEntry>;
    theme?: AppState['theme'];
    isRightPanelCollapsed?: boolean;
    deletedColumns?: string[];
    specialMappings?: Partial<SpecialMappings>;
    excludedVideoIds?: string[];
    excludedVideoMetaById?: Record<string, ExcludedVideoMeta>;
    inclusionView?: InclusionView;
    dashboardSnapshots?: Partial<Record<DashboardScope, DatasetDashboardSnapshot>>;
    savedViewDashboardSnapshots?: Record<string, SavedViewDashboardSnapshot>;
    savedViewsVersion?: number;
    channelMetadataSnapshot?: ChannelMetadataSnapshot | null;
    importedChannelMetadata?: ImportedChannelMetadataState | null;
    thumbnailCaches?: Record<string, DashboardThumbnailCacheSnapshot>;
    viewScope?: ViewScope;
    channelFilterModel?: ExplorerFilterModel;
    channelSnapshotShouldBeFresh?: boolean;
    autoExpandPanel?: boolean;
    sourceRegistry?: SourceRegistryState;
    sourceVisibility?: SourceVisibilityState;
    rowLineage?: RowLineageState;
    columnLineage?: ColumnLineageState;
    generatedMetadata?: GeneratedMetadataState;
    linkingState?: LinkingState;
    channelLinkingState?: ChannelLinkingState;
  }) => {
    const nextSourceRows = args.rows;
    const nextSourceSchema = applyFriendlyColumnMappings(args.schema || deriveSchemaFromRows(nextSourceRows), args.fileName || '');
    const nextDeletedColumns = args.deletedColumns ?? [];
    const nextWorkingSchema = stripDeletedColumnsFromSchema(nextSourceSchema, nextDeletedColumns);
    const nextSpecialMappings = { ...detectSpecialMappings(nextSourceSchema), ...(args.specialMappings || {}) };
    const rawAnnotations = args.annotations ?? extractAnnotationsFromRows(nextSourceRows, {});
    const annotations = stripTagsFromAnnotations(stripNotesFromAnnotations(rawAnnotations));
    const nextUserTagsByVideoId = extractUserTagsFromAnnotations(rawAnnotations);
    const nextNotesByVideoId = args.notesByVideoId ?? buildLegacyNotesFromAnnotations(rawAnnotations);
    const nextChannelNotesById = args.channelNotesById ?? {};
    const nextChannelTagsById = args.channelTagsById ?? {};
    const schemaColumnNames = nextWorkingSchema.map((column) => column.column_name);
    const defaultVideoVisibleColumns = getDefaultVideoVisibleColumns(nextWorkingSchema);
    const nextVisibleColumns = (args.visible?.length ? args.visible : defaultVideoVisibleColumns)
      .filter((column) => schemaColumnNames.includes(column) || column === USER_TAGS_COLUMN);
    const nextChannelVisibleColumns = args.channelVisible?.length
      ? args.channelVisible
      : (channelVisibleColumns.length ? channelVisibleColumns : []);
    const nextDatasetVersion = datasetVersion + 1;
    const nextFilteredVersion = filteredViewVersion + 1;
    const nextInclusionView = args.inclusionView ?? 'included';
    const nextExcludedVideoIds = normalizeVideoIds(
      args.excludedVideoIds ?? [],
      new Set(collectVideoIds(nextSourceRows)),
    );
    const nextVideoCorpusFingerprint = buildVideoCorpusFingerprint(nextSourceRows, nextSourceSchema);
    const nextExclusionMembershipFingerprint = buildExcludedMembershipFingerprint(nextExcludedVideoIds);
    const nextChannelMetadataCacheKey = buildChannelMetadataCacheKey({
      videoCorpusFingerprint: nextVideoCorpusFingerprint,
      exclusionMembershipFingerprint: nextExclusionMembershipFingerprint,
      inclusionView: nextInclusionView,
    });
    const nextDashboardSnapshots = args.dashboardSnapshots
      ? Object.fromEntries(Object.entries(args.dashboardSnapshots).map(([scope, snapshot]) => {
          if (!snapshot) return [scope, snapshot];
          return [scope, {
            ...snapshot,
            datasetVersionAtCalculation: nextDatasetVersion,
            filteredViewVersionAtCalculation: scope === 'filtered' ? nextFilteredVersion : undefined,
          }];
        })) as Partial<Record<DashboardScope, DatasetDashboardSnapshot>>
      : {};
    const nextSavedViewSnapshots = args.savedViewDashboardSnapshots
      ? Object.fromEntries(Object.entries(args.savedViewDashboardSnapshots).map(([id, snapshot]) => ([
          id,
          {
            ...snapshot,
            datasetVersionAtCalculation: nextDatasetVersion,
            savedViewsVersionAtCalculation: args.savedViewsVersion ?? snapshot.savedViewsVersionAtCalculation ?? 0,
          },
        ]))) as Record<string, SavedViewDashboardSnapshot>
      : {};
    let hydratedSessionCounter = thumbnailLoadTokenRef.current;
    const nextThumbnailCaches = args.thumbnailCaches
      ? Object.fromEntries(Object.entries(args.thumbnailCaches).map(([scopeKey, snapshot]) => {
          hydratedSessionCounter += 1;
          const fallbackSessionId = hydratedSessionCounter;
          const sessionId = Number.isFinite(snapshot.sessionId) ? Number(snapshot.sessionId) : fallbackSessionId;
          const entries = (snapshot.entries || []).map((entry) => {
            const normalizedIndex = Number.isFinite(entry.activeCandidateIndex)
              ? Number(entry.activeCandidateIndex)
              : Math.max(0, Number(entry.fallbackIndex ?? 0));
            return {
              ...entry,
              activeCandidateIndex: entry.activeUrl || entry.sourceUrl ? normalizedIndex : -1,
            };
          });
          return [
            scopeKey,
            {
              ...snapshot,
              sessionId,
              entries,
              datasetVersionAtCalculation: nextDatasetVersion,
              filteredViewVersionAtCalculation: scopeKey === FILTERED_TEMP_THUMBNAIL_SCOPE ? nextFilteredVersion : snapshot.filteredViewVersionAtCalculation,
              savedViewsVersionAtCalculation: isSavedViewThumbnailScopeKey(scopeKey)
                ? (args.savedViewsVersion ?? snapshot.savedViewsVersionAtCalculation ?? 0)
                : snapshot.savedViewsVersionAtCalculation,
            },
          ];
        })) as Record<string, DashboardThumbnailCacheSnapshot>
      : {};
    const nextChannelSnapshot = args.channelMetadataSnapshot
      ? {
          ...args.channelMetadataSnapshot,
          datasetVersionAtCalculation: args.channelSnapshotShouldBeFresh ? nextDatasetVersion : args.channelMetadataSnapshot.datasetVersionAtCalculation,
          inclusionViewAtCalculation: args.channelSnapshotShouldBeFresh
            ? nextInclusionView
            : args.channelMetadataSnapshot.inclusionViewAtCalculation,
          videoCorpusFingerprintAtCalculation: args.channelSnapshotShouldBeFresh
            ? nextVideoCorpusFingerprint
            : args.channelMetadataSnapshot.videoCorpusFingerprintAtCalculation,
          exclusionMembershipFingerprintAtCalculation: args.channelSnapshotShouldBeFresh
            ? nextExclusionMembershipFingerprint
            : args.channelMetadataSnapshot.exclusionMembershipFingerprintAtCalculation,
          cacheKeyAtCalculation: args.channelSnapshotShouldBeFresh
            ? nextChannelMetadataCacheKey
            : args.channelMetadataSnapshot.cacheKeyAtCalculation,
        }
      : null;
    const defaultSourceState = buildDefaultProjectSourceState({
      rows: nextSourceRows,
      schema: nextSourceSchema,
      fileName: args.fileName,
    });
    const nextRowLineage = args.rowLineage || defaultSourceState.rowLineage;
    const nextSourceRegistry = withSourceRegistryCounts({
      sourceRegistry: args.sourceRegistry || defaultSourceState.sourceRegistry,
      rowLineage: nextRowLineage,
      defaultRowCount: nextSourceRows.length,
    });
    const nextColumnLineage = ensureGeneratedColumnLineage(args.columnLineage || defaultSourceState.columnLineage);
    const nextSourceVisibility = reconcileSourceVisibility(
      args.sourceVisibility || defaultSourceState.sourceVisibility,
      nextSourceRegistry,
    );

    thumbnailLoadTokenRef.current += 1;
    setSourceRows(nextSourceRows);
    setSourceSchema(nextSourceSchema);
    setDeletedColumns(nextDeletedColumns);
    setSpecialMappings(nextSpecialMappings);
    setNotesByVideoId(nextNotesByVideoId);
    setChannelNotesById(nextChannelNotesById);
    setChannelTagsById(nextChannelTagsById);
    dispatchUserTags({ type: 'hydrate', state: nextUserTagsByVideoId });
    setVisibleColumns(nextVisibleColumns);
    setChannelVisibleColumns(nextChannelVisibleColumns);
    setVideoColumnWidths(args.videoColumnWidths ?? {});
    setChannelColumnWidths(args.channelColumnWidths ?? {});
    setExcludedVideoIds(nextExcludedVideoIds);
    setExcludedVideoMetaById(args.excludedVideoMetaById ?? {});
    setInclusionView(nextInclusionView);
    clearScopeSelection('videos', false);
    clearScopeSelection('channels', false);
    setIncludeExcludeUndoStack([]);
    setIncludeExcludeRedoStack([]);
    setFilterModel({});
    setChannelFilterModel(args.channelFilterModel ?? {});
    clearChannelDrilldownState({ restoreVideoFilters: false });
    setVideoScopeChannelKeys(null);
    setNavigationHistory([]);
    setNavigationCursor(-1);
    navigationRestoreInFlightRef.current = false;
    lastNavigationKeyRef.current = null;
    setDashboardActiveTab('overview');
    setDashboardSnapshots(nextDashboardSnapshots);
    setSavedViewDashboardSnapshots(nextSavedViewSnapshots);
    setThumbnailLoadProgress(null);
    setThumbnailCaches((current) => {
      (Object.values(current as Record<string, DashboardThumbnailCacheSnapshot>) as DashboardThumbnailCacheSnapshot[]).forEach((snapshot) => revokeThumbnailUrls(snapshot));
      return nextThumbnailCaches;
    });
    setChannelMetadataSnapshot(nextChannelSnapshot);
    setImportedChannelMetadata(args.importedChannelMetadata ?? null);
    setSourceRegistry(nextSourceRegistry);
    setSourceVisibility(nextSourceVisibility);
    setRowLineage(nextRowLineage);
    setColumnLineage(nextColumnLineage);
    setGeneratedMetadata(args.generatedMetadata ?? createEmptyGeneratedMetadata());
    setLinkingState(args.linkingState ?? createEmptyLinkingState());
    setChannelLinkingState(args.channelLinkingState ?? createEmptyChannelLinkingState());
    setViewScope(args.viewScope === 'channels' && nextChannelSnapshot?.rows?.length ? 'channels' : 'videos');
    setIsGeneratingChannelMetadata(false);
    setSavedViewsVersion(args.savedViewsVersion ?? 0);
    setResearchHistory(args.researchHistory ?? []);
    setWatchHistoryByVideoId(args.watchHistoryByVideoId ?? {});
    setDatasetVersion(nextDatasetVersion);
    setFilteredViewVersion(nextFilteredVersion);
    setState((previous) => ({
      ...previous,
      fileName: args.fileName,
      schema: nextWorkingSchema,
      savedViews: args.savedViews ?? previous.savedViews,
      activeViewId: args.activeViewId !== undefined ? args.activeViewId : previous.activeViewId,
      annotations,
      projectOverview: args.projectOverview ?? previous.projectOverview,
      projectNotes: cleanupAutoSeededResearchDiary(args.projectNotes ?? previous.projectNotes),
      researchLogSectionComments: args.researchLogSectionComments ?? previous.researchLogSectionComments,
      theme: args.theme ?? previous.theme,
      isRightPanelCollapsed: args.autoExpandPanel ? false : (args.isRightPanelCollapsed ?? previous.isRightPanelCollapsed),
    }));
  }, [channelVisibleColumns, datasetVersion, filteredViewVersion]);

  const attemptAutoRestoreLastProject = useCallback(async (trigger: 'mount' | 'pageshow') => {
    if (isAutoRestoreInFlightRef.current) {
      console.warn(`[autosave] Restore skipped (${trigger}): restore already in progress.`);
      return;
    }

    const currentRows = sourceRowsRef.current;
    const currentSchema = sourceSchemaRef.current;
    if (!shouldAttemptLastProjectRestore({ currentRowCount: currentRows.length, currentSchemaCount: currentSchema.length })) {
      console.warn(`[autosave] Restore skipped (${trigger}): dataset already loaded (${currentRows.length.toLocaleString()} rows).`);
      return;
    }

    isAutoRestoreInFlightRef.current = true;
    try {
      const autosavedSnapshot = await loadLastProjectAutosaveSnapshot();
      if (!autosavedSnapshot) {
        console.warn(`[autosave] Restore skipped (${trigger}): no autosave snapshot found.`);
        return;
      }

      const persistedState = latestPersistedStateRef.current ?? persisted;
      const mergedAnnotations = mergeAnnotationsWithUserTags(
        (persistedState?.annotations || {}) as Record<string, Annotation>,
        (persistedState?.userTagsByVideoId || {}) as Record<string, string[]>,
      );

      const sourceStateBase = buildDefaultProjectSourceState({
        rows: autosavedSnapshot.rows,
        schema: autosavedSnapshot.sourceSchema,
        fileName: autosavedSnapshot.fileName,
      });
      const nextRowLineage = persistedState?.rowLineage ?? sourceStateBase.rowLineage;
      const nextSourceRegistry = withSourceRegistryCounts({
        sourceRegistry: persistedState?.sourceRegistry ?? sourceStateBase.sourceRegistry,
        rowLineage: nextRowLineage,
        defaultRowCount: autosavedSnapshot.rows.length,
      });
      const nextSourceVisibility = reconcileSourceVisibility(
        persistedState?.sourceVisibility ?? sourceStateBase.sourceVisibility,
        nextSourceRegistry,
      );
      const preferredInclusion = persistedState?.inclusionView === 'excluded' ? 'excluded' : 'included';
      const counts = computeSourceVisibilityInclusionCounts({
        rows: autosavedSnapshot.rows,
        rowLineage: nextRowLineage,
        sourceVisibility: nextSourceVisibility,
        excludedVideoIds: persistedState?.excludedVideoIds ?? [],
      });
      const recoveredInclusion = resolveRecoverableInclusionView({
        preferred: preferredInclusion,
        ...counts,
      });
      if (recoveredInclusion !== preferredInclusion) {
        console.warn(
          `[autosave] Restore (${trigger}) switched inclusion view to "${recoveredInclusion}" because ` +
          `${preferredInclusion} had no visible rows.`,
        );
      }

      hydrateProject({
        rows: autosavedSnapshot.rows,
        schema: autosavedSnapshot.sourceSchema,
        fileName: autosavedSnapshot.fileName || undefined,
        visible: persistedState?.visibleColumns,
        channelVisible: persistedState?.channelVisibleColumns,
        videoColumnWidths: persistedState?.videoColumnWidths,
        channelColumnWidths: persistedState?.channelColumnWidths,
        annotations: mergedAnnotations,
        notesByVideoId: persistedState?.notesByVideoId,
        channelNotesById: persistedState?.channelNotesById,
        channelTagsById: persistedState?.channelTagsById,
        savedViews: persistedState?.savedViews,
        activeViewId: persistedState?.activeViewId,
        projectOverview: persistedState?.projectOverview,
        projectNotes: persistedState?.projectNotes,
        researchLogSectionComments: persistedState?.researchLogSectionComments,
        researchHistory: persistedState?.researchHistory,
        watchHistoryByVideoId: persistedState?.watchHistoryByVideoId,
        theme: persistedState?.theme,
        isRightPanelCollapsed: persistedState?.isRightPanelCollapsed,
        deletedColumns: persistedState?.deletedColumns,
        specialMappings: persistedState?.specialMappings,
        excludedVideoIds: persistedState?.excludedVideoIds,
        excludedVideoMetaById: persistedState?.excludedVideoMetaById,
        inclusionView: recoveredInclusion,
        dashboardSnapshots: persistedState?.dashboardSnapshots,
        savedViewDashboardSnapshots: persistedState?.savedViewDashboardSnapshots,
        savedViewsVersion: persistedState?.savedViewsVersion ?? 0,
        channelMetadataSnapshot: persistedState?.channelMetadataSnapshot ?? null,
        importedChannelMetadata: persistedState?.importedChannelMetadata ?? null,
        viewScope: persistedState?.viewScope === 'channels' ? 'channels' : 'videos',
        channelFilterModel: persistedState?.channelFilterModel ?? {},
        sourceRegistry: nextSourceRegistry,
        sourceVisibility: nextSourceVisibility,
        rowLineage: nextRowLineage,
        columnLineage: persistedState?.columnLineage ?? sourceStateBase.columnLineage,
        generatedMetadata: persistedState?.generatedMetadata ?? createEmptyGeneratedMetadata(),
        linkingState: persistedState?.linkingState ?? createEmptyLinkingState(),
        channelLinkingState: persistedState?.channelLinkingState ?? createEmptyChannelLinkingState(),
      });
      console.warn(`[autosave] Restore completed (${trigger}) from snapshot saved at ${autosavedSnapshot.savedAt}.`);
    } catch (error) {
      console.warn(`[autosave] Restore failed (${trigger}).`, error);
    } finally {
      isAutoRestoreInFlightRef.current = false;
    }
  }, [hydrateProject, persisted]);

  useEffect(() => {
    const mountRaf = window.requestAnimationFrame(() => {
      void attemptAutoRestoreLastProject('mount');
    });
    const handlePageShow = () => {
      window.requestAnimationFrame(() => {
        void attemptAutoRestoreLastProject('pageshow');
      });
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.cancelAnimationFrame(mountRaf);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [attemptAutoRestoreLastProject]);

  const restoreThumbnailCachesFromArchive = useCallback((
    manifest: ProjectArchiveManifest,
    archiveFiles: Record<string, Uint8Array>,
  ): Record<string, DashboardThumbnailCacheSnapshot> => {
    const index = manifest.thumbnailCacheIndex;
    if (!index?.scopes) return {};

    const restored: Record<string, DashboardThumbnailCacheSnapshot> = {};
    (Object.entries(index.scopes) as Array<[string, DashboardThumbnailCacheIndex['scopes'][string]]>).forEach(([scopeKey, scopeIndex]) => {
      if (!isPersistentThumbnailScopeKey(scopeKey)) return;
      const entries: DashboardThumbnailCacheSnapshot['entries'] = scopeIndex.entries.map((entry) => {
        const sourceUrl = String(entry.sourceUrl || '').trim();
        const candidateUrls = sourceUrl ? [sourceUrl] : [];
        const activeCandidateIndex = sourceUrl ? 0 : -1;
        if (entry.status !== 'loaded' || !entry.fileName) {
          return {
            ...entry,
            sourceUrl,
            candidateUrls,
            activeUrl: sourceUrl,
            fallbackIndex: activeCandidateIndex,
            activeCandidateIndex,
            status: 'failed' as const,
          };
        }
        const fileBytes = getArchiveEntry(archiveFiles, entry.fileName);
        if (!fileBytes || fileBytes.length === 0) {
          return {
            ...entry,
            sourceUrl,
            candidateUrls,
            activeUrl: sourceUrl,
            fallbackIndex: activeCandidateIndex,
            activeCandidateIndex,
            status: 'failed' as const,
            error: entry.error || 'Binary thumbnail payload missing from archive.',
          };
        }
        const bytes = new Uint8Array(fileBytes);
        return {
          ...entry,
          sourceUrl,
          candidateUrls,
          activeUrl: sourceUrl,
          fallbackIndex: activeCandidateIndex,
          activeCandidateIndex,
          status: 'loaded' as const,
          bytes,
          byteLength: bytes.length,
          objectUrl: createObjectUrl(bytes, entry.mimeType || 'image/jpeg'),
        };
      });

      restored[scopeKey] = {
        scopeKey,
        label: scopeIndex.label || resolveThumbnailCacheLabel(scopeKey),
        sessionId: 0,
        rowCount: scopeIndex.rowCount ?? entries.length,
        totalCandidates: scopeIndex.totalCandidates ?? entries.length,
        calculatedAt: scopeIndex.calculatedAt || new Date().toISOString(),
        datasetVersionAtCalculation: scopeIndex.datasetVersionAtCalculation ?? 0,
        savedViewsVersionAtCalculation: scopeIndex.savedViewsVersionAtCalculation,
        sortSignature: scopeIndex.sortSignature,
        entries,
      };
    });

    return restored;
  }, []);

  const restoreProjectBackup = useCallback(async (file: File) => {
    try {
      setIsLoadingRows(true);
      updateLongTaskProgress({
        title: 'Restoring project backup',
        detail: `Reading ${file.name}`,
        completed: 0,
        total: 100,
      });
      const archiveBuffer = await readFileBufferWithProgress(file, (completed, total) => {
        updateLongTaskProgress({
          title: 'Restoring project backup',
          detail: `Reading ${file.name}`,
          completed: Math.min(30, Math.round((completed / Math.max(total, 1)) * 30)),
          total: 100,
        });
      });
      updateLongTaskProgress({
        title: 'Restoring project backup',
        detail: 'Unpacking archive files',
        completed: 35,
        total: 100,
      });
      await waitForNextPaint();
      const archiveFiles = readStoredZip(archiveBuffer);
      const manifestBytes = getArchiveEntry(archiveFiles, 'project.json');
      const dataBytes = getArchiveEntry(archiveFiles, 'data.csv');
      if (!manifestBytes || !dataBytes) throw new Error('This backup is missing project.json or data.csv.');

      const manifest = JSON.parse(decodeTextFile(manifestBytes)) as ProjectArchiveManifest;
      if (manifest.version !== 10) {
        throw new Error(`Unsupported project archive version ${manifest.version}. This build only imports version 10 archives.`);
      }
      const noteFiles = extractNotesFromArchive(archiveFiles);
      const restoredThumbnailCaches = restoreThumbnailCachesFromArchive(manifest, archiveFiles);
      updateLongTaskProgress({
        title: 'Restoring project backup',
        detail: 'Parsing archived dataset',
        completed: 55,
        total: 100,
        indeterminate: true,
      });
      await waitForNextPaint();
      const dataBuffer = dataBytes.buffer.slice(dataBytes.byteOffset, dataBytes.byteOffset + dataBytes.byteLength);
      const parsed = await readCSVBuffer(manifest.originalFileName || 'restored_project.csv', dataBuffer);
      updateLongTaskProgress({
        title: 'Restoring project backup',
        detail: 'Rebuilding project state',
        completed: 82,
        total: 100,
      });
      await waitForNextPaint();
      hydrateProject({
        rows: parsed.rows,
        schema: manifest.sourceSchema || parsed.schema,
        fileName: manifest.originalFileName || 'restored_project.csv',
        visible: manifest.visibleColumns,
        channelVisible: manifest.channelVisibleColumns,
        videoColumnWidths: manifest.videoColumnWidths,
        channelColumnWidths: manifest.channelColumnWidths,
        annotations: manifest.annotations,
        notesByVideoId: Object.keys(noteFiles).length > 0 ? noteFiles : buildLegacyNotesFromAnnotations(manifest.annotations),
        channelNotesById: manifest.channelNotesById ?? {},
        channelTagsById: manifest.channelTagsById ?? {},
        savedViews: manifest.savedViews,
        activeViewId: manifest.activeViewId,
        projectOverview: manifest.projectOverview,
        projectNotes: manifest.projectNotes,
        researchLogSectionComments: manifest.researchLogSectionComments,
        researchHistory: manifest.researchHistory,
        watchHistoryByVideoId: manifest.watchHistoryByVideoId,
        theme: manifest.uiState?.theme,
        isRightPanelCollapsed: manifest.uiState?.isRightPanelCollapsed,
        deletedColumns: manifest.deletedColumns,
        specialMappings: manifest.specialMappings,
        excludedVideoIds: manifest.excluded_videos,
        excludedVideoMetaById: manifest.excludedVideoMetaById,
        inclusionView: 'included',
        dashboardSnapshots: manifest.dashboardSnapshots,
        savedViewDashboardSnapshots: manifest.savedViewDashboardSnapshots,
        savedViewsVersion: manifest.savedViewsVersion ?? 0,
        channelMetadataSnapshot: manifest.channelMetadataSnapshot ?? null,
        importedChannelMetadata: manifest.importedChannelMetadata ?? null,
        thumbnailCaches: restoredThumbnailCaches,
        viewScope: manifest.viewScope === 'channels' ? 'channels' : 'videos',
        channelSnapshotShouldBeFresh: true,
        sourceRegistry: manifest.sourceRegistry ?? createEmptySourceRegistry(),
        sourceVisibility: manifest.sourceVisibility ?? createEmptySourceVisibility(),
        rowLineage: manifest.rowLineage ?? createEmptyRowLineage(),
        columnLineage: manifest.columnLineage ?? createEmptyColumnLineage(),
        generatedMetadata: manifest.generatedMetadata ?? createEmptyGeneratedMetadata(),
        linkingState: manifest.linkingState ?? createEmptyLinkingState(),
        channelLinkingState: manifest.channelLinkingState ?? createEmptyChannelLinkingState(),
      });
    } catch (error) {
      console.error('Failed to restore backup:', error);
    } finally {
      updateLongTaskProgress(null);
      setIsLoadingRows(false);
    }
  }, [hydrateProject, readCSVBuffer, restoreThumbnailCachesFromArchive, updateLongTaskProgress]);

  const handleFileUpload = useCallback(async (file: File) => {
    if (file.name.toLowerCase().endsWith('.zip')) {
      await restoreProjectBackup(file);
      return;
    }

    try {
      setImportError(null);
      setIsLoadingRows(true);
      updateLongTaskProgress({
        title: 'Preparing CSV import',
        detail: `Reading ${file.name}`,
        completed: 0,
        total: 100,
      });
      const buffer = await readFileBufferWithProgress(file, (completed, total) => {
        updateLongTaskProgress({
          title: 'Preparing CSV import',
          detail: `Reading ${file.name}`,
          completed: Math.min(40, Math.round((completed / Math.max(total, 1)) * 40)),
          total: 100,
        });
      });
      updateLongTaskProgress({
        title: 'Preparing CSV import',
        detail: 'Parsing rows and inferring columns',
        completed: 50,
        total: 100,
        indeterminate: true,
      });
      await waitForNextPaint();
      const { schema, rows: parsedRows } = await readCSVBuffer(file.name, buffer);
      const decoratedSchema = applyFriendlyColumnMappings(schema, file.name);
      updateLongTaskProgress({
        title: 'Preparing CSV import',
        detail: `Loaded ${parsedRows.length.toLocaleString()} rows`,
        completed: 100,
        total: 100,
      });
      setPendingFile(file);
      setPendingSchema(decoratedSchema);
      setPendingRows(parsedRows);
      setIsImportOpen(true);
    } catch (error) {
      console.error('Failed to read CSV:', error);
    } finally {
      updateLongTaskProgress(null);
      setIsLoadingRows(false);
    }
  }, [readCSVBuffer, restoreProjectBackup, updateLongTaskProgress]);

  const handleImportConfirm = useCallback(async ({ options, incomingRows }: ImportSubmission) => {
    if (!pendingFile) return;
    try {
      setImportError(null);
      setIsImportSubmitting(true);
      setIsLoadingRows(true);
      const progressTitle = options.importKind === 'channelMetadata'
        ? 'Merging channel metadata'
        : (options.mode === 'replace' || sourceRows.length === 0 ? 'Importing CSV' : 'Merging CSV');
      updateLongTaskProgress({
        title: progressTitle,
        detail: 'Preparing import settings',
        completed: 1,
        total: 5,
      });
      await waitForNextPaint();
      const autoMappings: Partial<SpecialMappings> = {
        ...detectSpecialMappings(pendingSchema),
        ...(options.specialMappings || {}),
      };

      if (options.importKind === 'channelMetadata') {
        if (!sourceRows.length) {
          throw new Error('Import a video dataset before merging channel metadata.');
        }
        const relationshipType = options.channelMetadataRelationship || 'channelId';
        updateLongTaskProgress({
          title: progressTitle,
          detail: 'Matching imported channel rows to existing channels',
          completed: 2,
          total: 5,
          indeterminate: true,
        });
        await waitForNextPaint();
        const mergeResult = buildImportedChannelMetadataState({
          existingVideoRows: sourceRows,
          incomingRows,
          incomingSchema: pendingSchema,
          relationshipType,
          sourceFileName: pendingFile.name,
          previousState: importedChannelMetadata,
        });
        const nextImportedState = mergeResult.state;
        updateLongTaskProgress({
          title: progressTitle,
          detail: 'Rebuilding the channel table',
          completed: 3,
          total: 5,
          indeterminate: true,
        });
        await waitForNextPaint();
        const nextChannelRows = buildChannelMetadataRows(activeBaseRows, nextImportedState);
        setImportedChannelMetadata(nextImportedState);
        setChannelMetadataSnapshot({
          rows: nextChannelRows,
          calculatedAt: new Date().toISOString(),
          datasetVersionAtCalculation: datasetVersion,
          inclusionViewAtCalculation: inclusionView,
          videoCorpusFingerprintAtCalculation: videoCorpusFingerprint,
          exclusionMembershipFingerprintAtCalculation: exclusionMembershipFingerprint,
          cacheKeyAtCalculation: currentChannelMetadataCacheKey,
        });
        setChannelFilterModel({});
        setSourceRegistry((current) => {
          const sourceId = buildSourceId('source/enrichment', pendingFile.name);
          const next: SourceRegistryState = {
            ...current,
            byId: {
              ...current.byId,
              [sourceId]: {
                id: sourceId,
                label: pendingFile.name,
                kind: 'enrichment',
                rowCount: incomingRows.length,
                contributedColumns: pendingSchema.map((column) => column.column_name),
                createdAt: new Date().toISOString(),
              },
            },
            orderedIds: joinUnique([...current.orderedIds, sourceId]),
          };
          return next;
        });
        setChannelLinkingState((current) => ({
          ...current,
          stale: true,
          staleReason: 'Channel metadata merge changed channel table. Refresh channel metadata to rebuild linking aggregates.',
        }));
        appendResearchHistory({
          type: 'import_merge_completed',
          summary: `Merged channel metadata from ${pendingFile.name}: ${mergeResult.updatedCount.toLocaleString()} matched / updated, ${mergeResult.skippedCount.toLocaleString()} skipped.`,
          details: `Relationship: ${relationshipType === 'channelId' ? 'channelId → channelId' : 'normalized channel title'}; matched on ${mergeResult.relationshipColumn || 'n/a'}.`,
        });
      } else if (options.mode === 'replace' || sourceRows.length === 0) {
        updateLongTaskProgress({
          title: progressTitle,
          detail: 'Applying mapped support fields',
          completed: 2,
          total: 5,
          indeterminate: true,
        });
        await waitForNextPaint();
        const preparedRows = applySupportMappings(incomingRows, autoMappings);
        updateLongTaskProgress({
          title: progressTitle,
          detail: 'Deriving column schema',
          completed: 3,
          total: 5,
          indeterminate: true,
        });
        await waitForNextPaint();
        const preparedSchema = deriveSchemaFromRows(preparedRows, pendingSchema);
        const isFirstDataset = sourceRows.length === 0;
        updateLongTaskProgress({
          title: progressTitle,
          detail: 'Rebuilding project state',
          completed: 4,
          total: 5,
        });
        await waitForNextPaint();
        hydrateProject({
          rows: preparedRows,
          schema: preparedSchema,
          fileName: pendingFile.name,
          visible: options.selectedColumns,
          annotations: extractAnnotationsFromRows(preparedRows, {}),
          notesByVideoId: {},
          channelNotesById: {},
          channelTagsById: {},
          savedViews: [],
          activeViewId: null,
          projectOverview: state.projectOverview,
          projectNotes: state.projectNotes,
          researchLogSectionComments: state.researchLogSectionComments,
          researchHistory: [],
          watchHistoryByVideoId: {},
          specialMappings: autoMappings,
          excludedVideoIds: [],
          excludedVideoMetaById: {},
          inclusionView: 'included',
          savedViewDashboardSnapshots: {},
          savedViewsVersion: 0,
          channelMetadataSnapshot: null,
          importedChannelMetadata: null,
          viewScope: 'videos',
          autoExpandPanel: isFirstDataset,
          generatedMetadata: createEmptyGeneratedMetadata(),
          linkingState: {
            ...createEmptyLinkingState(),
            sourceCandidateProfiles: profileLinkingColumnCandidates(preparedRows),
          },
          channelLinkingState: createEmptyChannelLinkingState(),
        });
        appendResearchHistory({
          type: 'import_replace_completed',
          summary: `Imported ${preparedRows.length.toLocaleString()} rows by replacing the current project with ${pendingFile.name}.`,
        });
        if (autoMappings.transcriptColumn || autoMappings.descriptionColumn || autoMappings.tagColumn) {
          appendResearchHistory({
            type: 'special_mapping_updated',
            summary: 'Special field mappings updated during import.',
            details: `Transcript: ${autoMappings.transcriptColumn || 'unmapped'}; Description: ${autoMappings.descriptionColumn || 'unmapped'}; Tags: ${autoMappings.tagColumn || 'unmapped'}.`,
          });
        }
      } else {
        updateLongTaskProgress({
          title: progressTitle,
          detail: 'Applying merge rules and resolving conflicts',
          completed: 2,
          total: 5,
          indeterminate: true,
        });
        await waitForNextPaint();
        const mergeResult = applyMerge({
          existingRows: sourceRows,
          incomingRows,
          existingSchema: sourceSchema,
          incomingSchema: pendingSchema,
          joinColumn: options.joinColumn,
          incomingJoinColumn: options.incomingJoinColumn,
          mergeOptions: options.mergeOptions!,
        });
        updateLongTaskProgress({
          title: progressTitle,
          detail: 'Updating row lineage and source metadata',
          completed: 3,
          total: 5,
          indeterminate: true,
        });
        await waitForNextPaint();
        const sourceStateBase = sourceRegistry.orderedIds.length
          ? {
              sourceRegistry,
              rowLineage,
              columnLineage,
              sourceVisibility,
            }
          : buildDefaultProjectSourceState({
              rows: sourceRows,
              schema: sourceSchema.length ? sourceSchema : deriveSchemaFromRows(sourceRows),
              fileName: state.fileName || 'dataset.csv',
            });
        const now = new Date().toISOString();
        const incomingSourceId = buildSourceId('source/enrichment', pendingFile.name);
        const joinColumn = options.joinColumn || 'videoId';
        const incomingJoinColumn = options.incomingJoinColumn || joinColumn;
        const existingByJoin = new Map<string, RowLineageState['byRowId'][string]>();
        const existingByVideoId = new Map<string, RowLineageState['byRowId'][string]>();
        sourceRows.forEach((row, index) => {
          const rowId = resolveRowLineageKey(row, index);
          const lineageEntry = sourceStateBase.rowLineage.byRowId[rowId];
          if (lineageEntry) {
            const joinKey = normalizeJoinKey(row?.[joinColumn]);
            if (joinKey) existingByJoin.set(joinKey, lineageEntry);
            const videoId = resolveVideoId(row);
            if (videoId) existingByVideoId.set(videoId, lineageEntry);
          }
        });
        const incomingJoinKeys = new Set(
          incomingRows
            .map((row) => normalizeJoinKey(row?.[incomingJoinColumn]))
            .filter(Boolean),
        );
        const nextRowLineageByRowId: RowLineageState['byRowId'] = {};
        mergeResult.rows.forEach((row, index) => {
          const rowId = resolveRowLineageKey(row, index);
          const joinKey = normalizeJoinKey(row?.[joinColumn]);
          const existingLineage = (joinKey && existingByJoin.get(joinKey))
            || (resolveVideoId(row) ? existingByVideoId.get(resolveVideoId(row) as string) : undefined);
          if (existingLineage) {
            nextRowLineageByRowId[rowId] = {
              rowId,
              baseSourceId: existingLineage.baseSourceId,
              contributorSourceIds: joinUnique([
                ...(existingLineage.contributorSourceIds || []),
                ...(joinKey && incomingJoinKeys.has(joinKey) ? [incomingSourceId] : []),
              ]),
            };
            return;
          }
          nextRowLineageByRowId[rowId] = {
            rowId,
            baseSourceId: incomingSourceId,
            contributorSourceIds: [incomingSourceId],
          };
        });
        const nextRowLineage: RowLineageState = { byRowId: nextRowLineageByRowId };
        const nextSourceRegistry = withSourceRegistryCounts({
          sourceRegistry: {
            byId: {
              ...sourceStateBase.sourceRegistry.byId,
              [incomingSourceId]: {
                id: incomingSourceId,
                label: pendingFile.name,
                kind: 'enrichment',
                rowCount: incomingRows.length,
                contributedColumns: pendingSchema.map((column) => column.column_name),
                createdAt: now,
              },
              [GENERATED_SOURCE_ID]: sourceStateBase.sourceRegistry.byId[GENERATED_SOURCE_ID] || {
                id: GENERATED_SOURCE_ID,
                label: 'Generated metadata',
                kind: 'generated',
                rowCount: 0,
                contributedColumns: ['content_intent', ...LINKING_GENERATED_COLUMNS],
                createdAt: now,
              },
            },
            orderedIds: joinUnique([
              ...sourceStateBase.sourceRegistry.orderedIds,
              incomingSourceId,
              GENERATED_SOURCE_ID,
            ]),
            primarySourceId: sourceStateBase.sourceRegistry.primarySourceId || incomingSourceId,
          },
          rowLineage: nextRowLineage,
          defaultRowCount: mergeResult.rows.length,
        });
        const nextColumnLineage = ensureGeneratedColumnLineage({
          byColumn: Object.fromEntries(
            mergeResult.schema.map((column) => {
              const previous = sourceStateBase.columnLineage.byColumn[column.column_name];
              if (previous) return [column.column_name, previous];
              return [column.column_name, {
                column: column.column_name,
                sourceId: incomingSourceId,
                generated: false,
                scope: 'videos',
              }];
            }),
          ),
        });
        const nextSourceVisibility = reconcileSourceVisibility(sourceStateBase.sourceVisibility, nextSourceRegistry);
        updateLongTaskProgress({
          title: progressTitle,
          detail: 'Rebuilding project state',
          completed: 4,
          total: 5,
        });
        await waitForNextPaint();
        const nextLinkingState: LinkingState = {
          ...linkingState,
          stale: true,
          staleReason: 'Source rows changed after merge. Refresh linking summary.',
          sourceCandidateProfiles: profileLinkingColumnCandidates(mergeResult.rows),
        };
        const nextChannelLinkingState: ChannelLinkingState = {
          ...channelLinkingState,
          stale: true,
          staleReason: 'Source rows changed after merge. Refresh channel metadata to rebuild link aggregates.',
        };
        hydrateProject({
          rows: mergeResult.rows,
          schema: mergeResult.schema,
          fileName: state.fileName || pendingFile.name,
          visible: options.selectedColumns,
          videoColumnWidths,
          channelColumnWidths,
          annotations: extractAnnotationsFromRows(mergeResult.rows, mergeAnnotationsWithUserTags(state.annotations, userTagsByVideoId)),
          notesByVideoId,
          channelNotesById,
          channelTagsById,
          savedViews: state.savedViews,
          activeViewId: state.activeViewId,
          projectOverview: state.projectOverview,
          projectNotes: state.projectNotes,
          researchLogSectionComments: state.researchLogSectionComments,
          researchHistory,
          watchHistoryByVideoId,
          specialMappings: options.mergeOptions?.specialMappings || specialMappings,
          deletedColumns,
          excludedVideoIds,
          excludedVideoMetaById,
          inclusionView,
          savedViewDashboardSnapshots,
          savedViewsVersion,
          channelMetadataSnapshot: null,
          importedChannelMetadata,
          viewScope,
          sourceRegistry: nextSourceRegistry,
          sourceVisibility: nextSourceVisibility,
          rowLineage: nextRowLineage,
          columnLineage: nextColumnLineage,
          generatedMetadata,
          linkingState: nextLinkingState,
          channelLinkingState: nextChannelLinkingState,
        });
        appendResearchHistory({
          type: 'import_merge_completed',
          summary: `Merged ${incomingRows.length.toLocaleString()} incoming rows into ${sourceRows.length.toLocaleString()} existing rows.`,
          details: `Project key: ${options.joinColumn || 'n/a'}; incoming key: ${options.incomingJoinColumn || options.joinColumn || 'n/a'}; mode: ${options.mergeOptions?.mergeMode || 'add-update'}.`,
        });
        const mergeMappings = options.mergeOptions?.specialMappings || {};
        if (mergeMappings.transcriptColumn || mergeMappings.descriptionColumn || mergeMappings.tagColumn) {
          appendResearchHistory({
            type: 'special_mapping_updated',
            summary: 'Special field mappings updated during merge.',
            details: `Transcript: ${mergeMappings.transcriptColumn || 'unmapped'}; Description: ${mergeMappings.descriptionColumn || 'unmapped'}; Tags: ${mergeMappings.tagColumn || 'unmapped'}.`,
          });
        }
      }
      updateLongTaskProgress({
        title: progressTitle,
        detail: 'Finishing import',
        completed: 5,
        total: 5,
      });
      await waitForNextPaint();
      setIsImportOpen(false);
      setPendingFile(null);
      setPendingRows([]);
      setPendingSchema([]);
    } catch (error) {
      console.error('Failed to import/merge CSV:', error);
      setImportError(error instanceof Error ? error.message : 'Failed to import or merge the CSV. Please try again.');
    } finally {
      updateLongTaskProgress(null);
      setIsImportSubmitting(false);
      setIsLoadingRows(false);
    }
  }, [
    pendingFile,
    pendingSchema,
    sourceRows,
    sourceSchema,
    activeBaseRows,
    specialMappings,
    importedChannelMetadata,
    hydrateProject,
    appendResearchHistory,
    state.annotations,
    userTagsByVideoId,
    state.fileName,
    state.projectOverview,
    state.projectNotes,
    state.researchLogSectionComments,
    state.savedViews,
    state.activeViewId,
    visibleColumns,
    deletedColumns,
    sourceRegistry,
    sourceVisibility,
    rowLineage,
    columnLineage,
    generatedMetadata,
    linkingState,
    channelLinkingState,
    updateLongTaskProgress,
    notesByVideoId,
    excludedVideoIds,
    excludedVideoMetaById,
    inclusionView,
    researchHistory,
    watchHistoryByVideoId,
    savedViewDashboardSnapshots,
    savedViewsVersion,
    viewScope,
    datasetVersion,
    inclusionView,
  ]);

  const applyIncludeExcludeAction = useCallback((videoIds: string[], targetKind?: IncludeExcludeAction['kind'], options?: {
    skipUndo?: boolean;
    reason?: string;
    preserveRedo?: boolean;
    scope?: ViewScope;
    selectionMode?: 'manual' | 'filtered_bulk';
    filterSummary?: string;
    selectedRows?: any[];
  }) => {
    const normalizedVideoIds = normalizeVideoIds(videoIds, sourceVideoIdSet);
    if (normalizedVideoIds.length === 0) return;

    const nextActionKind = targetKind ?? (inclusionView === 'included' ? 'exclude' : 'restore');
    const actionScope = options?.scope || viewScope;
    const selectionMode = options?.selectionMode || 'manual';
    const normalizedFilterSummary = String(options?.filterSummary || '').trim();
    const selectedRows = (() => {
      if (Array.isArray(options?.selectedRows) && options.selectedRows.length) return options.selectedRows;
      return normalizedVideoIds
        .map((videoId) => sourceMaskedRowByVideoId.get(videoId))
        .filter((row): row is any => Boolean(row));
    })();
    const manualSelectionLabels = nextActionKind === 'exclude' && selectionMode === 'manual'
      ? buildAlphabetizedVideoTitleChannelList(selectedRows)
      : [];
    const restoredFilteredBulkMeta = nextActionKind === 'restore'
      ? normalizedVideoIds
          .map((videoId) => excludedVideoMetaById[videoId])
          .filter((meta): meta is ExcludedVideoMeta => Boolean(meta?.exclusionMode === 'filtered_bulk'))
      : [];
    const eventId = !options?.skipUndo ? createHistoryId('exclusion') : undefined;
    clearAllThumbnailCaches();

    flushSync(() => {
      clearScopeSelection('videos', true);
      clearScopeSelection('channels', true);
    });

    startFilterTransition(() => {
      setExcludedVideoIds((current) => {
        const currentSet = new Set(current);
        normalizedVideoIds.forEach((videoId) => {
          if (nextActionKind === 'exclude') currentSet.add(videoId);
          else currentSet.delete(videoId);
        });
        return Array.from(currentSet);
      });

      setExcludedVideoMetaById((current) => {
        const next = { ...current };
        const now = new Date().toISOString();
        normalizedVideoIds.forEach((videoId) => {
          if (nextActionKind === 'exclude') {
            next[videoId] = {
              videoId,
              reason: options?.reason,
              excludedAt: now,
              restoredAt: null,
              exclusionMode: selectionMode,
              exclusionScope: actionScope,
              exclusionFilterSummary: selectionMode === 'filtered_bulk' ? normalizedFilterSummary : undefined,
            };
          } else if (next[videoId]) {
            next[videoId] = {
              ...next[videoId],
              restoredAt: now,
            };
          }
        });
        return next;
      });

      if (!options?.skipUndo) {
        setIncludeExcludeUndoStack((current) => [...current, {
          kind: nextActionKind,
          videoIds: normalizedVideoIds,
          scope: actionScope,
          selectionMode,
          filterSummary: normalizedFilterSummary || undefined,
          historyEventId: eventId,
        }]);
        if (!options?.preserveRedo) {
          setIncludeExcludeRedoStack([]);
        }
        const details: string[] = [];
        if (options?.reason?.trim()) details.push(`Reason: ${options.reason.trim()}`);
        if (nextActionKind === 'exclude' && selectionMode === 'filtered_bulk' && normalizedFilterSummary) {
          details.push(`Filter context: ${normalizedFilterSummary}`);
        }
        if (nextActionKind === 'exclude' && selectionMode === 'manual' && manualSelectionLabels.length) {
          details.push('Manually selected rows (alphabetical Title — Channel):');
          manualSelectionLabels.forEach((label) => details.push(`- ${label}`));
        }
        if (nextActionKind === 'restore' && restoredFilteredBulkMeta.length) {
          details.push(`Exception to prior filter logic: restored ${restoredFilteredBulkMeta.length.toLocaleString()} row(s) previously excluded by exclude-all filtered action(s).`);
          const uniqueFilterSummaries = Array.from(new Set(
            restoredFilteredBulkMeta
              .map((meta) => String(meta.exclusionFilterSummary || '').trim())
              .filter(Boolean),
          ));
          if (uniqueFilterSummaries.length) {
            details.push(`Original filter context: ${uniqueFilterSummaries.join(' | ')}`);
          }
        }
        appendResearchHistory({
          id: eventId,
          type: nextActionKind === 'exclude' ? 'videos_excluded' : 'videos_restored',
          createdAt: new Date().toISOString(),
          summary: `${nextActionKind === 'exclude' ? 'Excluded' : 'Restored'} ${normalizedVideoIds.length.toLocaleString()} video(s).`,
          affectedIds: normalizedVideoIds,
          details: details.length ? details.join('\n') : undefined,
          meta: {
            scope: actionScope,
            selectionMode,
            filterSummary: normalizedFilterSummary || undefined,
            count: normalizedVideoIds.length,
          },
        });
      }

      setDatasetVersion((version) => version + 1);
      setFilteredViewVersion((version) => version + 1);
    });
  }, [appendResearchHistory, clearAllThumbnailCaches, excludedVideoMetaById, inclusionView, sourceMaskedRowByVideoId, sourceVideoIdSet, startFilterTransition, viewScope]);

  const handleMoveVideos = useCallback((videoIds: string[]) => {
    applyIncludeExcludeAction(videoIds);
  }, [applyIncludeExcludeAction]);

  const handleMoveSelectedVideos = useCallback(() => {
    const nextVideoIds = selectedVideoIdsForActions;
    if (nextVideoIds.length === 0) return;
    const targetKind: IncludeExcludeAction['kind'] = inclusionView === 'included' ? 'exclude' : 'restore';
    applyIncludeExcludeAction(nextVideoIds, targetKind, {
      scope: 'videos',
      selectionMode: targetKind === 'exclude' && areAllFilteredVideosSelectedForAction ? 'filtered_bulk' : 'manual',
      filterSummary: summarizeFilterModel(filterModel),
      selectedRows: selectedRowsForBatchCopy,
    });
  }, [applyIncludeExcludeAction, areAllFilteredVideosSelectedForAction, filterModel, inclusionView, selectedRowsForBatchCopy, selectedVideoIdsForActions]);

  const handleExcludeSelectedVideos = useCallback(() => {
    const nextVideoIds = selectedVideoIdsForActions;
    if (nextVideoIds.length === 0) return;
    applyIncludeExcludeAction(nextVideoIds, 'exclude', {
      scope: 'videos',
      selectionMode: areAllFilteredVideosSelectedForAction ? 'filtered_bulk' : 'manual',
      filterSummary: summarizeFilterModel(filterModel),
      selectedRows: selectedRowsForBatchCopy,
    });
  }, [applyIncludeExcludeAction, areAllFilteredVideosSelectedForAction, filterModel, selectedRowsForBatchCopy, selectedVideoIdsForActions]);

  const handleUndoIncludeExclude = useCallback(() => {
    const lastAction = includeExcludeUndoStack[includeExcludeUndoStack.length - 1];
    if (!lastAction) return;

    setIncludeExcludeUndoStack((current) => current.slice(0, -1));
    setIncludeExcludeRedoStack((current) => [...current, lastAction]);
    markResearchHistoryEventReverted(lastAction.historyEventId);
    applyIncludeExcludeAction(lastAction.videoIds, lastAction.kind === 'exclude' ? 'restore' : 'exclude', {
      skipUndo: true,
      scope: lastAction.scope,
      selectionMode: lastAction.selectionMode,
      filterSummary: lastAction.filterSummary,
    });
  }, [applyIncludeExcludeAction, includeExcludeUndoStack, markResearchHistoryEventReverted]);

  const handleRedoIncludeExclude = useCallback(() => {
    const lastAction = includeExcludeRedoStack[includeExcludeRedoStack.length - 1];
    if (!lastAction) return;

    setIncludeExcludeRedoStack((current) => current.slice(0, -1));
    setIncludeExcludeUndoStack((current) => [...current, lastAction]);
    applyIncludeExcludeAction(lastAction.videoIds, lastAction.kind, {
      skipUndo: true,
      scope: lastAction.scope,
      selectionMode: lastAction.selectionMode,
      filterSummary: lastAction.filterSummary,
    });
  }, [applyIncludeExcludeAction, includeExcludeRedoStack]);

  const handleBatchAddTag = useCallback((videoIds: string[], tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;

    const uniqueVideoIds = Array.from(new Set(videoIds));
    startTagWriteTransition(() => {
      dispatchUserTags({ type: 'addTagToVideos', videoIds: uniqueVideoIds, tag: trimmed });
    });
    appendResearchHistory({
      type: 'tag_applied',
      summary: `Applied tag "${trimmed}" to ${uniqueVideoIds.length.toLocaleString()} video(s).`,
      meta: { tag: trimmed, count: uniqueVideoIds.length },
    });
  }, [appendResearchHistory, startTagWriteTransition]);

  const handleBatchAddTagToSelection = useCallback((tag: string) => {
    const nextVideoIds = selectedVideoIdsForActions;
    if (nextVideoIds.length === 0) return;
    handleBatchAddTag(nextVideoIds, tag);
  }, [handleBatchAddTag, selectedVideoIdsForActions]);

  const handleBatchRemoveTagFromSelection = useCallback((tag: string) => {
    const trimmed = tag.trim();
    const nextVideoIds = Array.from(new Set(selectedVideoIdsForActions));
    if (!trimmed || nextVideoIds.length === 0) return;
    startTagWriteTransition(() => {
      dispatchUserTags({ type: 'removeTagFromVideos', videoIds: nextVideoIds, tag: trimmed });
    });
    appendResearchHistory({
      type: 'tag_applied',
      summary: `Removed tag "${trimmed}" from ${nextVideoIds.length.toLocaleString()} video(s).`,
      meta: { tag: trimmed, count: nextVideoIds.length, action: 'remove' },
    });
  }, [appendResearchHistory, selectedVideoIdsForActions, startTagWriteTransition]);

  const handleBatchCopySelection = useCallback(async (mode: BatchCopyExportMode) => {
    const payload = buildBatchCopyClipboardPayload(selectedRowsForBatchCopy, mode);
    const exportLabel = (() => {
      if (mode === 'videoIds') return 'video IDs';
      if (mode === 'videoUrls') return 'video URLs';
      if (mode === 'channelIds') return 'channel IDs';
      return 'channel URLs';
    })();

    if (payload.values.length === 0) {
      return {
        status: 'empty' as const,
        copiedCount: 0,
        message: 'No values found for this export type in current selection.',
      };
    }

    try {
      await copyTextToClipboard(payload.text);
      return {
        status: 'success' as const,
        copiedCount: payload.values.length,
        message: `Copied ${payload.values.length.toLocaleString()} ${exportLabel}.`,
      };
    } catch (error) {
      console.warn(`[batch-copy] Failed to copy ${mode}.`, error);
      return {
        status: 'error' as const,
        copiedCount: 0,
        message: 'Could not copy to clipboard.',
      };
    }
  }, [selectedRowsForBatchCopy]);

  const handleOpenDatasetDashboardTab = useCallback((tab: DashboardTemplateTab) => {
    setDashboardActiveTab(tab);
    setIsDashboardOpen(true);
  }, []);

  const handleOpenResearchLog = useCallback(() => {
    setIsResearchLogOpen(true);
  }, []);

  const handleOpenSaveView = useCallback(() => {
    if (viewScope !== 'videos') {
      setViewScope('videos');
    }
    setSaveViewRequestKey((current) => current + 1);
  }, [viewScope]);

  const handleOpenAnnotations = useCallback(() => {
    if (viewScope !== 'videos') {
      setViewScope('videos');
    }
    setState((previous) => ({ ...previous, isRightPanelCollapsed: false }));
    setOpenAnnotationsRequestKey((current) => current + 1);
  }, [viewScope]);

  const requestSelectionScroll = useCallback((mode: 'none' | 'middle' = 'middle') => {
    selectionScrollModeRef.current = mode;
  }, []);

  const handleRequestImport = useCallback(() => {
    setImportRequestKey((current) => current + 1);
  }, []);

  const moveActiveSelectionByDirection = useCallback((direction: 1 | -1) => {
    const api = gridApiRef.current;
    const displayedCount = api?.getDisplayedRowCount() ?? activeGridRows.length;
    if (displayedCount <= 0) return;

    if (viewScope === 'channels') {
      const selectedChannelKey = channelSelection.focusKey
        || channelSelection.detailKey
        || channelSelection.anchorKey
        || channelSelection.selectedKeys[channelSelection.selectedKeys.length - 1]
        || '';
      const selectedNode = selectedChannelKey ? api?.getRowNode(selectedChannelKey) : null;
      const currentIndex = typeof selectedNode?.rowIndex === 'number' ? selectedNode.rowIndex : (direction > 0 ? -1 : displayedCount);
      const nextIndex = Math.max(0, Math.min(displayedCount - 1, currentIndex + direction));
      const nextRow = api?.getDisplayedRowAtIndex(nextIndex)?.data ?? activeGridRows[nextIndex];
      if (!nextRow) return;
      requestSelectionScroll('middle');
      api?.ensureIndexVisible(nextIndex, 'middle');
      const nextKey = String(nextRow?.channel_key || nextRow?.channel_id || nextRow?.channel_name || '');
      if (!nextKey) return;
      applyScopeSelection('channels', {
        selectedKeys: [nextKey],
        anchorKey: nextKey,
        focusKey: nextKey,
        detailKey: nextKey,
      });
      return;
    }

    const focusId = videoSelection.focusKey
      || videoSelection.detailKey
      || videoSelection.anchorKey
      || videoSelection.selectedKeys[videoSelection.selectedKeys.length - 1]
      || '';
    const focusNode = focusId ? api?.getRowNode(focusId) : null;
    const currentIndex = typeof focusNode?.rowIndex === 'number' ? focusNode.rowIndex : (direction > 0 ? -1 : displayedCount);
    const nextIndex = Math.max(0, Math.min(displayedCount - 1, currentIndex + direction));
    const nextRow = api?.getDisplayedRowAtIndex(nextIndex)?.data ?? activeGridRows[nextIndex];
    const nextVideoId = resolveVideoId(nextRow);
    if (!nextRow || !nextVideoId) return;

    requestSelectionScroll('middle');
    applyScopeSelection('videos', {
      selectedKeys: [nextVideoId],
      anchorKey: nextVideoId,
      focusKey: nextVideoId,
      detailKey: nextVideoId,
    });
    api?.ensureIndexVisible(nextIndex, 'middle');
  }, [activeGridRows, applyScopeSelection, channelSelection.anchorKey, channelSelection.detailKey, channelSelection.focusKey, channelSelection.selectedKeys, requestSelectionScroll, videoSelection.anchorKey, videoSelection.detailKey, videoSelection.focusKey, videoSelection.selectedKeys, viewScope]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      if (event.key === 'Escape') {
        if (isCommandPaletteOpen) {
          event.preventDefault();
          setIsCommandPaletteOpen(false);
          return;
        }
        if (isKeyboardHelpOpen) {
          event.preventDefault();
          setIsKeyboardHelpOpen(false);
          return;
        }
        if (isDashboardOpen) {
          event.preventDefault();
          setIsDashboardOpen(false);
          return;
        }
        if (isImportOpen) {
          event.preventDefault();
          setIsImportOpen(false);
          setPendingFile(null);
          setPendingRows([]);
          setPendingSchema([]);
          return;
        }
        if (isExportOpen) {
          event.preventDefault();
          setIsExportOpen(false);
          return;
        }
        if (isColumnsOpen) {
          event.preventDefault();
          setIsColumnsOpen(false);
          return;
        }
        if (isResearchLogOpen) {
          event.preventDefault();
          setIsResearchLogOpen(false);
        }
        return;
      }

      if (event.defaultPrevented) return;

      const isTyping = isEditableShortcutTarget(event.target);
      const isGridTarget = isGridShortcutTarget(event.target);
      const hasBlockingOverlay = isCommandPaletteOpen || isKeyboardHelpOpen || isDashboardOpen || isImportOpen || isExportOpen || isColumnsOpen || isResearchLogOpen;

      if (!isTyping && !isGridTarget && !hasBlockingOverlay && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        navigateHistoryByOffset(event.key === 'ArrowLeft' ? -1 : 1);
        return;
      }

      if (!isTyping && !isGridTarget && !hasBlockingOverlay && !event.shiftKey && !event.altKey && !hasShortcutModifier(event) && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        moveActiveSelectionByDirection(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (!isTyping && !hasBlockingOverlay) {
        if (matchesAltShiftShortcut(event, 't')) {
          event.preventDefault();
          handleOpenDatasetDashboardTab('thumbnails');
          return;
        }
        if (matchesAltShiftShortcut(event, 'a')) {
          event.preventDefault();
          handleOpenDatasetDashboardTab('attention');
          return;
        }
        if (matchesAltShiftShortcut(event, 'c')) {
          event.preventDefault();
          handleOpenDatasetDashboardTab('content');
          return;
        }
        if (matchesAltShiftShortcut(event, 'o')) {
          event.preventDefault();
          handleOpenDatasetDashboardTab('overview');
          return;
        }
        if (matchesAltShiftShortcut(event, 'v')) {
          event.preventDefault();
          setIsColumnsOpen(true);
          return;
        }
        if (matchesAltShiftShortcut(event, 'e')) {
          event.preventDefault();
          setIsExportOpen(true);
          return;
        }
        if (matchesAltShiftShortcut(event, 'i')) {
          event.preventDefault();
          handleRequestImport();
          return;
        }
        if (matchesAltShiftShortcut(event, 'k')) {
          event.preventDefault();
          setIsKeyboardHelpOpen(true);
          return;
        }
        if (matchesStandardShortcut(event, 'k')) {
          event.preventDefault();
          setIsCommandPaletteOpen(true);
          return;
        }
        if (matchesStandardShortcut(event, 's')) {
          event.preventDefault();
          handleOpenSaveView();
          return;
        }
        if (matchesStandardShortcut(event, 'z')) {
          if (!includeExcludeUndoStack.length || viewScope !== 'videos') return;
          event.preventDefault();
          handleUndoIncludeExclude();
          return;
        }
        if (matchesStandardShiftShortcut(event, 'z')) {
          if (!includeExcludeRedoStack.length || viewScope !== 'videos') return;
          event.preventDefault();
          handleRedoIncludeExclude();
          return;
        }
      }

      if (
        viewScope === 'videos'
        && !isGridTarget
        && !hasBlockingOverlay
        && (event.ctrlKey || event.metaKey)
        && event.key === 'Delete'
        && selectedVideoIdsForActions.length > 0
      ) {
        event.preventDefault();
        handleExcludeSelectedVideos();
        return;
      }

      if (viewScope !== 'videos' || isTyping || hasBlockingOverlay || isGridTarget) return;

      if (event.key === 'Delete' && selectedVideoIdsForActions.length > 0) {
        event.preventDefault();
        handleMoveSelectedVideos();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleExcludeSelectedVideos,
    handleMoveSelectedVideos,
    handleOpenDatasetDashboardTab,
    handleOpenSaveView,
    handleRedoIncludeExclude,
    handleRequestImport,
    handleUndoIncludeExclude,
    includeExcludeRedoStack.length,
    includeExcludeUndoStack.length,
    isColumnsOpen,
    isCommandPaletteOpen,
    isDashboardOpen,
    isExportOpen,
    isImportOpen,
    isKeyboardHelpOpen,
    isResearchLogOpen,
    moveActiveSelectionByDirection,
    navigateHistoryByOffset,
    selectedVideoIdsForActions.length,
    viewScope,
    datasetVersion,
    inclusionView,
  ]);

  const handleUpdateAnnotation = useCallback((videoId: string, update: Partial<Annotation>) => {
    if (Array.isArray(update.tags)) {
      dispatchUserTags({ type: 'replaceForVideo', videoId, tags: update.tags });
    }

    const { tags: _ignoredTags, notes: _ignoredNotes, ...detailUpdate } = update;
    if (Object.keys(detailUpdate).length === 0) return;

    setState((previous) => ({
      ...previous,
      annotations: {
        ...previous.annotations,
        [videoId]: {
          tags: [],
          transcriptOverride: previous.annotations[videoId]?.transcriptOverride,
          quoteRefs: previous.annotations[videoId]?.quoteRefs ?? [],
          timestampRefs: previous.annotations[videoId]?.timestampRefs ?? [],
          ...previous.annotations[videoId],
          ...detailUpdate,
        },
      },
    }));
  }, []);

  const handleUpdateVideoNotes = useCallback((videoId: string, notes: string) => {
    setNotesByVideoId((previous) => {
      const normalized = notes;
      if (!normalized.trim()) {
        if (!(videoId in previous)) return previous;
        const next = { ...previous };
        delete next[videoId];
        return next;
      }
      if (previous[videoId] === normalized) return previous;
      return { ...previous, [videoId]: normalized };
    });
  }, []);

  const handleBatchApplyNotesToSelection = useCallback((notes: string) => {
    const noteBlock = String(notes || '').trim();
    const targetVideoIds = Array.from(new Set(selectedVideoIdsForActions)).filter((videoId): videoId is string => typeof videoId === 'string' && videoId.length > 0);
    if (!noteBlock) {
      return {
        status: 'empty' as const,
        appliedCount: 0,
        message: 'Enter a note before applying.',
      };
    }
    if (!targetVideoIds.length) {
      return {
        status: 'empty' as const,
        appliedCount: 0,
        message: 'No selected videos to update.',
      };
    }
    setNotesByVideoId((previous) => {
      const next = { ...previous };
      targetVideoIds.forEach((videoId) => {
        const merged = appendNotesBlock(next[videoId], noteBlock);
        if (merged.trim()) next[videoId] = merged;
        else delete next[videoId];
      });
      return next;
    });
    return {
      status: 'success' as const,
      appliedCount: targetVideoIds.length,
      message: `Applied notes to ${targetVideoIds.length.toLocaleString()} video(s).`,
    };
  }, [selectedVideoIdsForActions]);

  const handleUpdateChannelNotes = useCallback((channelKey: string, notes: string) => {
    const normalizedKey = String(channelKey || '').trim();
    if (!normalizedKey) return;
    setChannelNotesById((previous) => {
      const normalized = notes;
      if (!normalized.trim()) {
        if (!(normalizedKey in previous)) return previous;
        const next = { ...previous };
        delete next[normalizedKey];
        return next;
      }
      if (previous[normalizedKey] === normalized) return previous;
      return { ...previous, [normalizedKey]: normalized };
    });
  }, []);

  const handleReplaceChannelTags = useCallback((channelKey: string, tags: string[]) => {
    const normalizedKey = String(channelKey || '').trim();
    if (!normalizedKey) return;
    const normalizedTags = Array.from(new Set((tags || []).map((tag) => String(tag || '').trim()).filter(Boolean)));
    setChannelTagsById((previous) => {
      if (!normalizedTags.length) {
        if (!(normalizedKey in previous)) return previous;
        const next = { ...previous };
        delete next[normalizedKey];
        return next;
      }
      const current = previous[normalizedKey] || [];
      if (current.length === normalizedTags.length && current.every((tag, index) => tag === normalizedTags[index])) {
        return previous;
      }
      return { ...previous, [normalizedKey]: normalizedTags };
    });
  }, []);

  const handleBatchAddChannelTag = useCallback((tag: string) => {
    const trimmed = String(tag || '').trim();
    if (!trimmed || !selectedChannelKeys.length) return;
    setChannelTagsById((previous) => {
      const next = { ...previous };
      selectedChannelKeys.forEach((channelKey) => {
        const current = next[channelKey] || [];
        if (!current.includes(trimmed)) next[channelKey] = [...current, trimmed];
      });
      return next;
    });
  }, [selectedChannelKeys]);

  const handleBatchRemoveChannelTag = useCallback((tag: string) => {
    const trimmed = String(tag || '').trim();
    if (!trimmed || !selectedChannelKeys.length) return;
    setChannelTagsById((previous) => {
      const next = { ...previous };
      selectedChannelKeys.forEach((channelKey) => {
        const current = next[channelKey] || [];
        const filtered = current.filter((item) => item !== trimmed);
        if (filtered.length) next[channelKey] = filtered;
        else delete next[channelKey];
      });
      return next;
    });
  }, [selectedChannelKeys]);

  const handleBatchApplyChannelNotes = useCallback((notes: string) => {
    const noteBlock = String(notes || '').trim();
    if (!noteBlock) {
      return {
        status: 'empty' as const,
        appliedCount: 0,
        message: 'Enter a note before applying.',
      };
    }
    if (!selectedChannelKeys.length) {
      return {
        status: 'empty' as const,
        appliedCount: 0,
        message: 'No selected channels to update.',
      };
    }
    setChannelNotesById((previous) => {
      const next = { ...previous };
      selectedChannelKeys.forEach((channelKey) => {
        const merged = appendNotesBlock(next[channelKey], noteBlock);
        if (merged.trim()) next[channelKey] = merged;
        else delete next[channelKey];
      });
      return next;
    });
    return {
      status: 'success' as const,
      appliedCount: selectedChannelKeys.length,
      message: `Applied notes to ${selectedChannelKeys.length.toLocaleString()} channel(s).`,
    };
  }, [selectedChannelKeys]);

  const handleBatchExcludeChannels = useCallback(() => {
    const nextVideoIds = Array.from(new Set(selectedChannelVideoRowsForActions.map((row) => resolveVideoId(row)).filter(Boolean) as string[]));
    if (nextVideoIds.length === 0) return;
    const targetKind: IncludeExcludeAction['kind'] = inclusionView === 'excluded' ? 'restore' : 'exclude';
    applyIncludeExcludeAction(nextVideoIds, targetKind, {
      reason: selectedChannelKeys.length === 1
        ? 'Batch action from channel viewer.'
        : `Batch action from channel viewer for ${selectedChannelKeys.length.toLocaleString()} selected channels.`,
      scope: 'channels',
      selectionMode: targetKind === 'exclude' && areAllFilteredChannelsSelectedForAction ? 'filtered_bulk' : 'manual',
      filterSummary: summarizeFilterModel(channelFilterModel),
      selectedRows: selectedChannelVideoRowsForActions,
    });
  }, [applyIncludeExcludeAction, areAllFilteredChannelsSelectedForAction, channelFilterModel, inclusionView, selectedChannelKeys, selectedChannelVideoRowsForActions]);

  const handleBatchCopyChannelSelection = useCallback(async (mode: BatchCopyExportMode) => {
    const channelRowsForCopy = selectedChannelRows;
    const relatedVideoRows = selectedChannelVideoRowsForActions;
    const payload = buildBatchCopyClipboardPayload(
      mode === 'channelIds' || mode === 'channelUrls' ? channelRowsForCopy : relatedVideoRows,
      mode,
    );
    const exportLabel = (() => {
      if (mode === 'videoIds') return 'video IDs';
      if (mode === 'videoUrls') return 'video URLs';
      if (mode === 'channelIds') return 'channel IDs';
      return 'channel URLs';
    })();

    if (payload.values.length === 0) {
      return {
        status: 'empty' as const,
        copiedCount: 0,
        message: 'No values found for this export type in current selection.',
      };
    }

    try {
      await copyTextToClipboard(payload.text);
      return {
        status: 'success' as const,
        copiedCount: payload.values.length,
        message: `Copied ${payload.values.length.toLocaleString()} ${exportLabel}.`,
      };
    } catch (error) {
      console.warn(`[channel-batch-copy] Failed to copy ${mode}.`, error);
      return {
        status: 'error' as const,
        copiedCount: 0,
        message: 'Could not copy to clipboard.',
      };
    }
  }, [selectedChannelRows, selectedChannelVideoRowsForActions]);

  const handleWatchSession = useCallback((session: {
    videoId: string;
    title: string;
    startedAt: string;
    endedAt: string;
    watchedSeconds: number;
    durationSeconds: number | null;
    qualifies: boolean;
  }) => {
    if (!session.videoId || session.watchedSeconds <= 0) return;
    setWatchHistoryByVideoId((current) => {
      const previous = current[session.videoId];
      const next: WatchHistoryEntry = {
        videoId: session.videoId,
        title: session.title || previous?.title || 'Untitled Video',
        firstWatchedAt: previous?.firstWatchedAt || session.startedAt,
        lastWatchedAt: session.endedAt,
        totalWatchSeconds: Number(((previous?.totalWatchSeconds || 0) + session.watchedSeconds).toFixed(1)),
        qualifyingSessionCount: (previous?.qualifyingSessionCount || 0) + (session.qualifies ? 1 : 0),
        playStartCount: (previous?.playStartCount || 0) + 1,
        durationSeconds: session.durationSeconds ?? previous?.durationSeconds ?? null,
      };
      return { ...current, [session.videoId]: next };
    });
  }, []);

  const handleGenerateChannelMetadata = useCallback(async () => {
    if (isGeneratingChannelMetadata) return;
    const hasExistingSnapshot = Boolean(channelMetadataSnapshot?.rows?.length);
    const metadataActionLabel = hasExistingSnapshot ? 'Refreshing channel metadata' : 'Generating channel metadata';
    setIsGeneratingChannelMetadata(true);
    updateLongTaskProgress({
      title: metadataActionLabel,
      detail: 'Aggregating channel rows',
      completed: 1,
      total: 4,
      indeterminate: true,
    });

    try {
      await waitForNextPaint();
      const nextRows = buildChannelMetadataRows(activeBaseRows, importedChannelMetadata);
      setChannelMetadataSnapshot({
        rows: nextRows,
        calculatedAt: new Date().toISOString(),
        datasetVersionAtCalculation: datasetVersion,
        inclusionViewAtCalculation: inclusionView,
        videoCorpusFingerprintAtCalculation: videoCorpusFingerprint,
        exclusionMembershipFingerprintAtCalculation: exclusionMembershipFingerprint,
        cacheKeyAtCalculation: currentChannelMetadataCacheKey,
      });

      updateLongTaskProgress({
        title: metadataActionLabel,
        detail: 'Collecting video-level link data',
        completed: 2,
        total: 4,
        indeterminate: true,
      });
      await waitForNextPaint();

      const linkingByVideoId: Record<string, LinkingGeneratedRowMetadata> = {};
      Object.entries(effectiveGeneratedMetadataByVideoId as GeneratedMetadataState['byVideoId']).forEach(([videoId, entry]) => {
        if (entry?.linking) linkingByVideoId[videoId] = entry.linking;
      });

      updateLongTaskProgress({
        title: metadataActionLabel,
        detail: Object.keys(linkingByVideoId).length > 0 ? 'Building channel link aggregates' : 'Finalizing channel table',
        completed: 3,
        total: 4,
        indeterminate: Object.keys(linkingByVideoId).length > 0,
      });
      await waitForNextPaint();

      if (Object.keys(linkingByVideoId).length > 0) {
        const channelAggregates = aggregateChannelLinkingFromVideoRows({
          videoRows: includedBaseRows,
          generatedMetadataByVideoId: linkingByVideoId,
        });
        setChannelLinkingState({
          stale: false,
          staleReason: undefined,
          snapshot: {
            generatedAt: new Date().toISOString(),
            datasetFingerprint: buildDatasetFingerprint({
              datasetVersion,
              inclusionView,
              rowCount: includedBaseRows.length,
              sourceVisibility,
            }),
            rowUniverseCount: includedBaseRows.length,
            byChannelKey: channelAggregates,
          },
        });
        appendResearchHistory({
          type: 'channel_linking_refreshed',
          summary: `${hasExistingSnapshot ? 'Refreshed' : 'Generated'} channel metadata with link aggregates for ${Object.keys(channelAggregates).length.toLocaleString()} channels.`,
        });
      } else {
        setChannelLinkingState({
          stale: false,
          staleReason: undefined,
          snapshot: null,
        });
      }

      updateLongTaskProgress({
        title: metadataActionLabel,
        detail: 'Refreshing channel explorer',
        completed: 4,
        total: 4,
      });
      setChannelFilterModel({});
      clearScopeSelection('channels', false);
    } finally {
      setIsGeneratingChannelMetadata(false);
      updateLongTaskProgress(null);
    }
  }, [
    activeBaseRows,
    appendResearchHistory,
    datasetVersion,
    effectiveGeneratedMetadataByVideoId,
    importedChannelMetadata,
    includedBaseRows,
    inclusionView,
    isGeneratingChannelMetadata,
    channelMetadataSnapshot?.rows,
    currentChannelMetadataCacheKey,
    exclusionMembershipFingerprint,
    sourceVisibility,
    updateLongTaskProgress,
    videoCorpusFingerprint,
    viewScope,
  ]);

  const updateExternalFilterModel = useCallback((nextFilterModel: ExplorerFilterModel) => {
    const sanitizedModel = Object.fromEntries(
      Object.entries(nextFilterModel || {}).filter(([, model]) => {
        if (!model) return false;
        if (Array.isArray((model as any).values)) return (model as any).values.length > 0;
        if ((model as any).selections && typeof (model as any).selections === 'object') {
          return Object.keys((model as any).selections).length > 0;
        }
        const value = (model as any).value ?? (model as any).filter ?? '';
        return String(value).trim().length > 0;
      }),
    ) as ExplorerFilterModel;
    setFilterModel(sanitizedModel);
    setFilteredViewVersion((version) => version + 1);
  }, []);

  const updateChannelFilterModel = useCallback((nextFilterModel: ExplorerFilterModel) => {
    const sanitizedModel = Object.fromEntries(
      Object.entries(nextFilterModel || {}).filter(([, model]) => {
        if (!model) return false;
        if (Array.isArray((model as any).values)) return (model as any).values.length > 0;
        if ((model as any).selections && typeof (model as any).selections === 'object') {
          return Object.keys((model as any).selections).length > 0;
        }
        const value = (model as any).value ?? (model as any).filter ?? '';
        return String(value).trim().length > 0;
      }),
    ) as ExplorerFilterModel;
    setChannelFilterModel(sanitizedModel);
  }, []);

  const clearAllExplorerFilters = useCallback(() => {
    setDefaultGridResetStage(0);
    if (viewScope === 'channels') {
      clearChannelDrilldownState({ restoreVideoFilters: false });
      clearChannelScopedVideoUniverse();
      setChannelFilterModel({});
      clearScopeSelection('channels', true);
      return;
    }
    const recoveredInclusionView = resolveRecoverableInclusionView({
      preferred: 'included',
      includedRowCount: includedBaseRows.length,
      excludedRowCount: excludedBaseRows.length,
    });
    clearChannelDrilldownState({ restoreVideoFilters: false });
    clearChannelScopedVideoUniverse();
    setState((previous) => ({ ...previous, activeViewId: null }));
    updateExternalFilterModel({});
    setChannelFilterModel({});
    setViewScope('videos');
    setInclusionView(recoveredInclusionView);
    if (recoveredInclusionView === 'excluded') {
      console.warn('[view-recovery] Clear filters switched to "excluded" because "included" has no visible rows.');
    }
    clearScopeSelection('videos', true);
    clearScopeSelection('channels', true);
  }, [clearChannelDrilldownState, clearChannelScopedVideoUniverse, clearScopeSelection, excludedBaseRows.length, includedBaseRows.length, updateExternalFilterModel, viewScope]);

  const handleToggleSourceRows = useCallback((sourceId: string) => {
    setSourceVisibility((current) => {
      const hidden = new Set(current.hiddenSourceIds || []);
      if (hidden.has(sourceId)) hidden.delete(sourceId);
      else hidden.add(sourceId);
      return {
        ...current,
        hiddenSourceIds: Array.from(hidden),
      };
    });
    markDerivedSnapshotsStale('Source visibility changed. Refresh linking summary and channel metadata.');
    setDatasetVersion((version) => version + 1);
    setFilteredViewVersion((version) => version + 1);
    appendResearchHistory({
      type: 'source_visibility_toggled',
      summary: `Toggled row visibility for source "${sourceRegistry.byId[sourceId]?.label || sourceId}".`,
      details: `Base-source row hiding is active for this source toggle.`,
      meta: { sourceId },
    });
  }, [appendResearchHistory, markDerivedSnapshotsStale, sourceRegistry.byId]);

  const handleToggleSourceColumns = useCallback((sourceId: string) => {
    setSourceVisibility((current) => {
      const currentHiddenByScope = current.hiddenColumnSourceIdsByScope?.[viewScope] || [];
      const hidden = new Set(currentHiddenByScope);
      if (hidden.has(sourceId)) hidden.delete(sourceId);
      else hidden.add(sourceId);
      return {
        ...current,
        hiddenColumnSourceIdsByScope: {
          ...current.hiddenColumnSourceIdsByScope,
          [viewScope]: Array.from(hidden),
        },
      };
    });
    appendResearchHistory({
      type: 'source_column_visibility_toggled',
      summary: `Toggled ${viewScope} column visibility for source "${sourceRegistry.byId[sourceId]?.label || sourceId}".`,
      meta: { sourceId, scope: viewScope },
    });
  }, [appendResearchHistory, sourceRegistry.byId, viewScope]);

  const handleShowAllSources = useCallback(() => {
    setSourceVisibility((current) => ({
      ...current,
      hiddenSourceIds: [],
    }));
    markDerivedSnapshotsStale('Source visibility changed. Refresh linking summary and channel metadata.');
    setDatasetVersion((version) => version + 1);
    setFilteredViewVersion((version) => version + 1);
    appendResearchHistory({
      type: 'source_visibility_bulk_changed',
      summary: 'Set all source rows to visible.',
    });
  }, [appendResearchHistory, markDerivedSnapshotsStale]);

  const handleHideAllEnrichmentSources = useCallback(() => {
    const toHide = sourceRegistry.orderedIds.filter((sourceId) => sourceRegistry.byId[sourceId]?.kind === 'enrichment');
    setSourceVisibility((current) => ({
      ...current,
      hiddenSourceIds: joinUnique([...(current.hiddenSourceIds || []), ...toHide]),
    }));
    markDerivedSnapshotsStale('Source visibility changed. Refresh linking summary and channel metadata.');
    setDatasetVersion((version) => version + 1);
    setFilteredViewVersion((version) => version + 1);
    appendResearchHistory({
      type: 'source_visibility_bulk_changed',
      summary: `Hid ${toHide.length.toLocaleString()} enrichment source(s).`,
      meta: { hiddenSourceIds: toHide.join(', ') },
    });
  }, [appendResearchHistory, markDerivedSnapshotsStale, sourceRegistry.byId, sourceRegistry.orderedIds]);

  const handleDeleteSource = useCallback(async (sourceId: string) => {
    const source = sourceRegistry.byId[sourceId];
    if (!source || source.kind !== 'enrichment' || sourceId === sourceRegistry.primarySourceId) return;
    const hasMergedIntoExistingRows = Object.values(rowLineage.byRowId as RowLineageState['byRowId']).some((entry) => entry.baseSourceId !== sourceId && (entry.contributorSourceIds || []).includes(sourceId));
    if (hasMergedIntoExistingRows) {
      window.alert('This source changed existing rows and cannot be cleanly removed from this menu.');
      return;
    }
    if (!window.confirm(`Delete source "${source.label}" from this project? This removes its rows and source-owned columns.`)) return;

    updateLongTaskProgress({
      title: 'Deleting source',
      detail: 'Removing source rows from the project',
      completed: 1,
      total: 4,
      indeterminate: true,
    });

    try {
      await waitForNextPaint();
      const nextSourceRows = sourceRows.filter((row, index) => {
        const rowId = resolveRowLineageKey(row, index);
        return rowLineage.byRowId[rowId]?.baseSourceId !== sourceId;
      });
      const survivingVideoIds = new Set(collectVideoIds(nextSourceRows));
      const nextRowLineageByRowId: RowLineageState['byRowId'] = {};
      nextSourceRows.forEach((row, index) => {
        const rowId = resolveRowLineageKey(row, index);
        const existing = rowLineage.byRowId[rowId];
        if (!existing || existing.baseSourceId === sourceId) return;
        nextRowLineageByRowId[rowId] = {
          ...existing,
          contributorSourceIds: (existing.contributorSourceIds || []).filter((id) => id !== sourceId),
        };
      });
      const nextRowLineage: RowLineageState = { byRowId: nextRowLineageByRowId };

      updateLongTaskProgress({
        title: 'Deleting source',
        detail: 'Removing source-owned columns and filters',
        completed: 2,
        total: 4,
        indeterminate: true,
      });
      await waitForNextPaint();

      const removedColumns = Object.entries(columnLineage.byColumn as ColumnLineageState['byColumn'])
        .filter(([, entry]) => entry.sourceId === sourceId && !entry.generated)
        .map(([column]) => column);
      const removedColumnSet = new Set(removedColumns);
      const nextSourceSchema = sourceSchema.filter((column) => !removedColumnSet.has(column.column_name));
      const nextDeletedColumns = deletedColumns.filter((column) => !removedColumnSet.has(column));
      const stripModel = (model: ExplorerFilterModel) => Object.fromEntries(
        Object.entries(model || {}).filter(([column]) => !removedColumnSet.has(column)),
      ) as ExplorerFilterModel;
      const nextVisibleColumns = visibleColumns.filter((column) => !removedColumnSet.has(column));
      const nextChannelVisibleColumns = channelVisibleColumns.filter((column) => !removedColumnSet.has(column));
      const nextSavedViews = state.savedViews.map((view) => ({
        ...view,
        visibleColumns: (view.visibleColumns || []).filter((column) => !removedColumnSet.has(column)),
        filterModel: stripModel(view.filterModel || {}),
      }));
      const nextColumnLineage = ensureGeneratedColumnLineage({
        byColumn: Object.fromEntries(
          Object.entries(columnLineage.byColumn as ColumnLineageState['byColumn']).filter(([, entry]) => entry.sourceId !== sourceId),
        ),
      });
      const nextSourceRegistry = withSourceRegistryCounts({
        sourceRegistry: {
          byId: Object.fromEntries(Object.entries(sourceRegistry.byId).filter(([id]) => id !== sourceId)) as SourceRegistryState['byId'],
          orderedIds: sourceRegistry.orderedIds.filter((id) => id !== sourceId),
          primarySourceId: sourceRegistry.primarySourceId,
        },
        rowLineage: nextRowLineage,
        defaultRowCount: nextSourceRows.length,
      });
      const nextSourceVisibility = reconcileSourceVisibility({
        hiddenSourceIds: (sourceVisibility.hiddenSourceIds || []).filter((id) => id !== sourceId),
        hiddenColumnSourceIdsByScope: {
          videos: (sourceVisibility.hiddenColumnSourceIdsByScope?.videos || []).filter((id) => id !== sourceId),
          channels: (sourceVisibility.hiddenColumnSourceIdsByScope?.channels || []).filter((id) => id !== sourceId),
        },
      }, nextSourceRegistry);

      updateLongTaskProgress({
        title: 'Deleting source',
        detail: 'Refreshing project state',
        completed: 3,
        total: 4,
        indeterminate: true,
      });
      await waitForNextPaint();

      setSourceRows(nextSourceRows);
      setSourceSchema(nextSourceSchema);
      setDeletedColumns(nextDeletedColumns);
      setVisibleColumns(nextVisibleColumns);
      setChannelVisibleColumns(nextChannelVisibleColumns);
      setFilterModel((current) => stripModel(current));
      setChannelFilterModel((current) => stripModel(current));
      setState((previous) => ({
        ...previous,
        schema: stripDeletedColumnsFromSchema(nextSourceSchema, nextDeletedColumns),
        savedViews: nextSavedViews,
        activeViewId: previous.activeViewId && nextSavedViews.some((view) => view.id === previous.activeViewId) ? previous.activeViewId : null,
        annotations: Object.fromEntries(Object.entries(previous.annotations).filter(([videoId]) => survivingVideoIds.has(videoId))),
      }));
      setSavedViewsVersion((version) => version + 1);
      clearScopeSelection('videos', false);
      clearScopeSelection('channels', false);
      dispatchUserTags({ type: 'hydrate', state: Object.fromEntries(Object.entries(userTagsByVideoId).filter(([videoId]) => survivingVideoIds.has(videoId))) });
      setNotesByVideoId((previous) => Object.fromEntries(Object.entries(previous).filter(([videoId]) => survivingVideoIds.has(videoId))));
      setWatchHistoryByVideoId((previous) => Object.fromEntries(Object.entries(previous).filter(([videoId]) => survivingVideoIds.has(videoId))));
      setGeneratedMetadata((previous) => ({
        byVideoId: Object.fromEntries(Object.entries(previous.byVideoId).filter(([videoId]) => survivingVideoIds.has(videoId))),
      }));
      setExcludedVideoIds((current) => current.filter((videoId) => survivingVideoIds.has(videoId)));
      setExcludedVideoMetaById((previous) => Object.fromEntries(Object.entries(previous).filter(([videoId]) => survivingVideoIds.has(videoId))));
      setSourceRegistry(nextSourceRegistry);
      setSourceVisibility(nextSourceVisibility);
      setRowLineage(nextRowLineage);
      setColumnLineage(nextColumnLineage);
      markDerivedSnapshotsStale('Source deleted. Refresh linking summary and channel metadata.');
      setChannelMetadataSnapshot(null);
      setChannelLinkingState(createEmptyChannelLinkingState());
      clearAllThumbnailCaches();
      setDatasetVersion((version) => version + 1);
      setFilteredViewVersion((version) => version + 1);
      updateLongTaskProgress({
        title: 'Deleting source',
        detail: 'Source removed from the current project',
        completed: 4,
        total: 4,
      });
      appendResearchHistory({
        type: 'source_deleted' as any,
        summary: `Deleted source "${source.label}" from the current project.`,
        meta: { sourceId, removedColumns: removedColumns.join(', '), removedRowCount: source.rowCount },
      });
    } finally {
      updateLongTaskProgress(null);
    }
  }, [
    appendResearchHistory,
    channelVisibleColumns,
    clearAllThumbnailCaches,
    columnLineage.byColumn,
    deletedColumns,
    markDerivedSnapshotsStale,
    rowLineage.byRowId,
    sourceRows,
    sourceSchema,
    sourceRegistry.byId,
    sourceRegistry.orderedIds,
    sourceRegistry.primarySourceId,
    sourceVisibility.hiddenColumnSourceIdsByScope,
    sourceVisibility.hiddenSourceIds,
    state.annotations,
    state.savedViews,
    updateLongTaskProgress,
    userTagsByVideoId,
    visibleColumns,
  ]);

  const removeCurrentScopeFilter = useCallback((column: string) => {
    if (viewScope === 'channels') {
      const nextModel = { ...channelFilterModel };
      delete nextModel[column];
      updateChannelFilterModel(nextModel);
      return;
    }
    const nextModel = { ...filterModel };
    delete nextModel[column];
    updateExternalFilterModel(nextModel);
  }, [channelFilterModel, filterModel, updateChannelFilterModel, updateExternalFilterModel, viewScope]);

  const updateCurrentScopeFilter = useCallback((column: string, model: any) => {
    if (viewScope === 'channels') {
      const nextModel = { ...channelFilterModel };
      if (model) nextModel[column] = model;
      else delete nextModel[column];
      updateChannelFilterModel(nextModel);
      return;
    }
    const nextModel = { ...filterModel };
    if (model) nextModel[column] = model;
    else delete nextModel[column];
    updateExternalFilterModel(nextModel);
  }, [channelFilterModel, filterModel, updateChannelFilterModel, updateExternalFilterModel, viewScope]);

  const reorderVisibleColumns = useCallback((nextOrder: string[]) => {
    if (viewScope === 'channels') {
      setChannelVisibleColumns((current) => {
        const currentSet = new Set(current);
        const uniqueNext = Array.from(new Set(nextOrder)).filter((column) => currentSet.has(column));
        const remaining = current.filter((column) => !uniqueNext.includes(column));
        return [...uniqueNext, ...remaining];
      });
      return;
    }
    setVisibleColumns((current) => {
      const currentSet = new Set(current);
      const uniqueNext = Array.from(new Set(nextOrder)).filter((column) => currentSet.has(column));
      const remaining = current.filter((column) => !uniqueNext.includes(column));
      return [...uniqueNext, ...remaining];
    });
  }, [viewScope]);

  const resetVisibleColumnOrder = useCallback(() => {
    if (viewScope === 'channels') {
      setChannelVisibleColumns((current) => {
        const visibleSet = new Set(current);
        return channelSchemaColumnNames.filter((column) => visibleSet.has(column));
      });
      return;
    }
    setVisibleColumns((current) => {
      const visibleSet = new Set(current);
      return schemaColumnNames.filter((column) => visibleSet.has(column));
    });
  }, [channelSchemaColumnNames, schemaColumnNames, viewScope]);

  const showAllColumns = useCallback(() => {
    if (viewScope === 'channels') {
      setChannelVisibleColumns(channelSchemaColumnNames);
      return;
    }
    setVisibleColumns(schemaColumnNames);
  }, [channelSchemaColumnNames, schemaColumnNames, viewScope]);

  const hideOptionalColumns = useCallback(() => {
    const sourceColumns = viewScope === 'channels' ? channelSchemaColumnNames : schemaColumnNames;
    if (viewScope === 'channels') {
      setChannelVisibleColumns(getDefaultChannelVisibleColumns(sourceColumns));
      return;
    }
    const preferred = sourceColumns.filter((column) => {
      const lower = column.toLowerCase();
      return lower.includes('title')
        || lower.includes('channel')
        || lower.includes('publish')
        || lower.includes('date')
        || lower.includes('duration')
        || lower.includes('view')
        || lower.includes('comment')
        || lower.includes('like')
        || lower.includes('subscriber')
        || lower.includes('video_count')
        || lower.includes('total_')
        || column === USER_TAGS_COLUMN
        || column === TRANSCRIPT_COLUMN;
    });
    const next = preferred.length ? preferred : sourceColumns.slice(0, Math.min(6, sourceColumns.length));
    setVisibleColumns(next);
  }, [channelSchemaColumnNames, schemaColumnNames, viewScope]);

  const handleExport = (options: ExportOptions) => {
    const activeRows = options.includeFilteredRows ? rows : displayRows;
    const markdownOptions = options.markdownOptions || researchLogMarkdownOptions;
    const markdown = buildResearchLogMarkdown({
      projectName: state.fileName || 'Untitled project',
      overview: state.projectOverview,
      diary: state.projectNotes,
      corpusProcessing: researchLogGeneratedSectionsWithComments.corpusProcessing,
      views: researchLogGeneratedSectionsWithComments.views,
      watchHistory: researchLogGeneratedSectionsWithComments.watchHistory,
      researchActions: researchLogGeneratedSectionsWithComments.researchActions,
      notesAppendix: researchLogGeneratedSectionsWithComments.notesAppendix,
      dashboard: researchLogGeneratedSectionsWithComments.dashboard,
      includeNotesAppendix: markdownOptions.includeNotesAppendix,
      includeDashboardSection: markdownOptions.includeDashboardSection,
      dashboardStale: isAnyDashboardSnapshotStale,
    });

    if (options.format === 'markdown') {
      downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8;' }), `${sanitizeFileName(state.fileName, 'research_log')}_research_log.md`);
      setIsExportOpen(false);
      return;
    }

    if (options.format === 'csv') {
      const columns = [...options.selectedColumns];
      if (options.includeNotesColumn && !columns.includes(NOTES_COLUMN)) columns.push(NOTES_COLUMN);
      if (options.includeUserTagsColumn && !columns.includes(USER_TAGS_COLUMN)) columns.push(USER_TAGS_COLUMN);
      const finalRows = activeRows.map((row) => {
        const videoId = resolveVideoId(row) || '';
        const annotation = { ...(state.annotations[videoId] || {}), tags: userTagsByVideoId[videoId] || [] } as Annotation;
        return {
          ...row,
          [NOTES_COLUMN]: notesByVideoId[videoId] || '',
          [USER_TAGS_COLUMN]: annotation?.tags || row[USER_TAGS_COLUMN] || [],
          [TRANSCRIPT_COLUMN]: resolveTranscript(row, annotation),
        };
      });
      const csvContent = convertRowsToCsv(finalRows, columns);
      downloadBlob(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }), `${sanitizeFileName(state.fileName, 'export')}.csv`);
      setIsExportOpen(false);
      return;
    }

    const projectName = options.projectName || sanitizeFileName(state.fileName, 'ytde_project');
    const archiveAnnotations = mergeAnnotationsWithUserTags(stripNotesFromAnnotations(state.annotations), userTagsByVideoId);
    const thumbnailScopeIndex: Record<string, DashboardThumbnailCacheIndex['scopes'][string]> = {};
    const thumbnailArchiveFiles: Array<{ fileName: string; data: Uint8Array }> = [];

    (Object.entries(thumbnailCaches) as Array<[string, DashboardThumbnailCacheSnapshot]>).forEach(([scopeKey, scopeSnapshot]) => {
      if (!isPersistentThumbnailScopeKey(scopeKey)) return;

      const scopeFolder = scopeKey === 'full'
        ? 'full'
        : `saved_views/${sanitizeThumbnailPathSegment(scopeKey.replace('savedView:', ''), 'view')}`;

      const indexedEntries: DashboardThumbnailArchiveEntry[] = [];
      scopeSnapshot.entries.forEach((entry) => {
        if (entry.status === 'loaded' && entry.bytes && entry.bytes.length > 0) {
          const ext = inferFileExtensionFromMimeType(entry.mimeType);
          const safeVideoId = sanitizeThumbnailPathSegment(entry.videoId || entry.dedupeKey || `thumb_${entry.rank}`, `thumb_${entry.rank}`);
          const fileName = `thumbnails/${scopeFolder}/${String(entry.rank).padStart(4, '0')}_${safeVideoId}.${ext}`;
          thumbnailArchiveFiles.push({ fileName, data: entry.bytes });
          indexedEntries.push({
            videoId: entry.videoId,
            dedupeKey: entry.dedupeKey,
            title: entry.title,
            rank: entry.rank,
            sourceUrl: entry.sourceUrl,
            status: 'loaded',
            mimeType: entry.mimeType || 'image/jpeg',
            byteLength: entry.bytes.length,
            fileName,
          });
          return;
        }

        indexedEntries.push({
          videoId: entry.videoId,
          dedupeKey: entry.dedupeKey,
          title: entry.title,
          rank: entry.rank,
          sourceUrl: entry.sourceUrl,
          status: 'failed',
          error: entry.error || 'thumbnail unavailable',
        });
      });

      if (!indexedEntries.length) return;
      thumbnailScopeIndex[scopeKey] = {
        scopeKey,
        label: scopeSnapshot.label,
        rowCount: scopeSnapshot.rowCount,
        totalCandidates: scopeSnapshot.totalCandidates,
        calculatedAt: scopeSnapshot.calculatedAt,
        datasetVersionAtCalculation: scopeSnapshot.datasetVersionAtCalculation,
        savedViewsVersionAtCalculation: scopeSnapshot.savedViewsVersionAtCalculation,
        sortSignature: scopeSnapshot.sortSignature,
        entries: indexedEntries,
      };
    });

    const thumbnailCacheIndex: DashboardThumbnailCacheIndex | undefined = Object.keys(thumbnailScopeIndex).length
      ? { version: 1, scopes: thumbnailScopeIndex }
      : undefined;

    const manifest = createProjectManifest({
      fileName: state.fileName,
      projectName,
      schema: workingSchema,
      sourceSchema,
      visibleColumns,
      channelVisibleColumns,
      videoColumnWidths,
      channelColumnWidths,
      savedViews: state.savedViews,
      activeViewId: state.activeViewId,
      annotations: archiveAnnotations,
      channelNotesById,
      channelTagsById,
      projectOverview: state.projectOverview,
      projectNotes: state.projectNotes,
      researchLogSectionComments: state.researchLogSectionComments,
      researchHistory: cleanedResearchHistory,
      watchHistoryByVideoId,
      theme: state.theme,
      isRightPanelCollapsed: state.isRightPanelCollapsed,
      deletedColumns,
      specialMappings: specialMappings as Record<string, string | undefined>,
      excludedVideoIds,
      excludedVideoMetaById,
      dashboardSnapshots,
      savedViewDashboardSnapshots,
      savedViewsVersion,
      channelMetadataSnapshot,
      importedChannelMetadata,
      thumbnailCacheIndex,
      viewScope,
      sourceRegistry,
      sourceVisibility,
      rowLineage,
      columnLineage,
      generatedMetadata: { byVideoId: effectiveGeneratedMetadataByVideoId },
      linkingState,
      channelLinkingState,
    });
    const dataCsv = convertRowsToCsv(sourceRows, sourceSchema.map((column) => column.column_name));
    const archiveFolder = sanitizeFileName(projectName, 'ytde_project');
    const archiveBlob = createStoredZip([
      { name: `${archiveFolder}/project.json`, data: JSON.stringify(manifest, null, 2) },
      { name: `${archiveFolder}/data.csv`, data: dataCsv },
      { name: `${archiveFolder}/research_log.md`, data: markdown },
      { name: `${archiveFolder}/annotations.json`, data: JSON.stringify(archiveAnnotations, null, 2) },
      { name: `${archiveFolder}/saved_views.json`, data: JSON.stringify(state.savedViews, null, 2) },
      ...thumbnailArchiveFiles.map((entry) => ({ name: `${archiveFolder}/${entry.fileName}`, data: entry.data })),
      ...buildNoteArchiveFiles(notesByVideoId, archiveFolder),
    ]);

    downloadBlob(archiveBlob, `${archiveFolder}_ytde.zip`);
    setIsExportOpen(false);
  };

  const clearColumnFilter = useCallback((column: string) => {
    if (viewScope === 'channels') {
      if (!channelFilterModel[column]) return;
      const nextFilterModel = { ...channelFilterModel };
      delete nextFilterModel[column];
      updateChannelFilterModel(nextFilterModel);
      return;
    }
    if (!filterModel[column]) return;
    const nextFilterModel = { ...filterModel };
    delete nextFilterModel[column];
    updateExternalFilterModel(nextFilterModel);
  }, [channelFilterModel, filterModel, updateChannelFilterModel, updateExternalFilterModel, viewScope]);

  const toggleColumn = useCallback((column: string) => {
    if (viewScope === 'channels') {
      setChannelVisibleColumns((current) => {
        const isHiding = current.includes(column);
        if (isHiding) clearColumnFilter(column);
        return isHiding ? current.filter((value) => value !== column) : [...current, column];
      });
      return;
    }
    setVisibleColumns((current) => {
      const isHiding = current.includes(column);
      if (isHiding) clearColumnFilter(column);
      return isHiding ? current.filter((value) => value !== column) : [...current, column];
    });
  }, [clearColumnFilter, viewScope]);

  const handleSetAllColumns = useCallback((visible: boolean) => {
    if (viewScope === 'channels') {
      if (visible) {
        setChannelVisibleColumns(channelSchemaColumnNames);
        return;
      }
      updateChannelFilterModel({});
      setChannelVisibleColumns([]);
      return;
    }
    if (visible) {
      setVisibleColumns(displaySchema.map((column) => column.column_name));
      return;
    }
    updateExternalFilterModel({});
    setVisibleColumns([]);
  }, [channelSchemaColumnNames, displaySchema, updateChannelFilterModel, updateExternalFilterModel, viewScope]);

  const handleUpdateSpecialMapping = useCallback((
    field: 'transcriptColumn' | 'descriptionColumn' | 'tagColumn',
    column?: string,
  ) => {
    const normalizedColumn = column ? String(column).trim() : undefined;
    const previousValue = specialMappings[field] || undefined;
    if (previousValue === normalizedColumn) return;

    const nextSpecialMappings: Partial<SpecialMappings> = {
      ...specialMappings,
      [field]: normalizedColumn,
    };
    const nextRows = applySupportMappings(sourceRows, nextSpecialMappings, {
      previousMappings: specialMappings,
      sourceSchemaColumns: new Set(sourceSchema.map((entry) => entry.column_name)),
    });
    const fieldLabel = field === 'transcriptColumn'
      ? 'transcript'
      : field === 'descriptionColumn'
        ? 'video description'
        : 'imported tags';

    setSpecialMappings(nextSpecialMappings);
    setSourceRows(nextRows);
    markDerivedSnapshotsStale('Special field mapping changed. Refresh linking summary and channel metadata.');
    setDatasetVersion((version) => version + 1);
    appendResearchHistory({
      type: 'special_mapping_updated',
      summary: `Updated ${fieldLabel} mapping from Edit view.`,
      details: `Transcript: ${nextSpecialMappings.transcriptColumn || 'unmapped'}; Description: ${nextSpecialMappings.descriptionColumn || 'unmapped'}; Tags: ${nextSpecialMappings.tagColumn || 'unmapped'}.`,
      meta: {
        source: 'edit_view',
        field,
        previousValue: previousValue || null,
        nextValue: normalizedColumn || null,
      },
    });
  }, [appendResearchHistory, markDerivedSnapshotsStale, sourceRows, sourceSchema, specialMappings]);

  const handleDeleteColumn = useCallback((column: string) => {
    if (!window.confirm(`Delete column "${column}" from this project? You can restore it later from Deleted Columns.`)) return;
    clearColumnFilter(column);
    const result = deleteColumnFromProject({
      deletedColumns,
      column,
      visibleColumns,
      savedViews: state.savedViews,
      specialMappings: specialMappings as Record<string, string | undefined>,
    });
    setDeletedColumns(result.nextDeletedColumns);
    setVisibleColumns(result.nextVisibleColumns);
    setDatasetVersion((version) => version + 1);
    setSpecialMappings(result.nextSpecialMappings);
    setState((previous) => ({
      ...previous,
      schema: stripDeletedColumnsFromSchema(sourceSchema, result.nextDeletedColumns),
      savedViews: result.nextSavedViews as SavedView[],
      activeViewId: previous.activeViewId && result.nextSavedViews.some((view) => view.id === previous.activeViewId) ? previous.activeViewId : null,
    }));
    setSavedViewsVersion((version) => version + 1);
    appendResearchHistory({
      type: 'column_deleted',
      summary: `Deleted column "${column}" from the project.`,
      meta: { column },
    });
  }, [appendResearchHistory, clearColumnFilter, deletedColumns, visibleColumns, state.savedViews, sourceSchema, specialMappings]);

  const handleRestoreColumn = useCallback((column: string) => {
    setDeletedColumns((current) => current.filter((value) => value !== column));
    setDatasetVersion((version) => version + 1);
    appendResearchHistory({
      type: 'column_restored',
      summary: `Restored column "${column}" to the project.`,
      meta: { column },
    });
  }, [appendResearchHistory]);

  const handleRestoreAllColumns = useCallback(() => {
    setDeletedColumns([]);
    setDatasetVersion((version) => version + 1);
    appendResearchHistory({
      type: 'columns_restored_all',
      summary: 'Restored all deleted columns.',
    });
  }, [appendResearchHistory]);

  useEffect(() => {
    setState((previous) => ({ ...previous, schema: workingSchema }));
  }, [workingSchema]);

  const handleViewScopeChange = useCallback((scope: ViewScope) => {
    setDefaultGridResetStage(0);
    if (scope === 'channels') {
      clearChannelDrilldownState();
      clearChannelScopedVideoUniverse();
      setViewScope('channels');
      return;
    }

    if (viewScope === 'channels') {
      const nextChannelKeys = Object.keys(channelFilterModel || {}).length
        ? filteredChannelRows.map((row) => resolveChannelRowKey(row)).filter(Boolean)
        : [];
      setVideoScopeChannelKeys(nextChannelKeys.length ? Array.from(new Set(nextChannelKeys)) : null);
    } else if (!isChannelDrilldownFilterActive) {
      clearChannelScopedVideoUniverse();
    }
    setViewScope('videos');
  }, [channelFilterModel, clearChannelDrilldownState, clearChannelScopedVideoUniverse, filteredChannelRows, isChannelDrilldownFilterActive, viewScope]);

  const handleInclusionViewChange = useCallback((view: InclusionView) => {
    setInclusionView(view);
    clearScopeSelection('videos', true);
    clearScopeSelection('channels', true);
    setFilteredViewVersion((version) => version + 1);
  }, [clearScopeSelection]);

  const handleVideoChannelClick = useCallback(({ channelName, row }: { channelName: string; row: any }) => {
    const normalizedChannelName = channelName?.trim() || resolveChannelName(row);
    if (!normalizedChannelName) return;
    const channelId = resolveChannelId(row);
    requestSelectionScroll('middle');
    clearChannelDrilldownState();
    clearChannelScopedVideoUniverse();
    setChannelFilterModel({});
    setPendingViewerTarget({ kind: 'channel', channelId, channelName: normalizedChannelName });
    setViewScope('channels');
  }, [clearChannelDrilldownState, clearChannelScopedVideoUniverse, requestSelectionScroll]);

  const handleChannelNavigateToVideos = useCallback((channelRow: any) => {
    const channelName = String(channelRow?.channel_name || '').trim();
    if (!channelName) return;
    const channelKey = resolveChannelRowKey(channelRow);
    if (channelKey) {
      applyScopeSelection('channels', {
        selectedKeys: [channelKey],
        anchorKey: channelKey,
        focusKey: channelKey,
        detailKey: channelKey,
      });
    }
    if (!isChannelDrilldownFilterActive) {
      drilldownPreviousVideoFilterRef.current = filterModel;
    }
    const channelColumn = findVideoChannelColumn(displaySchema);
    if (!channelColumn) return;
    clearChannelScopedVideoUniverse();
    setVisibleColumns((current) => (
      current.includes(channelColumn)
        ? current
        : [...current, channelColumn]
    ));
    updateExternalFilterModel({
      ...filterModel,
      [channelColumn]: {
        filterKind: 'text',
        operator: 'equals',
        value: channelName,
      },
    });
    setIsChannelDrilldownFilterActive(true);
    setViewScope('videos');
    requestSelectionScroll('middle');
  }, [applyScopeSelection, clearChannelScopedVideoUniverse, displaySchema, filterModel, isChannelDrilldownFilterActive, requestSelectionScroll, updateExternalFilterModel]);

  const toggleRightPanel = useCallback(() => {
    setState((previous) => ({ ...previous, isRightPanelCollapsed: !previous.isRightPanelCollapsed }));
  }, []);

  const applyDashboardDrilldown = useCallback((args: { filters: ExplorerFilterModel; visibleColumns?: string[] }) => {
    setIsDashboardOpen(false);
    clearChannelDrilldownState();
    clearChannelScopedVideoUniverse();
    setChannelFilterModel({});
    if (viewScope !== 'videos') {
      setViewScope('videos');
    }
    if (args.visibleColumns?.length) {
      const schemaColumns = new Set(displaySchema.map((column) => column.column_name));
      const mappedColumns = args.visibleColumns.map((column) => {
        if (schemaColumns.has(column)) return column;
        if (column === 'videoCategoryLabel') return findDashboardCategoryColumn(displaySchema) || column;
        return column;
      }).filter((column) => schemaColumns.has(column));
      setVisibleColumns((current) => joinUnique([...current, ...mappedColumns]));
    }
    const schemaColumns = new Set(displaySchema.map((column) => column.column_name));
    const normalizedDrilldownFilters = Object.fromEntries(
      Object.entries(args.filters || {}).flatMap(([column, model]) => {
        if (!model) return [];
        if (schemaColumns.has(column)) return [[column, model] as const];
        if (column === 'videoCategoryLabel') {
          const mapped = findDashboardCategoryColumn(displaySchema);
          if (mapped) return [[mapped, model] as const];
        }
        return [];
      }),
    ) as ExplorerFilterModel;
    const dashboardDrilldownColumns = new Set<string>([
      ...LINKING_FILTER_COLUMNS,
      findDashboardCategoryColumn(displaySchema) || '',
      findDashboardTopicColumn(displaySchema) || '',
      findDashboardDurationColumn(displaySchema) || '',
      findDashboardIntentColumn(displaySchema) || '',
      ...Object.keys(normalizedDrilldownFilters || {}),
    ].filter(Boolean));
    const preservedNonLinkFilters = Object.fromEntries(
      Object.entries(filterModel || {}).filter(([column]) => !dashboardDrilldownColumns.has(column)),
    ) as ExplorerFilterModel;
    const nextFilterModel = {
      ...preservedNonLinkFilters,
      ...normalizedDrilldownFilters,
    };
    setState((previous) => ({ ...previous, activeViewId: null }));
    updateExternalFilterModel(nextFilterModel);
    setDashboardScope('filtered');
  }, [clearChannelDrilldownState, displaySchema, filterModel, updateExternalFilterModel, viewScope]);

  const handleApplyDashboardContentFilter = useCallback((kind: 'category' | 'topic' | 'duration' | 'intent', label: string) => {
    if (!label.trim()) return;
    const nextFilterModel = kind === 'category'
      ? (() => {
          const column = findDashboardCategoryColumn(displaySchema);
          if (!column) return null;
          return {
            [column]: {
              values: [label],
              matchMode: 'any',
            },
          } as ExplorerFilterModel;
        })()
      : kind === 'topic'
        ? (() => {
            const column = findDashboardTopicColumn(displaySchema);
            if (!column) return null;
            return {
              [column]: {
                values: [label],
                matchMode: 'any',
              },
            } as ExplorerFilterModel;
          })()
        : kind === 'duration'
        ? (() => {
            const column = findDashboardDurationColumn(displaySchema);
            if (!column) return null;
            let model: ExplorerFilterModel[string] = null;
            if (label === '<1m') {
              model = { filterKind: 'duration', operator: 'lt' as any, value: '60' };
            } else if (label == '1-5m') {
              model = { filterKind: 'duration', operator: 'between' as any, value: '60..300' };
            } else if (label == '5-15m') {
              model = { filterKind: 'duration', operator: 'between' as any, value: '300..900' };
            } else if (label == '15-30m') {
              model = { filterKind: 'duration', operator: 'between' as any, value: '900..1800' };
            } else if (label == '30m+') {
              model = { filterKind: 'duration', operator: 'gte' as any, value: '1800' };
            } else if (label == 'unknown') {
              model = { filterKind: 'duration', operator: 'eq' as any, value: '' };
            }
            return model ? ({ [column]: model } as ExplorerFilterModel) : null;
          })()
        : (() => {
            const column = findDashboardIntentColumn(displaySchema);
            if (!column) return null;
            return {
              [column]: {
                values: [label],
                matchMode: 'any',
              },
            } as ExplorerFilterModel;
          })();

    if (!nextFilterModel) return;
    applyDashboardDrilldown({ filters: nextFilterModel, visibleColumns: Object.keys(nextFilterModel) });
  }, [applyDashboardDrilldown, displaySchema]);

  const handleInsertResearchDiaryDate = useCallback(() => {
    const formatter = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const heading = `## ${formatter.format(new Date())}`;
    setState((previous) => {
      const current = previous.projectNotes || '';
      const trimmed = current.trimEnd();
      const nextNotes = trimmed.length === 0
        ? `${heading}

`
        : `${trimmed}

${heading}

`;
      return { ...previous, projectNotes: nextNotes };
    });
  }, []);

  const commandPaletteCommands = useMemo(() => {
    const commands = [
      {
        id: 'dashboard-thumbnails',
        label: 'Open thumbnails dashboard',
        description: 'Jump straight to the thumbnails tab in the dataset dashboard.',
        keywords: ['thumbnail thumbs dashboard dataset'],
        shortcut: 'Alt/Option + Shift + T',
        onSelect: () => handleOpenDatasetDashboardTab('thumbnails'),
      },
      {
        id: 'dashboard-attention',
        label: 'Open attention dashboard',
        description: 'Open the attention tab in the dataset dashboard.',
        keywords: ['attention dashboard dataset'],
        shortcut: 'Alt/Option + Shift + A',
        onSelect: () => handleOpenDatasetDashboardTab('attention'),
      },
      {
        id: 'dashboard-content',
        label: 'Open content dashboard',
        description: 'Open the content tab in the dataset dashboard.',
        keywords: ['content dashboard dataset'],
        shortcut: 'Alt/Option + Shift + C',
        onSelect: () => handleOpenDatasetDashboardTab('content'),
      },
      {
        id: 'dashboard-linking',
        label: 'Open linking dashboard',
        description: 'Open the linking analysis tab in the dataset dashboard.',
        keywords: ['linking links urls domains dashboard'],
        onSelect: () => handleOpenDatasetDashboardTab('linking'),
      },
      {
        id: 'dashboard-overview',
        label: 'Open overview dashboard',
        description: 'Open the overview tab in the dataset dashboard.',
        keywords: ['overview dashboard dataset'],
        shortcut: 'Alt/Option + Shift + O',
        onSelect: () => handleOpenDatasetDashboardTab('overview'),
      },
      {
        id: 'toggle-columns',
        label: 'Open edit view / toggle columns',
        description: 'Show the column visibility dialog.',
        keywords: ['columns edit view visibility'],
        shortcut: 'Alt/Option + Shift + V',
        onSelect: () => setIsColumnsOpen(true),
      },
      {
        id: 'reset-column-order',
        label: 'Reset column order',
        description: 'Restore the current visible columns to schema order.',
        keywords: ['columns reset order'],
        onSelect: resetVisibleColumnOrder,
        disabled: viewScope !== 'videos' || !hasLoadedData,
      },
      {
        id: 'show-all-columns',
        label: 'Show all columns',
        description: 'Reveal every imported project column in the explorer.',
        keywords: ['columns show all visible'],
        onSelect: showAllColumns,
        disabled: viewScope !== 'videos' || !hasLoadedData,
      },
      {
        id: 'hide-optional-columns',
        label: 'Hide optional columns',
        description: 'Trim the explorer back to a compact core set of fields.',
        keywords: ['columns compact minimal optional'],
        onSelect: hideOptionalColumns,
        disabled: viewScope !== 'videos' || !hasLoadedData,
      },
      {
        id: 'open-export',
        label: 'Open export dialog',
        description: 'Prepare a CSV, markdown, or project export.',
        keywords: ['export download save'],
        shortcut: 'Alt/Option + Shift + E',
        onSelect: () => setIsExportOpen(true),
      },
      {
        id: 'open-import',
        label: 'Import data',
        description: 'Open the import flow and choose a file.',
        keywords: ['import upload merge csv'],
        shortcut: 'Alt/Option + Shift + I',
        onSelect: handleRequestImport,
      },
      {
        id: 'open-shortcuts-help',
        label: 'Open keyboard shortcuts help',
        description: 'Show the compact keyboard shortcuts reference.',
        keywords: ['shortcuts keyboard help cheatsheet'],
        shortcut: 'Alt/Option + Shift + K',
        onSelect: () => setIsKeyboardHelpOpen(true),
      },
      {
        id: 'save-view',
        label: 'Save current view',
        description: 'Open the save view popover and focus the name field.',
        keywords: ['save view project state'],
        shortcut: 'Ctrl/Cmd + S',
        onSelect: handleOpenSaveView,
      },
      {
        id: 'research-log',
        label: 'Open research log',
        description: 'Jump into the research log and diary workspace.',
        keywords: ['research log diary notes'],
        onSelect: handleOpenResearchLog,
      },
      {
        id: 'switch-videos-view',
        label: 'Switch to videos view',
        description: 'Return the grid to the video-level explorer.',
        keywords: ['videos scope grid'],
        onSelect: () => handleViewScopeChange('videos'),
      },
      {
        id: 'switch-channels-view',
        label: 'Switch to channels view',
        description: channelRows.length
          ? 'Open the channel-level explorer table.'
          : 'Switch to channels view. Generate metadata first if needed.',
        keywords: ['channels scope grid creators'],
        onSelect: () => handleViewScopeChange('channels'),
      },
      {
        id: 'generate-channel-metadata',
        label: channelMetadataSnapshot?.rows?.length ? 'Refresh channel metadata' : 'Generate channel metadata',
        description: channelMetadataSnapshot?.rows?.length
          ? (isChannelMetadataFresh
              ? 'Rebuild channel metadata from the current include/exclude state.'
              : 'Refresh stale channel metadata from the current include/exclude state.')
          : 'Build the channel-level dataset from the current videos.',
        keywords: ['generate channels metadata', 'refresh channels metadata'],
        onSelect: handleGenerateChannelMetadata,
        disabled: isGeneratingChannelMetadata || !hasLoadedData,
      },
      {
        id: 'open-annotations',
        label: 'Open annotations',
        description: 'Open the annotation panel and focus notes mode.',
        keywords: ['annotations notes detail panel'],
        onSelect: handleOpenAnnotations,
        disabled: !hasLoadedData,
      },
      {
        id: 'clear-filters',
        label: 'Clear all filters',
        description: 'Reset saved-view, video filters, channel filters, and hidden drilldown state.',
        keywords: ['clear filters reset default view'],
        onSelect: clearAllExplorerFilters,
        disabled: !hasLoadedData,
      },
      {
        id: 'toggle-inclusion-view',
        label: inclusionView === 'included' ? 'Show excluded videos' : 'Show included videos',
        description: 'Flip the explorer between included and excluded rows.',
        keywords: ['included excluded filter scope'],
        onSelect: () => handleInclusionViewChange(inclusionView === 'included' ? 'excluded' : 'included'),
        disabled: viewScope !== 'videos',
      },
      {
        id: 'toggle-detail-panel',
        label: state.isRightPanelCollapsed ? 'Show detail panel' : 'Hide detail panel',
        description: 'Toggle the right-hand detail panel.',
        keywords: ['detail panel right sidebar'],
        onSelect: toggleRightPanel,
        disabled: !hasLoadedData,
      },
      {
        id: 'toggle-theme',
        label: state.theme === 'dark' ? 'Switch to warm-light mode' : 'Switch to dark mode',
        description: 'Toggle the app theme.',
        keywords: ['theme dark light warm pink'],
        onSelect: () => setState((previous) => ({ ...previous, theme: previous.theme === 'warm-light' ? 'dark' : 'warm-light' })),
      },
    ];

    return commands.filter((command) => !command.disabled || command.id === 'generate-channel-metadata');
  }, [
    channelMetadataSnapshot?.rows,
    channelRows.length,
    clearAllExplorerFilters,
    handleGenerateChannelMetadata,
    handleInclusionViewChange,
    handleOpenDatasetDashboardTab,
    handleOpenAnnotations,
    handleOpenResearchLog,
    handleViewScopeChange,
    handleOpenSaveView,
    handleRequestImport,
    hasLoadedData,
    hideOptionalColumns,
    isChannelMetadataFresh,
    inclusionView,
    isGeneratingChannelMetadata,
    resetVisibleColumnOrder,
    showAllColumns,
    state.isRightPanelCollapsed,
    state.theme,
    toggleRightPanel,
    viewScope,
    datasetVersion,
    inclusionView,
  ]);
  const handleGridReady = useCallback((api: GridApi) => {
    gridApiRef.current = api;
    setGridReadyVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    if (viewScope !== 'videos') return;
    if (!gridApiRef.current) return;
    const focusId = videoSelection.focusKey || videoSelection.detailKey || videoSelection.anchorKey || videoSelection.selectedKeys[0] || null;
    if (!focusId) return;
    const node = gridApiRef.current.getRowNode(focusId);
    if (typeof node?.rowIndex === 'number') {
      if (selectionScrollModeRef.current === 'middle') {
        gridApiRef.current.ensureIndexVisible(node.rowIndex, 'middle');
        selectionScrollModeRef.current = 'none';
      }
    }
  }, [videoSelection, viewScope]);

  useEffect(() => {
    if (viewScope !== 'channels') return;
    if (!gridApiRef.current) return;
    const channelKey = channelSelection.focusKey
      || channelSelection.detailKey
      || channelSelection.anchorKey
      || selectedChannelKeys[0]
      || '';
    if (!channelKey) return;
    const node = gridApiRef.current.getRowNode(channelKey);
    if (typeof node?.rowIndex === 'number') {
      if (selectionScrollModeRef.current === 'middle') {
        gridApiRef.current.ensureIndexVisible(node.rowIndex, 'middle');
        selectionScrollModeRef.current = 'none';
      }
    }
  }, [channelSelection.anchorKey, channelSelection.detailKey, channelSelection.focusKey, gridReadyVersion, selectedChannelKeys, viewScope]);

  const handleDashboardNavigateToVideo = useCallback((videoId: string) => {
    setIsDashboardOpen(false);
    requestSelectionScroll('middle');
    if (!rows.some((row) => resolveVideoId(row) === videoId)) {
      clearAllExplorerFilters();
    }
    setPendingViewerTarget({ kind: 'video', videoId });
  }, [clearAllExplorerFilters, requestSelectionScroll, rows]);

  const handleDashboardNavigateToChannel = useCallback((channel: { channelId?: string | null; channelName?: string }) => {
    setIsDashboardOpen(false);
    requestSelectionScroll('middle');
    clearChannelDrilldownState();
    clearChannelScopedVideoUniverse();
    setChannelFilterModel({});
    const hasMatchingChannelRow = channelRowsWithLinking.some((row) => {
      const rowChannelId = String(row?.channel_id || '').trim();
      const rowChannelName = String(row?.channel_name || '').trim();
      return (channel.channelId && rowChannelId === String(channel.channelId).trim())
        || (channel.channelName && rowChannelName === String(channel.channelName).trim());
    });
    if (!hasMatchingChannelRow) {
      const hasMatchingVideoRow = rows.some((row) => {
        const rowChannelId = resolveChannelId(row);
        const rowChannelName = resolveChannelName(row);
        return (channel.channelId && rowChannelId === channel.channelId)
          || (channel.channelName && rowChannelName === channel.channelName);
      });
      if (!hasMatchingVideoRow) {
        clearAllExplorerFilters();
      }
    }
    setPendingViewerTarget({ kind: 'channel', channelId: channel.channelId, channelName: channel.channelName });
  }, [channelRowsWithLinking, clearAllExplorerFilters, clearChannelDrilldownState, requestSelectionScroll, rows]);

  useEffect(() => {
    if (!pendingViewerTarget) return;

    if (pendingViewerTarget.kind === 'video') {
      if (viewScope !== 'videos') {
        setViewScope('videos');
        return;
      }
      const targetRow = rows.find((row) => resolveVideoId(row) === pendingViewerTarget.videoId);
      if (!targetRow) return;
      requestSelectionScroll('middle');
      applyScopeSelection('videos', {
        selectedKeys: [pendingViewerTarget.videoId],
        anchorKey: pendingViewerTarget.videoId,
        focusKey: pendingViewerTarget.videoId,
        detailKey: pendingViewerTarget.videoId,
      });
      setPendingViewerTarget(null);
      return;
    }

    const channelRow = channelRowsWithLinking.find((row) => {
      const rowChannelId = String(row?.channel_id || '').trim();
      const rowChannelName = String(row?.channel_name || '').trim();
      return (pendingViewerTarget.channelId && rowChannelId === String(pendingViewerTarget.channelId).trim())
        || (pendingViewerTarget.channelName && rowChannelName === String(pendingViewerTarget.channelName).trim());
    });
    if (channelRow) {
      if (viewScope !== 'channels') {
        setViewScope('channels');
        return;
      }
      const channelKey = resolveChannelRowKey(channelRow);
      requestSelectionScroll('middle');
      applyScopeSelection('channels', {
        selectedKeys: channelKey ? [channelKey] : [],
        anchorKey: channelKey || null,
        focusKey: channelKey || null,
        detailKey: channelKey || null,
      });
      setPendingViewerTarget(null);
      return;
    }

    if (viewScope !== 'channels') {
      setViewScope('channels');
      return;
    }
    requestSelectionScroll('middle');
    clearScopeSelection('channels', false);
    setPendingViewerTarget(null);
  }, [applyScopeSelection, channelRowsWithLinking, clearScopeSelection, pendingViewerTarget, requestSelectionScroll, rows, viewScope]);

  const currentNavigationEntry = useMemo<AppNavigationEntry>(() => ({
    viewScope,
    inclusionView,
    activeViewId: state.activeViewId,
    filterModel,
    channelFilterModel,
    selectedVideoId: viewScope === 'videos' ? selectedVideoId : null,
    channelId: viewScope === 'channels' ? String(selectedChannelDetailRow?.channel_id || '').trim() || null : null,
    channelName: viewScope === 'channels' ? String(selectedChannelDetailRow?.channel_name || '').trim() || null : null,
    videoScopeChannelKeys: videoScopeChannelKeys?.length ? videoScopeChannelKeys : null,
    isChannelDrilldownFilterActive,
    drilldownPreviousVideoFilter: drilldownPreviousVideoFilterRef.current ?? null,
  }), [channelFilterModel, filterModel, inclusionView, isChannelDrilldownFilterActive, selectedChannelDetailRow?.channel_id, selectedChannelDetailRow?.channel_name, selectedVideoId, state.activeViewId, videoScopeChannelKeys, viewScope]);

  useEffect(() => {
    if (!hasLoadedData) return;
    const entryKey = JSON.stringify(currentNavigationEntry);
    if (navigationRestoreInFlightRef.current) {
      navigationRestoreInFlightRef.current = false;
      lastNavigationKeyRef.current = entryKey;
      return;
    }
    if (lastNavigationKeyRef.current === entryKey) return;
    lastNavigationKeyRef.current = entryKey;
    setNavigationHistory((current) => {
      const base = navigationCursor >= 0 ? current.slice(0, navigationCursor + 1) : current;
      const last = base[base.length - 1];
      if (last && JSON.stringify(last) === entryKey) return base;
      const next = [...base, currentNavigationEntry];
      setNavigationCursor(next.length - 1);
      return next.slice(-120);
    });
  }, [currentNavigationEntry, hasLoadedData, navigationCursor]);

  const handleRenameProject = useCallback((nextName: string) => {
    const trimmed = nextName.trim();
    if (!trimmed) return;
    setState((previous) => {
      if ((previous.fileName || '').trim() === trimmed) return previous;
      return { ...previous, fileName: trimmed };
    });
    appendResearchHistory({
      type: 'project_renamed' as any,
      summary: `Renamed project to "${trimmed}".`,
      meta: { projectName: trimmed },
    });
  }, [appendResearchHistory]);

  const saveView = useCallback((name: string) => {
    if (viewScope !== 'videos') {
      setViewScope('videos');
      return;
    }
    const trimmedName = name.trim();
    if (state.theme === 'warm-light' && trimmedName.toLowerCase() === 'princess chaos') {
      setState((previous) => ({ ...previous, theme: 'pink-pop' }));
      return;
    }
    if (!gridApiRef.current) return;
    const newView: SavedView = {
      id: Math.random().toString(36).substring(7),
      name: trimmedName,
      columnState: gridApiRef.current.getColumnState(),
      filterModel,
      visibleColumns: [...visibleColumns],
      createdAt: Date.now(),
    };
    setState((previous) => ({ ...previous, savedViews: [...previous.savedViews, newView], activeViewId: newView.id }));
    setSavedViewsVersion((version) => version + 1);
    appendResearchHistory({
      type: 'saved_view_created',
      summary: `Saved view "${trimmedName}" created.`,
      meta: { viewId: newView.id, viewName: trimmedName },
    });
  }, [appendResearchHistory, filterModel, state.theme, viewScope, visibleColumns]);

  const deleteView = useCallback((id: string) => {
    const deletedView = state.savedViews.find((view) => view.id === id);
    setState((previous) => ({
      ...previous,
      savedViews: previous.savedViews.filter((view) => view.id !== id),
      activeViewId: previous.activeViewId === id ? null : previous.activeViewId,
    }));
    setSavedViewsVersion((version) => version + 1);
    setThumbnailCaches((current) => {
      const key = buildSavedViewThumbnailScopeKey(id);
      if (!current[key]) return current;
      revokeThumbnailUrls(current[key]);
      const next = { ...current };
      delete next[key];
      return next;
    });
    appendResearchHistory({
      type: 'saved_view_deleted',
      summary: `Saved view "${deletedView?.name || id}" deleted.`,
      meta: { viewId: id, viewName: deletedView?.name || '' },
    });
    if (state.activeViewId === id) {
      updateExternalFilterModel({});
    }
  }, [appendResearchHistory, state.activeViewId, state.savedViews, updateExternalFilterModel]);

  const applyView = useCallback((view: SavedView | null) => {
    clearChannelDrilldownState({ restoreVideoFilters: false });
    clearChannelScopedVideoUniverse();
    if (!view) {
      const isFirstReset = defaultGridResetStage === 0;
      flushSync(() => {
        setViewScope('videos');
        setChannelFilterModel({});
        clearScopeSelection('videos', true);
        clearScopeSelection('channels', true);
        setState((previous) => ({ ...previous, activeViewId: null }));
        updateExternalFilterModel({});
      });
      if (isFirstReset) {
        setDefaultGridResetStage(1);
        return;
      }
      resetVideoLayoutToDefault();
      resetChannelLayoutToDefault();
      setDefaultGridResetStage(0);
      return;
    }
    setDefaultGridResetStage(0);
    if (gridApiRef.current && view.columnState?.length) gridApiRef.current.applyColumnState({ state: view.columnState, applyOrder: true });
    flushSync(() => {
      setViewScope('videos');
      setChannelFilterModel({});
      clearScopeSelection('videos', true);
      clearScopeSelection('channels', true);
      setState((previous) => ({ ...previous, activeViewId: view.id || null }));
      updateExternalFilterModel((view.filterModel || {}) as ExplorerFilterModel);
    });
  }, [clearChannelDrilldownState, clearChannelScopedVideoUniverse, clearScopeSelection, defaultGridResetStage, resetChannelLayoutToDefault, resetVideoLayoutToDefault, updateExternalFilterModel]);

  useEffect(() => {
    const validSavedViewKeys = new Set(state.savedViews.map((view) => buildSavedViewThumbnailScopeKey(view.id)));
    setThumbnailCaches((current) => {
      let changed = false;
      const next: Record<string, DashboardThumbnailCacheSnapshot> = {};
      (Object.entries(current as Record<string, DashboardThumbnailCacheSnapshot>) as Array<[string, DashboardThumbnailCacheSnapshot]>).forEach(([key, snapshot]) => {
        if (isSavedViewThumbnailScopeKey(key) && !validSavedViewKeys.has(key)) {
          changed = true;
          revokeThumbnailUrls(snapshot);
          return;
        }
        next[key] = snapshot;
      });
      return changed ? next : current;
    });
  }, [state.savedViews]);

  useEffect(() => {
    setThumbnailCaches((current) => {
      if (!current[FILTERED_TEMP_THUMBNAIL_SCOPE]) return current;
      const next = { ...current };
      revokeThumbnailUrls(next[FILTERED_TEMP_THUMBNAIL_SCOPE] as DashboardThumbnailCacheSnapshot);
      delete next[FILTERED_TEMP_THUMBNAIL_SCOPE];
      return next;
    });
  }, [filteredViewVersion]);

  const handleApplyTagFilter = useCallback((tag: string, source: 'imported' | 'user', append = false) => {
    if (!tag) return;
    const mappedTagColumn = source === 'imported'
      ? (specialMappings.tagColumn && workingSchema.some((column) => column.column_name === specialMappings.tagColumn)
          ? specialMappings.tagColumn
          : null)
      : null;
    const tagColumn = source === 'user' ? USER_TAGS_COLUMN : (mappedTagColumn || resolveTagFilterColumn(workingSchema));
    if (!tagColumn) return;

    setVisibleColumns((current) => current.includes(tagColumn) ? current : [...current, tagColumn]);

    const currentModel = filterModel[tagColumn] as any;
    const currentValues = Array.isArray(currentModel?.values) ? currentModel.values.map((value: any) => String(value)) : [];
    const nextValues = append && currentValues.length > 0
      ? Array.from(new Set([...currentValues, tag]))
      : [tag];

    updateExternalFilterModel({
      ...filterModel,
      [tagColumn]: { values: nextValues, matchMode: 'any' },
    });
  }, [filterModel, specialMappings.tagColumn, updateExternalFilterModel, workingSchema]);
  const includedDisplayRows = useMemo(
    () => buildDisplayRows(includedBaseRowsWithGenerated, userTagsByVideoId),
    [includedBaseRowsWithGenerated, userTagsByVideoId],
  );
  const includedBooleanMapColumns = useMemo(
    () => detectBooleanMapColumns(includedDisplayRows, displaySchema),
    [includedDisplayRows, displaySchema],
  );
  const includedListLikeColumns = useMemo(
    () => detectListLikeColumns(includedDisplayRows, displaySchema, includedBooleanMapColumns),
    [includedBooleanMapColumns, includedDisplayRows, displaySchema],
  );
  const activeSavedView = useMemo(
    () => state.savedViews.find((view) => view.id === state.activeViewId) || null,
    [state.activeViewId, state.savedViews],
  );
  const activeSavedViewThumbnailScopeKey = activeSavedView ? buildSavedViewThumbnailScopeKey(activeSavedView.id) : null;
  const isActiveSavedViewFilterAligned = useMemo(() => {
    if (!activeSavedView) return false;
    return JSON.stringify(activeSavedView.filterModel || {}) === JSON.stringify(filterModel || {});
  }, [activeSavedView, filterModel]);

  const effectiveThumbnailScopeKey = useMemo(() => {
    if (dashboardScope === 'full') return 'full';
    if (thumbnailCaches[FILTERED_TEMP_THUMBNAIL_SCOPE]) return FILTERED_TEMP_THUMBNAIL_SCOPE;
    if (
      isActiveSavedViewFilterAligned
      && activeSavedViewThumbnailScopeKey
      && thumbnailCaches[activeSavedViewThumbnailScopeKey]
    ) {
      return activeSavedViewThumbnailScopeKey;
    }
    return FILTERED_TEMP_THUMBNAIL_SCOPE;
  }, [activeSavedViewThumbnailScopeKey, dashboardScope, isActiveSavedViewFilterAligned, thumbnailCaches]);
  const effectiveThumbnailCache = thumbnailCaches[effectiveThumbnailScopeKey];
  const thumbnailTileSize = THUMBNAIL_ZOOM_STEPS[thumbnailZoomIndex] ?? THUMBNAIL_ZOOM_STEPS[2];
  const canThumbnailZoomOut = thumbnailZoomIndex > 0;
  const canThumbnailZoomIn = thumbnailZoomIndex < THUMBNAIL_ZOOM_STEPS.length - 1;

  const handleThumbnailZoomOut = useCallback(() => {
    setThumbnailZoomIndex((current) => Math.max(0, current - 1));
  }, []);

  const handleThumbnailZoomIn = useCallback(() => {
    setThumbnailZoomIndex((current) => Math.min(THUMBNAIL_ZOOM_STEPS.length - 1, current + 1));
  }, []);

  const loadDashboardThumbnails = useCallback((mode: 'full' | 'filtered') => {
    const primaryScopeKey: string = mode === 'full' ? 'full' : FILTERED_TEMP_THUMBNAIL_SCOPE;
    const sourceRowsForLoad = mode === 'full' ? includedBaseRows : rows;
    const sourceRowCount = sourceRowsForLoad.length;
    const sortRules = mode === 'filtered' ? videoSortRules : [];
    const sortSignature = buildThumbnailSortSignature(sortRules);
    const candidates = selectThumbnailCandidates({
      rows: sourceRowsForLoad,
      sortRules: mode === 'filtered' ? sortRules : undefined,
      limit: THUMBNAIL_LIMIT,
    });
    const mirrorSavedViewScopeKey = mode === 'filtered' && activeSavedView ? buildSavedViewThumbnailScopeKey(activeSavedView.id) : null;
    const targetScopes = [
      {
        scopeKey: primaryScopeKey,
        label: resolveThumbnailCacheLabel(primaryScopeKey as 'full' | 'filtered-temp'),
        savedViewsVersionAtCalculation: undefined as number | undefined,
      },
      ...(mirrorSavedViewScopeKey ? [{
        scopeKey: mirrorSavedViewScopeKey,
        label: resolveThumbnailCacheLabel(mirrorSavedViewScopeKey, activeSavedView?.name),
        savedViewsVersionAtCalculation: savedViewsVersion,
      }] : []),
    ];
    const sessionIdByScope = new Map<string, number>();
    targetScopes.forEach((target) => {
      thumbnailLoadTokenRef.current += 1;
      sessionIdByScope.set(target.scopeKey, thumbnailLoadTokenRef.current);
    });

    const seedSnapshot = mode === 'filtered'
      ? thumbnailCachesRef.current.full
      : undefined;
    const primaryEntries = buildThumbnailEntriesFromCacheSeed({
      candidates,
      seedSnapshot,
    });
    const primaryProgress = summarizeThumbnailProgress(primaryEntries);
    setThumbnailLoadProgress({
      scopeKey: primaryScopeKey as DashboardThumbnailLoadProgress['scopeKey'],
      label: targetScopes[0].label,
      total: primaryProgress.total,
      completed: primaryProgress.completed,
      failed: primaryProgress.failed,
      loading: primaryProgress.loading,
    });

    setThumbnailCaches((current) => {
      const next = { ...current };
      targetScopes.forEach((target) => {
        const sessionId = sessionIdByScope.get(target.scopeKey) ?? 0;
        const entries = target.scopeKey === primaryScopeKey
          ? primaryEntries
          : buildThumbnailEntriesFromCacheSeed({ candidates, seedSnapshot });
        const nextSnapshot: DashboardThumbnailCacheSnapshot = {
          scopeKey: target.scopeKey as DashboardThumbnailCacheSnapshot['scopeKey'],
          label: target.label,
          sessionId,
          rowCount: sourceRowCount,
          totalCandidates: primaryEntries.length,
          calculatedAt: new Date().toISOString(),
          datasetVersionAtCalculation: datasetVersion,
          filteredViewVersionAtCalculation: mode === 'filtered' ? filteredViewVersion : undefined,
          savedViewsVersionAtCalculation: target.savedViewsVersionAtCalculation,
          sortSignature,
          entries,
        };
        revokeDroppedThumbnailUrls(current[target.scopeKey], nextSnapshot);
        next[target.scopeKey] = nextSnapshot;
      });
      return next;
    });
  }, [
    activeSavedView,
    datasetVersion,
    filteredViewVersion,
    includedBaseRows,
    rows,
    savedViewsVersion,
    videoSortRules,
  ]);

  const handleLoadFullDashboardThumbnails = useCallback(() => {
    loadDashboardThumbnails('full');
  }, [loadDashboardThumbnails]);

  const handleLoadFilteredDashboardThumbnails = useCallback(() => {
    loadDashboardThumbnails('filtered');
  }, [loadDashboardThumbnails]);

  useEffect(() => {
    if (dashboardScope !== 'filtered') return;
    if (thumbnailCaches[FILTERED_TEMP_THUMBNAIL_SCOPE]) return;
    if (
      isActiveSavedViewFilterAligned
      && activeSavedViewThumbnailScopeKey
      && thumbnailCaches[activeSavedViewThumbnailScopeKey]
    ) {
      return;
    }

    const sortRules = videoSortRules;
    const sortSignature = buildThumbnailSortSignature(sortRules);
    const candidates = selectThumbnailCandidates({
      rows,
      sortRules,
      limit: THUMBNAIL_LIMIT,
    });
    const entries = buildThumbnailEntriesFromCacheSeed({
      candidates,
      seedSnapshot: thumbnailCaches.full,
    });
    const sessionId = thumbnailLoadTokenRef.current + 1;
    thumbnailLoadTokenRef.current = sessionId;
    const nextSnapshot: DashboardThumbnailCacheSnapshot = {
      scopeKey: FILTERED_TEMP_THUMBNAIL_SCOPE as DashboardThumbnailCacheSnapshot['scopeKey'],
      label: resolveThumbnailCacheLabel('filtered-temp'),
      sessionId,
      rowCount: rows.length,
      totalCandidates: entries.length,
      calculatedAt: new Date().toISOString(),
      datasetVersionAtCalculation: datasetVersion,
      filteredViewVersionAtCalculation: filteredViewVersion,
      sortSignature,
      entries,
    };

    setThumbnailCaches((current) => {
      if (current[FILTERED_TEMP_THUMBNAIL_SCOPE]) return current;
      return {
        ...current,
        [FILTERED_TEMP_THUMBNAIL_SCOPE]: nextSnapshot,
      };
    });

    const summary = summarizeThumbnailProgress(entries);
    setThumbnailLoadProgress({
      scopeKey: FILTERED_TEMP_THUMBNAIL_SCOPE as DashboardThumbnailLoadProgress['scopeKey'],
      label: nextSnapshot.label,
      total: summary.total,
      completed: summary.completed,
      failed: summary.failed,
      loading: summary.loading,
    });
  }, [
    activeSavedViewThumbnailScopeKey,
    dashboardScope,
    datasetVersion,
    filteredViewVersion,
    isActiveSavedViewFilterAligned,
    rows,
    thumbnailCaches,
    videoSortRules,
  ]);

  const updateThumbnailEntryForScope = useCallback((
    scopeKey: DashboardThumbnailCacheSnapshot['scopeKey'],
    dedupeKey: string,
    updater: (entry: DashboardThumbnailCacheSnapshot['entries'][number]) => DashboardThumbnailCacheSnapshot['entries'][number],
    expectedSessionId?: number,
  ) => {
    let nextEntriesForProgress: DashboardThumbnailCacheSnapshot['entries'] | null = null;
    let nextLabelForProgress = '';
    setThumbnailCaches((current) => {
      const scopeSnapshot = current[scopeKey];
      if (!scopeSnapshot?.entries?.length) return current;
      if (Number.isFinite(expectedSessionId) && scopeSnapshot.sessionId !== Number(expectedSessionId)) return current;
      const entryIndex = scopeSnapshot.entries.findIndex((entry) => entry.dedupeKey === dedupeKey);
      if (entryIndex < 0) return current;
      const previousEntry = scopeSnapshot.entries[entryIndex];
      const nextEntry = updater(previousEntry);
      if (nextEntry === previousEntry) return current;
      const entries = [...scopeSnapshot.entries];
      if (previousEntry.objectUrl && nextEntry.objectUrl && previousEntry.objectUrl !== nextEntry.objectUrl) {
        URL.revokeObjectURL(previousEntry.objectUrl);
      }
      entries[entryIndex] = nextEntry;
      const nextSnapshot: DashboardThumbnailCacheSnapshot = {
        ...scopeSnapshot,
        calculatedAt: new Date().toISOString(),
        entries,
      };
      nextEntriesForProgress = entries;
      nextLabelForProgress = nextSnapshot.label;
      return {
        ...current,
        [scopeKey]: nextSnapshot,
      };
    });
    if (!nextEntriesForProgress) return;
    setThumbnailLoadProgress((current) => {
      if (!current || current.scopeKey !== scopeKey) return current;
      const summary = summarizeThumbnailProgress(nextEntriesForProgress || []);
      return {
        ...current,
        label: nextLabelForProgress || current.label,
        total: summary.total,
        completed: summary.completed,
        failed: summary.failed,
        loading: summary.loading,
      };
    });
  }, []);

  const handleThumbnailEntryLoad = useCallback((
    scopeKey: DashboardThumbnailCacheSnapshot['scopeKey'],
    sessionId: number,
    dedupeKey: string,
    candidateIndex: number,
    loadedUrl?: string,
  ) => {
    updateThumbnailEntryForScope(scopeKey, dedupeKey, (entry) => {
      const resolvedUrl = String(loadedUrl || entry.objectUrl || entry.activeUrl || entry.sourceUrl || '').trim();
      if (!resolvedUrl) return entry;
      const urls = Array.from(new Set(
        (entry.candidateUrls || [entry.activeUrl, entry.sourceUrl, resolvedUrl])
          .map((url) => String(url || '').trim())
          .filter(Boolean),
      ));
      const normalizedCandidateIndex = Math.max(0, Math.min(Math.floor(candidateIndex), Math.max(urls.length - 1, 0)));
      if (Number.isFinite(entry.activeCandidateIndex) && Number(entry.activeCandidateIndex) !== normalizedCandidateIndex) {
        return entry;
      }
      if (
        entry.status === 'loaded'
        && entry.activeUrl === resolvedUrl
        && (entry.fallbackIndex ?? 0) === normalizedCandidateIndex
        && (entry.activeCandidateIndex ?? 0) === normalizedCandidateIndex
      ) {
        return entry;
      }
      return {
        ...entry,
        status: 'loaded',
        sourceUrl: urls[normalizedCandidateIndex] || entry.sourceUrl,
        activeUrl: resolvedUrl,
        candidateUrls: urls,
        fallbackIndex: normalizedCandidateIndex,
        activeCandidateIndex: normalizedCandidateIndex,
        error: undefined,
      };
    }, sessionId);
  }, [updateThumbnailEntryForScope]);

  const handleThumbnailEntryError = useCallback((
    scopeKey: DashboardThumbnailCacheSnapshot['scopeKey'],
    sessionId: number,
    dedupeKey: string,
    candidateIndex: number,
    failedUrl?: string,
  ) => {
    updateThumbnailEntryForScope(scopeKey, dedupeKey, (entry) => {
      const urls = Array.from(new Set(
        (entry.candidateUrls || [entry.activeUrl, entry.sourceUrl])
          .map((url) => String(url || '').trim())
          .filter(Boolean),
      ));
      if (!urls.length) {
        if (entry.status === 'failed' && !entry.activeUrl) return entry;
        return {
          ...entry,
          status: 'failed',
          activeUrl: '',
          fallbackIndex: 0,
          activeCandidateIndex: -1,
          candidateUrls: [],
          error: entry.error || 'No thumbnail URL available',
        };
      }
      const normalizedCandidateIndex = Math.max(0, Math.min(Math.floor(candidateIndex), Math.max(urls.length - 1, 0)));
      if (Number.isFinite(entry.activeCandidateIndex) && Number(entry.activeCandidateIndex) !== normalizedCandidateIndex) {
        return entry;
      }
      const currentUrl = String(failedUrl || entry.activeUrl || '').trim();
      const currentIndex = currentUrl ? urls.findIndex((url) => url === currentUrl) : -1;
      const fallbackIndex = Math.max(0, Math.min(
        Number.isFinite(entry.activeCandidateIndex) ? Number(entry.activeCandidateIndex) : (entry.fallbackIndex ?? 0),
        urls.length - 1,
      ));
      const baseIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
      const nextIndex = baseIndex + 1;
      if (nextIndex < urls.length) {
        const nextUrl = urls[nextIndex];
        if (
          entry.status === 'pending'
          && entry.activeUrl === nextUrl
          && fallbackIndex === nextIndex
          && (entry.activeCandidateIndex ?? nextIndex) === nextIndex
        ) {
          return entry;
        }
        return {
          ...entry,
          status: 'pending',
          sourceUrl: nextUrl,
          activeUrl: nextUrl,
          candidateUrls: urls,
          fallbackIndex: nextIndex,
          activeCandidateIndex: nextIndex,
          error: undefined,
        };
      }
      if (
        entry.status === 'failed'
        && !entry.activeUrl
        && fallbackIndex === urls.length - 1
        && (entry.activeCandidateIndex ?? fallbackIndex) === fallbackIndex
      ) {
        return entry;
      }
      return {
        ...entry,
        status: 'failed',
        activeUrl: '',
        candidateUrls: urls,
        fallbackIndex: urls.length - 1,
        activeCandidateIndex: urls.length - 1,
        error: entry.error || 'Failed to load thumbnail',
      };
    }, sessionId);
  }, [updateThumbnailEntryForScope]);

  const handleRetryFailedDashboardThumbnails = useCallback(() => {
    let nextEntriesForProgress: DashboardThumbnailCacheSnapshot['entries'] | null = null;
    let nextLabelForProgress = '';
    setThumbnailCaches((current) => {
      const scopeSnapshot = current[effectiveThumbnailScopeKey];
      if (!scopeSnapshot?.entries?.length) return current;
      let changed = false;
      const entries = scopeSnapshot.entries.map((entry) => {
        if (entry.status !== 'failed') return entry;
        const urls = Array.from(new Set(
          (entry.candidateUrls || [entry.sourceUrl])
            .map((url) => String(url || '').trim())
            .filter(Boolean),
        ));
        if (!urls.length) return entry;
        changed = true;
        return {
          ...entry,
          status: 'pending' as const,
          sourceUrl: urls[0],
          activeUrl: urls[0],
          candidateUrls: urls,
          fallbackIndex: 0,
          activeCandidateIndex: 0,
          error: undefined,
        };
      });
      if (!changed) return current;
      thumbnailLoadTokenRef.current += 1;
      const nextSnapshot: DashboardThumbnailCacheSnapshot = {
        ...scopeSnapshot,
        sessionId: thumbnailLoadTokenRef.current,
        calculatedAt: new Date().toISOString(),
        entries,
      };
      nextEntriesForProgress = entries;
      nextLabelForProgress = nextSnapshot.label;
      return {
        ...current,
        [effectiveThumbnailScopeKey]: nextSnapshot,
      };
    });
    if (!nextEntriesForProgress) return;
    setThumbnailLoadProgress((current) => {
      if (!current || current.scopeKey !== effectiveThumbnailScopeKey) return current;
      const summary = summarizeThumbnailProgress(nextEntriesForProgress || []);
      return {
        ...current,
        label: nextLabelForProgress || current.label,
        total: summary.total,
        completed: summary.completed,
        failed: summary.failed,
        loading: summary.loading,
      };
    });
  }, [effectiveThumbnailScopeKey]);

  const createScopeDashboardSnapshot = useCallback((scope: DashboardScope, scopedRows: any[]): DatasetDashboardSnapshot => ({
    scope,
    stats: buildDatasetDashboardStats(scopedRows),
    template: buildDashboardTemplateSnapshot({
      rows: scopedRows,
      annotations: state.annotations,
      importedChannelMetadata,
      datasetLabel: state.fileName,
      scope,
    }),
    rowCount: scopedRows.length,
    calculatedAt: new Date().toISOString(),
    datasetVersionAtCalculation: datasetVersion,
    filteredViewVersionAtCalculation: scope === 'filtered' ? filteredViewVersion : undefined,
  }), [datasetVersion, filteredViewVersion, importedChannelMetadata, state.annotations, state.fileName]);

  const createSavedViewDashboardSnapshot = useCallback((view: SavedView): SavedViewDashboardSnapshot => {
    const savedViewFilterState = buildUnifiedFilterState({
      rows: includedDisplayRows,
      schema: displaySchema,
      filterModel: view.filterModel,
      listLikeColumns: includedListLikeColumns,
      booleanMapColumns: includedBooleanMapColumns,
    });
    const scopedRows = savedViewFilterState.filteredRows;
    return {
      savedViewId: view.id,
      savedViewName: view.name,
      stats: buildDatasetDashboardStats(scopedRows),
      template: buildDashboardTemplateSnapshot({
        rows: scopedRows,
        annotations: state.annotations,
        importedChannelMetadata,
        datasetLabel: state.fileName,
        scope: 'filtered',
        scopeLabel: `saved view: ${view.name}`,
      }),
      rowCount: scopedRows.length,
      calculatedAt: new Date().toISOString(),
      datasetVersionAtCalculation: datasetVersion,
      savedViewsVersionAtCalculation: savedViewsVersion,
    };
  }, [datasetVersion, displaySchema, importedChannelMetadata, includedBooleanMapColumns, includedDisplayRows, includedListLikeColumns, savedViewsVersion, state.annotations, state.fileName]);

  const allVisibleChannelIdsForDashboard = useMemo(() => {
    const scopedRows = dashboardScope === 'full' ? includedDisplayRows : rows;
    const channelIdColumn = detectIncomingChannelIdColumn(displaySchema);
    if (!channelIdColumn) return [];

    const seen = new Set<string>();
    const values: string[] = [];
    scopedRows.forEach((row) => {
      const value = row?.[channelIdColumn];
      if (value === null || value === undefined) return;
      const normalized = String(value).trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      values.push(normalized);
    });
    return values;
  }, [dashboardScope, displaySchema, includedDisplayRows, rows]);

  const currentLinkingRows = useMemo(
    () => (dashboardScope === 'full' ? includedBaseRowsWithGenerated : rows),
    [dashboardScope, includedBaseRowsWithGenerated, rows],
  );
  const currentLinkingDatasetFingerprint = useMemo(() => buildDatasetFingerprint({
    datasetVersion,
    inclusionView,
    rowCount: currentLinkingRows.length,
    sourceVisibility,
  }), [currentLinkingRows.length, datasetVersion, inclusionView, sourceVisibility]);
  const currentSourceVisibilityFingerprint = useMemo(
    () => buildSourceVisibilityFingerprint(sourceVisibility),
    [sourceVisibility],
  );
  const currentLinkingVideoIds = useMemo(() => new Set(collectVideoIds(currentLinkingRows)), [currentLinkingRows]);
  useEffect(() => {
    setLinkingState((current) => {
      if (!current.snapshot) return current;
      if (current.snapshot.datasetFingerprint === currentLinkingDatasetFingerprint && !current.stale) return current;
      if (current.snapshot.datasetFingerprint === currentLinkingDatasetFingerprint && current.stale) return current;
      if (
        current.stale
        && current.snapshot.datasetFingerprint !== currentLinkingDatasetFingerprint
        && current.staleReason === 'Dataset changed. Refresh linking summary.'
      ) {
        return current;
      }
      if (current.stale && current.snapshot.datasetFingerprint !== currentLinkingDatasetFingerprint) {
        return {
          ...current,
          staleReason: 'Dataset changed. Refresh linking summary.',
        };
      }
      return {
        ...current,
        stale: true,
        staleReason: 'Dataset changed. Refresh linking summary.',
      };
    });
  }, [currentLinkingDatasetFingerprint]);
  useEffect(() => {
    setChannelLinkingState((current) => {
      if (!current.snapshot) return current;
      const channelDatasetFingerprint = buildDatasetFingerprint({
        datasetVersion,
        inclusionView,
        rowCount: includedBaseRows.length,
        sourceVisibility,
      });
      if (current.snapshot.datasetFingerprint === channelDatasetFingerprint && !current.stale) return current;
      if (current.snapshot.datasetFingerprint === channelDatasetFingerprint && current.stale) return current;
      if (current.stale && current.staleReason === 'Dataset changed. Refresh channel metadata to rebuild link aggregates.') {
        return current;
      }
      return {
        ...current,
        stale: true,
        staleReason: 'Dataset changed. Refresh channel metadata to rebuild link aggregates.',
      };
    });
  }, [datasetVersion, includedBaseRows.length, inclusionView, sourceVisibility]);
  const handleSelectLinkingSource = useCallback((sourceColumn: string) => {
    if (!sourceColumn) return;
    setLinkingState((current) => ({
      ...current,
      selectedSourceColumn: sourceColumn,
      selectedSourceUpdatedAt: new Date().toISOString(),
      sourceCandidateProfiles: profileLinkingColumnCandidates(currentLinkingRows),
    }));
    appendResearchHistory({
      type: 'linking_source_selected',
      summary: `Selected linking source column "${sourceColumn}".`,
      meta: { sourceColumn },
    });
  }, [appendResearchHistory, currentLinkingRows]);
  const handleGenerateLinkingSummary = useCallback(async (sourceColumn: string) => {
    const selectedColumn = String(sourceColumn || linkingState.selectedSourceColumn || '').trim();
    if (!selectedColumn) return;

    updateLongTaskProgress({
      title: 'Generating linking summary',
      detail: `Preparing ${currentLinkingRows.length.toLocaleString()} row(s) from ${selectedColumn}`,
      completed: 1,
      total: 100,
    });

    const cacheKey = `${currentLinkingDatasetFingerprint}::${selectedColumn}`;
    try {
      await waitForNextPaint();
      const cachedStageA = linkingState.parseCacheByKey[cacheKey] as LinkingStageAResult | undefined;
      const stageA = cachedStageA && cachedStageA.sourceColumn === selectedColumn
        ? cachedStageA
        : await buildLinkingStageAAsync(currentLinkingRows, { linkColumn: selectedColumn }, (progress) => {
            updateLongTaskProgress({
              title: 'Generating linking summary',
              detail: progress.detail,
              completed: Math.min(45, Math.max(1, Math.round((progress.completed / Math.max(progress.total, 1)) * 45))),
              total: 100,
            });
          });
      const nextParseCache = cachedStageA
        ? linkingState.parseCacheByKey
        : { ...linkingState.parseCacheByKey, [cacheKey]: stageA };

      updateLongTaskProgress({
        title: 'Generating linking summary',
        detail: 'Classifying domains and building bucket summaries',
        completed: cachedStageA ? 45 : 46,
        total: 100,
      });
      await waitForNextPaint();

      const stageB = await buildLinkingStageBAsync(stageA, {
        sourceColumn: selectedColumn,
        overridesByDomain: linkingState.overridesByDomain,
      }, (progress) => {
        updateLongTaskProgress({
          title: 'Generating linking summary',
          detail: progress.detail,
          completed: Math.min(80, 46 + Math.round((progress.completed / Math.max(progress.total, 1)) * 34)),
          total: 100,
        });
      });

      updateLongTaskProgress({
        title: 'Generating linking summary',
        detail: 'Writing linking metadata back into the explorer',
        completed: 86,
        total: 100,
      });
      await waitForNextPaint();

      setGeneratedMetadata((current) => {
        const nextByVideoId: GeneratedMetadataState['byVideoId'] = { ...current.byVideoId };
        currentLinkingVideoIds.forEach((videoId) => {
          const previous = nextByVideoId[videoId];
          const linking = stageB.generatedMetadataByVideoId[videoId];
          nextByVideoId[videoId] = {
            content_intent: computedContentIntentByVideoId[videoId] || previous?.content_intent || 'other',
            linking,
          };
        });
        return { byVideoId: nextByVideoId };
      });
      setColumnLineage((current) => ensureGeneratedColumnLineage(current));
      setLinkingState((current) => ({
        ...current,
        selectedSourceColumn: selectedColumn,
        selectedSourceUpdatedAt: new Date().toISOString(),
        stale: false,
        staleReason: undefined,
        datasetFingerprint: currentLinkingDatasetFingerprint,
        sourceVisibilityFingerprint: currentSourceVisibilityFingerprint,
        parseCacheByKey: nextParseCache,
        sourceCandidateProfiles: profileLinkingColumnCandidates(currentLinkingRows),
        snapshot: {
          sourceColumn: selectedColumn,
          generatedAt: new Date().toISOString(),
          datasetFingerprint: currentLinkingDatasetFingerprint,
          stageAFingerprint: stageA.stageAFingerprint,
          overrideVersion: current.overrideVersion,
          hasLinkedRows: stageB.model.hasLinkedRows,
          model: stageB.model,
          mentionAudit: stageB.mentionAudit,
          domainAudit: stageB.domainAudit,
          rowAudit: stageB.rowAudit,
        },
      }));

      updateLongTaskProgress({
        title: 'Generating linking summary',
        detail: channelMetadataSnapshot?.rows?.length
          ? 'Refreshing channel-level link aggregates from the new linking metadata'
          : 'Finishing linking summary',
        completed: 92,
        total: 100,
      });
      await waitForNextPaint();

      if (channelMetadataSnapshot?.rows?.length) {
        setChannelLinkingState({
          stale: false,
          staleReason: undefined,
          snapshot: buildChannelLinkingSnapshot({
            rows: includedBaseRows,
            generatedMetadataByVideoId: stageB.generatedMetadataByVideoId,
          }),
        });
      } else {
        setChannelLinkingState((current) => ({
          ...current,
          stale: true,
          staleReason: 'Linking summary changed. Refresh channel metadata to rebuild channel-level link aggregates.',
        }));
      }
      appendResearchHistory({
        type: linkingState.snapshot ? 'linking_summary_refreshed' : 'linking_summary_generated',
        summary: `${linkingState.snapshot ? 'Refreshed' : 'Generated'} linking summary from "${selectedColumn}" (${currentLinkingRows.length.toLocaleString()} rows).`,
        details: `Visible sources: ${linkingSourceItems.filter((item) => item.visible).map((item) => item.label).join(', ') || 'none'}.`,
        meta: { sourceColumn: selectedColumn, rowCount: currentLinkingRows.length },
      });
      updateLongTaskProgress({
        title: 'Generating linking summary',
        detail: 'Done',
        completed: 100,
        total: 100,
      });
      await waitForNextPaint();
    } finally {
      updateLongTaskProgress(null);
    }
  }, [
    appendResearchHistory,
    channelMetadataSnapshot?.rows,
    computedContentIntentByVideoId,
    currentLinkingDatasetFingerprint,
    currentLinkingRows,
    currentLinkingVideoIds,
    currentSourceVisibilityFingerprint,
    includedBaseRows,
    linkingSourceItems,
    linkingState.overridesByDomain,
    linkingState.parseCacheByKey,
    linkingState.selectedSourceColumn,
    linkingState.snapshot,
    updateLongTaskProgress,
  ]);
  const handleApplyLinkingOverride = useCallback((args: { domain: string; baseBucket?: string; note?: string; revert?: boolean }) => {
    const domain = String(args.domain || '').trim().toLowerCase();
    if (!domain) return;

    const mutation = args.revert
      ? revertLinkingDomainOverride({ overridesByDomain: linkingState.overridesByDomain, domain })
      : applyLinkingDomainOverride({
          overridesByDomain: linkingState.overridesByDomain,
          domain,
          baseBucket: args.baseBucket as any,
          note: args.note,
        });
    const nextOverrides = mutation.overridesByDomain;
    const nextOverrideVersion = linkingState.overrideVersion + 1;

    const currentSnapshot = linkingState.snapshot;
    if (!currentSnapshot) {
      setLinkingState((current) => ({
        ...current,
        overridesByDomain: nextOverrides,
        overrideVersion: nextOverrideVersion,
        stale: true,
        staleReason: 'Override saved. Generate linking summary to apply changes.',
      }));
    } else {
      const cacheKey = `${currentSnapshot.datasetFingerprint}::${currentSnapshot.sourceColumn}`;
      const stageA = linkingState.parseCacheByKey[cacheKey] as LinkingStageAResult | undefined;
      if (!stageA) {
        setLinkingState((current) => ({
          ...current,
          overridesByDomain: nextOverrides,
          overrideVersion: nextOverrideVersion,
          stale: true,
          staleReason: 'Override saved, but parse cache is missing. Refresh linking summary.',
        }));
      } else {
        const stageB = buildLinkingStageB(stageA, {
          sourceColumn: currentSnapshot.sourceColumn,
          overridesByDomain: nextOverrides,
        });
        setGeneratedMetadata((previous) => {
          const nextByVideoId: GeneratedMetadataState['byVideoId'] = { ...previous.byVideoId };
          currentLinkingVideoIds.forEach((videoId) => {
            const previousEntry = nextByVideoId[videoId];
            nextByVideoId[videoId] = {
              content_intent: computedContentIntentByVideoId[videoId] || previousEntry?.content_intent || 'other',
              linking: stageB.generatedMetadataByVideoId[videoId],
            };
          });
          return { byVideoId: nextByVideoId };
        });
        if (channelMetadataSnapshot?.rows?.length) {
          setChannelLinkingState({
            stale: false,
            staleReason: undefined,
            snapshot: buildChannelLinkingSnapshot({
              rows: includedBaseRows,
              generatedMetadataByVideoId: stageB.generatedMetadataByVideoId,
            }),
          });
        } else {
          setChannelLinkingState((previous) => ({
            ...previous,
            stale: true,
            staleReason: 'Linking bucket overrides changed. Refresh channel metadata to rebuild channel-level link aggregates.',
          }));
        }
        setLinkingState((current) => ({
          ...current,
          overridesByDomain: nextOverrides,
          overrideVersion: nextOverrideVersion,
          stale: false,
          staleReason: undefined,
          snapshot: {
            ...currentSnapshot,
            generatedAt: new Date().toISOString(),
            overrideVersion: nextOverrideVersion,
            hasLinkedRows: stageB.model.hasLinkedRows,
            model: stageB.model,
            mentionAudit: stageB.mentionAudit,
            domainAudit: stageB.domainAudit,
            rowAudit: stageB.rowAudit,
          },
        }));
      }
    }

    const oldAssignment = currentSnapshot?.domainAudit?.find((entry: any) => entry.domain === domain);
    const stageAForEvent = currentSnapshot
      ? (linkingState.parseCacheByKey[`${currentSnapshot.datasetFingerprint}::${currentSnapshot.sourceColumn}`] as LinkingStageAResult | undefined)
      : undefined;
    const nextSnapshotDomain = currentSnapshot && stageAForEvent
      ? buildLinkingStageB(stageAForEvent, {
          sourceColumn: currentSnapshot.sourceColumn,
          overridesByDomain: nextOverrides,
        }).domainAudit.find((entry) => entry.domain === domain)
      : undefined;
    const previouslyUnmapped = Boolean(oldAssignment?.unmapped);
    const eventType = args.revert
      ? 'linking_bucket_override_reverted'
      : mutation.previous
        ? 'linking_bucket_override_changed'
        : 'linking_bucket_override_created';
    appendResearchHistory({
      type: eventType as any,
      summary: args.revert
        ? `Reverted linking override for ${domain}.`
        : mutation.previous
          ? `Changed linking bucket override for ${domain}.`
          : `Assigned linking buckets for ${domain}.`,
      details: `Ecology bucket: ${oldAssignment?.currentBaseBucket || oldAssignment?.baseBucket || 'auto'} -> ${nextSnapshotDomain?.currentBaseBucket || nextSnapshotDomain?.baseBucket || 'auto'}.`,
      meta: {
        domain,
        oldBaseBucket: oldAssignment?.currentBaseBucket || oldAssignment?.baseBucket || null,
        newBaseBucket: nextSnapshotDomain?.currentBaseBucket || nextSnapshotDomain?.baseBucket || null,
        previouslyUnmapped,
      },
    });
  }, [appendResearchHistory, channelMetadataSnapshot?.rows, computedContentIntentByVideoId, currentLinkingVideoIds, includedBaseRows, linkingState]);
  const handleApplyLinkingOverrideBatch = useCallback(async (assignments: Array<{ domain: string; baseBucket: string }>) => {
    const cleaned = assignments
      .map((entry) => ({
        domain: String(entry.domain || '').trim().toLowerCase(),
        baseBucket: String(entry.baseBucket || '').trim() || 'other',
      }))
      .filter((entry) => entry.domain);
    if (!cleaned.length) return;

    let nextOverrides = linkingState.overridesByDomain;
    cleaned.forEach((entry) => {
      nextOverrides = applyLinkingDomainOverride({
        overridesByDomain: nextOverrides,
        domain: entry.domain,
        baseBucket: entry.baseBucket as any,
      }).overridesByDomain;
    });
    const nextOverrideVersion = linkingState.overrideVersion + cleaned.length;

    const currentSnapshot = linkingState.snapshot;
    if (!currentSnapshot) {
      setLinkingState((current) => ({
        ...current,
        overridesByDomain: nextOverrides,
        overrideVersion: nextOverrideVersion,
        stale: true,
        staleReason: 'Override saved. Generate linking summary to apply changes.',
      }));
      appendResearchHistory({
        type: 'linking_bucket_override_changed' as any,
        summary: `Updated ecology buckets for ${cleaned.length} domains.`,
        meta: { domainCount: cleaned.length },
      });
      return;
    }

    const cacheKey = `${currentSnapshot.datasetFingerprint}::${currentSnapshot.sourceColumn}`;
    const stageA = linkingState.parseCacheByKey[cacheKey] as LinkingStageAResult | undefined;
    if (!stageA) {
      setLinkingState((current) => ({
        ...current,
        overridesByDomain: nextOverrides,
        overrideVersion: nextOverrideVersion,
        stale: true,
        staleReason: 'Override saved, but parse cache is missing. Refresh linking summary.',
      }));
      appendResearchHistory({
        type: 'linking_bucket_override_changed' as any,
        summary: `Updated ecology buckets for ${cleaned.length} domains.`,
        meta: { domainCount: cleaned.length },
      });
      return;
    }

    updateLongTaskProgress({
      title: 'Saving ecology buckets',
      detail: `Applying ${cleaned.length.toLocaleString()} domain reassignment(s)`,
      completed: 1,
      total: 100,
    });
    try {
      await waitForNextPaint();
      const stageB = await buildLinkingStageBAsync(stageA, {
        sourceColumn: currentSnapshot.sourceColumn,
        overridesByDomain: nextOverrides,
      }, (progress) => {
        updateLongTaskProgress({
          title: 'Saving ecology buckets',
          detail: progress.detail,
          completed: Math.min(88, 8 + Math.round((progress.completed / Math.max(progress.total, 1)) * 80)),
          total: 100,
        });
      });

      updateLongTaskProgress({
        title: 'Saving ecology buckets',
        detail: 'Writing updated ecology labels back into the explorer',
        completed: 92,
        total: 100,
      });
      await waitForNextPaint();

      setGeneratedMetadata((previous) => {
        const nextByVideoId: GeneratedMetadataState['byVideoId'] = { ...previous.byVideoId };
        currentLinkingVideoIds.forEach((videoId) => {
          const previousEntry = nextByVideoId[videoId];
          nextByVideoId[videoId] = {
            content_intent: computedContentIntentByVideoId[videoId] || previousEntry?.content_intent || 'other',
            linking: stageB.generatedMetadataByVideoId[videoId],
          };
        });
        return { byVideoId: nextByVideoId };
      });
      if (channelMetadataSnapshot?.rows?.length) {
        setChannelLinkingState({
          stale: false,
          staleReason: undefined,
          snapshot: buildChannelLinkingSnapshot({
            rows: includedBaseRows,
            generatedMetadataByVideoId: stageB.generatedMetadataByVideoId,
          }),
        });
      } else {
        setChannelLinkingState((previous) => ({
          ...previous,
          stale: true,
          staleReason: 'Linking bucket overrides changed. Refresh channel metadata to rebuild channel-level link aggregates.',
        }));
      }
      setLinkingState((current) => ({
        ...current,
        overridesByDomain: nextOverrides,
        overrideVersion: nextOverrideVersion,
        stale: false,
        staleReason: undefined,
        snapshot: {
          ...currentSnapshot,
          generatedAt: new Date().toISOString(),
          overrideVersion: nextOverrideVersion,
          hasLinkedRows: stageB.model.hasLinkedRows,
          model: stageB.model,
          mentionAudit: stageB.mentionAudit,
          domainAudit: stageB.domainAudit,
          rowAudit: stageB.rowAudit,
        },
      }));
      appendResearchHistory({
        type: 'linking_bucket_override_changed' as any,
        summary: `Updated ecology buckets for ${cleaned.length} domains.`,
        details: `Selected source: ${currentSnapshot.sourceColumn}.`,
        meta: { domainCount: cleaned.length, sourceColumn: currentSnapshot.sourceColumn },
      });
      updateLongTaskProgress({
        title: 'Saving ecology buckets',
        detail: 'Done',
        completed: 100,
        total: 100,
      });
      await waitForNextPaint();
    } finally {
      updateLongTaskProgress(null);
    }
  }, [appendResearchHistory, channelMetadataSnapshot?.rows, computedContentIntentByVideoId, currentLinkingVideoIds, includedBaseRows, linkingState, updateLongTaskProgress]);
  const currentDashboardSnapshot = dashboardSnapshots[dashboardScope];
  const isDashboardSnapshotStale = useMemo(() => {
    if (!currentDashboardSnapshot) return false;
    if (currentDashboardSnapshot.datasetVersionAtCalculation !== datasetVersion) return true;
    if (currentDashboardSnapshot.scope === 'filtered') {
      return currentDashboardSnapshot.filteredViewVersionAtCalculation !== filteredViewVersion;
    }
    return false;
  }, [currentDashboardSnapshot, datasetVersion, filteredViewVersion]);

  const savedViewSnapshotStaleById = useMemo(() => {
    const byId: Record<string, boolean> = {};
    state.savedViews.forEach((view) => {
      const snapshot = savedViewDashboardSnapshots[view.id];
      if (!snapshot) {
        byId[view.id] = true;
        return;
      }
      byId[view.id] = snapshot.datasetVersionAtCalculation !== datasetVersion
        || snapshot.savedViewsVersionAtCalculation !== savedViewsVersion
        || snapshot.savedViewName !== view.name;
    });
    return byId;
  }, [datasetVersion, savedViewDashboardSnapshots, savedViewsVersion, state.savedViews]);

  const isAnyDashboardSnapshotStale = useMemo(() => {
    const full = dashboardSnapshots.full;
    const filtered = dashboardSnapshots.filtered;
    const fullStale = !full || full.datasetVersionAtCalculation !== datasetVersion;
    const filteredStale = !filtered || (
      filtered.datasetVersionAtCalculation !== datasetVersion
      || filtered.filteredViewVersionAtCalculation !== filteredViewVersion
    );
    const savedViewStale = Object.values(savedViewSnapshotStaleById).some(Boolean);
    return fullStale || filteredStale || savedViewStale;
  }, [dashboardSnapshots.filtered, dashboardSnapshots.full, datasetVersion, filteredViewVersion, savedViewSnapshotStaleById]);

  const handleRefreshDashboard = useCallback(async () => {
    const scopedRows = dashboardScope === 'full' ? includedDisplayRows : rows;
    updateLongTaskProgress({
      title: 'Refreshing dashboard',
      detail: 'Rebuilding the active dashboard snapshot',
      completed: 1,
      total: 2,
      indeterminate: true,
    });
    try {
      await waitForNextPaint();
      const snapshot = createScopeDashboardSnapshot(dashboardScope, scopedRows);
      updateLongTaskProgress({
        title: 'Refreshing dashboard',
        detail: 'Applying refreshed dashboard data',
        completed: 2,
        total: 2,
      });
      setDashboardSnapshots((previous) => ({ ...previous, [dashboardScope]: snapshot }));
    } finally {
      updateLongTaskProgress(null);
    }
  }, [createScopeDashboardSnapshot, dashboardScope, includedDisplayRows, rows, updateLongTaskProgress]);

  const recalculateAllDashboardSnapshots = useCallback(async () => {
    const totalSteps = Math.max(3, state.savedViews.length + 2);
    updateLongTaskProgress({
      title: 'Recalculating dashboards',
      detail: 'Building full-dataset snapshot',
      completed: 1,
      total: totalSteps,
      indeterminate: true,
    });
    try {
      await waitForNextPaint();
      const nextSnapshots: Partial<Record<DashboardScope, DatasetDashboardSnapshot>> = {
        full: createScopeDashboardSnapshot('full', includedDisplayRows),
      };
      updateLongTaskProgress({
        title: 'Recalculating dashboards',
        detail: 'Building filtered snapshot',
        completed: 2,
        total: totalSteps,
        indeterminate: true,
      });
      await waitForNextPaint();
      nextSnapshots.filtered = createScopeDashboardSnapshot('filtered', rows);
      const nextSavedViewSnapshots: Record<string, SavedViewDashboardSnapshot> = {};
      for (const [index, view] of state.savedViews.entries()) {
        updateLongTaskProgress({
          title: 'Recalculating dashboards',
          detail: `Building saved view snapshot ${index + 1} of ${state.savedViews.length}`,
          completed: 3 + index,
          total: totalSteps,
          indeterminate: true,
        });
        await waitForNextPaint();
        nextSavedViewSnapshots[view.id] = createSavedViewDashboardSnapshot(view);
      }

      setDashboardSnapshots(nextSnapshots);
      setSavedViewDashboardSnapshots(nextSavedViewSnapshots);
      appendResearchHistory({
        type: 'dashboard_snapshots_recalculated',
        summary: `Recalculated dataset and saved-view dashboard snapshots (${state.savedViews.length.toLocaleString()} saved view snapshot(s)).`,
      });
    } finally {
      updateLongTaskProgress(null);
    }
  }, [appendResearchHistory, createSavedViewDashboardSnapshot, createScopeDashboardSnapshot, includedDisplayRows, rows, state.savedViews, updateLongTaskProgress]);

  const cleanedResearchHistory = useMemo(() => {
    const events = researchHistory.filter((event) => !event.reverted);
    const pairedDeletes = new Set<string>();
    const pairedCreates = new Set<string>();
    const createdByViewId = new Map<string, string>();

    events.forEach((event) => {
      const viewId = typeof event.meta?.viewId === 'string' ? event.meta.viewId : null;
      if (!viewId) return;
      if (event.type === 'saved_view_created') createdByViewId.set(viewId, event.id);
      if (event.type === 'saved_view_deleted' && createdByViewId.has(viewId)) {
        pairedDeletes.add(event.id);
        pairedCreates.add(createdByViewId.get(viewId)!);
      }
    });

    return events.filter((event) => !pairedDeletes.has(event.id) && !pairedCreates.has(event.id));
  }, [researchHistory]);

  const exclusionReasonCounts = useMemo(() => {
    const counts = new Map<string, number>();
    excludedVideoIds.forEach((videoId) => {
      const reason = excludedVideoMetaById[videoId]?.reason?.trim() || 'unspecified';
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [excludedVideoIds, excludedVideoMetaById]);

  const savedViewLiveRows = useMemo(() => {
    return Object.fromEntries(state.savedViews.map((view) => {
      const filtered = buildUnifiedFilterState({
        rows: includedDisplayRows,
        schema: displaySchema,
        filterModel: view.filterModel,
        listLikeColumns: includedListLikeColumns,
        booleanMapColumns: includedBooleanMapColumns,
      }).filteredRows;
      return [view.id, filtered];
    })) as Record<string, any[]>;
  }, [displaySchema, includedBooleanMapColumns, includedDisplayRows, includedListLikeColumns, state.savedViews]);

  const dashboardSnapshotIndex = useMemo(() => {
    const items: Array<{ id: string; label: string; rowCount: number; calculatedAt: string | null; stale: boolean; summary: string }> = [];
    const fullSnapshot = dashboardSnapshots.full;
    items.push({
      id: 'full',
      label: 'Full dataset snapshot',
      rowCount: fullSnapshot?.rowCount ?? includedBaseRows.length,
      calculatedAt: fullSnapshot?.calculatedAt ?? null,
      stale: !fullSnapshot || fullSnapshot.datasetVersionAtCalculation !== datasetVersion,
      summary: fullSnapshot?.template?.detailedSummaryText || fullSnapshot?.template?.summaryText || (fullSnapshot ? summarizeDashboardSnapshot(fullSnapshot) : 'Not calculated yet'),
    });
    const filteredSnapshot = dashboardSnapshots.filtered;
    items.push({
      id: 'filtered',
      label: 'Current filtered snapshot',
      rowCount: filteredSnapshot?.rowCount ?? rows.length,
      calculatedAt: filteredSnapshot?.calculatedAt ?? null,
      stale: !filteredSnapshot || filteredSnapshot.datasetVersionAtCalculation !== datasetVersion
        || filteredSnapshot.filteredViewVersionAtCalculation !== filteredViewVersion,
      summary: filteredSnapshot?.template?.detailedSummaryText || filteredSnapshot?.template?.summaryText || (filteredSnapshot ? summarizeDashboardSnapshot(filteredSnapshot) : 'Not calculated yet'),
    });
    state.savedViews.forEach((view) => {
      const snapshot = savedViewDashboardSnapshots[view.id];
      items.push({
        id: `saved-${view.id}`,
        label: `Saved view: ${view.name}`,
        rowCount: snapshot?.rowCount ?? (savedViewLiveRows[view.id]?.length ?? 0),
        calculatedAt: snapshot?.calculatedAt ?? null,
        stale: savedViewSnapshotStaleById[view.id] ?? true,
        summary: snapshot?.template?.detailedSummaryText || snapshot?.template?.summaryText || (snapshot ? summarizeDashboardSnapshot(snapshot) : 'Not calculated yet'),
      });
    });
    return items;
  }, [dashboardSnapshots.filtered, dashboardSnapshots.full, datasetVersion, filteredViewVersion, includedBaseRows.length, rows.length, savedViewDashboardSnapshots, savedViewLiveRows, savedViewSnapshotStaleById, state.savedViews]);

  const corpusProcessingSectionText = useMemo(() => {
    const importEvents = cleanedResearchHistory
      .filter((event) => event.type === 'import_replace_completed' || event.type === 'import_merge_completed')
      .slice(-8);
    const mappingSummary = [
      `Merge key: ${specialMappings.mergeKeyColumn || 'not configured'}`,
      `Transcript mapping: ${specialMappings.transcriptColumn || 'unmapped'}`,
      `Description mapping: ${specialMappings.descriptionColumn || 'unmapped'}`,
      `Tag mapping: ${specialMappings.tagColumn || 'unmapped'}`,
    ];
    const durableColumnSummary = deletedColumns.length
      ? `Durable deleted columns: ${deletedColumns.join(', ')}`
      : 'Durable deleted columns: none';
    const exclusionSummary = exclusionReasonCounts.length
      ? exclusionReasonCounts.map(([reason, count]) => `- ${reason}: ${count}`).join('\n')
      : 'No entries recorded';
    return [
      `Source file(s): ${state.fileName || 'No file loaded'}`,
      `Imported at: ${sourceRows.length ? parseDateLabel(new Date().toISOString()) : 'No entries recorded'}`,
      '',
      `Import / merge milestones:`,
      importEvents.length
        ? importEvents.map((event) => `- ${formatDateDisplay(event.createdAt)} - ${event.summary}${event.details ? ` (${event.details})` : ''}`).join('\n')
        : 'No entries recorded',
      '',
      `Special mappings in effect:`,
      ...mappingSummary.map((line) => `- ${line}`),
      `- ${durableColumnSummary}`,
      '',
      `Source visibility state:`,
      `- Registered sources: ${sourceRegistry.orderedIds.length.toLocaleString()}`,
      `- Hidden row sources: ${(sourceVisibility.hiddenSourceIds || []).length.toLocaleString()}`,
      `- Visible row sources: ${(sourceRegistry.orderedIds.length - (sourceVisibility.hiddenSourceIds || []).length).toLocaleString()}`,
      `- Hidden video-column sources: ${(sourceVisibility.hiddenColumnSourceIdsByScope?.videos || []).length.toLocaleString()}`,
      `- Hidden channel-column sources: ${(sourceVisibility.hiddenColumnSourceIdsByScope?.channels || []).length.toLocaleString()}`,
      '',
      `Final corpus size:`,
      `- Included rows: ${includedBaseRows.length.toLocaleString()}`,
      `- Excluded rows: ${excludedBaseRows.length.toLocaleString()}`,
      `- Column count: ${workingSchema.length.toLocaleString()}`,
      `- Deeper reproducibility details are preserved in project zip export.`,
      '',
      `Inclusion / Exclusion`,
      `- Included videos: ${includedBaseRows.length.toLocaleString()}`,
      `- Explicitly excluded videos: ${excludedVideoIds.length.toLocaleString()}`,
      `- Exclusion reason categories:`,
      exclusionSummary,
      `- Exclusions are reversible through include/restore actions in the app.`,
      `- Filtered or hidden videos inside views are not equal to corpus exclusion.`,
    ].join('\n');
  }, [
    cleanedResearchHistory,
    deletedColumns,
    excludedBaseRows.length,
    excludedVideoIds.length,
    exclusionReasonCounts,
    includedBaseRows.length,
    sourceRegistry.orderedIds.length,
    sourceRows.length,
    sourceVisibility.hiddenColumnSourceIdsByScope,
    sourceVisibility.hiddenSourceIds,
    specialMappings.descriptionColumn,
    specialMappings.mergeKeyColumn,
    specialMappings.tagColumn,
    specialMappings.transcriptColumn,
    state.fileName,
    workingSchema.length,
  ]);

  const viewsSectionText = useMemo(() => {
    if (!state.savedViews.length) return 'No entries recorded';
    const lines: string[] = [
      'Saved views document analytical lenses; they do not change corpus inclusion/exclusion.',
      '',
    ];
    state.savedViews.forEach((view, index) => {
      const snapshot = savedViewDashboardSnapshots[view.id];
      const columnOrder = Array.isArray(view.columnState)
        ? view.columnState.map((column: any) => column?.colId).filter(Boolean).join(', ')
        : '';
      const liveRows = savedViewLiveRows[view.id] || [];
      lines.push(
        `${index + 1}. ${view.name}`,
        `   Created: ${formatDateDisplay(new Date(view.createdAt).toISOString())}`,
        `   Filter summary: ${summarizeFilterModel(view.filterModel as ExplorerFilterModel)}`,
        `   Visible columns/order: ${columnOrder || 'No column state recorded'}`,
        `   Row count snapshot: ${(snapshot?.rowCount ?? liveRows.length).toLocaleString()}`,
        `   Dashboard summary snapshot: ${snapshot ? (snapshot.template?.summaryText || summarizeDashboardSnapshot(snapshot)).replace(/\n/g, ' | ') : 'No snapshot calculated yet'}`,
        '',
      );
    });
    return lines.join('\n').trim();
  }, [savedViewDashboardSnapshots, savedViewLiveRows, state.savedViews]);

  const watchHistoryEntries = useMemo<WatchHistoryEntry[]>(() => (
    (Object.values(watchHistoryByVideoId) as WatchHistoryEntry[]).sort((a, b) => Date.parse(b.lastWatchedAt) - Date.parse(a.lastWatchedAt))
  ), [watchHistoryByVideoId]);

  const watchHistorySectionText = useMemo(() => {
    if (!watchHistoryEntries.length) return 'No entries recorded';
    const totalWatchSeconds = watchHistoryEntries.reduce((sum, entry) => sum + entry.totalWatchSeconds, 0);
    const averagePct = watchHistoryEntries.reduce((sum, entry) => {
      if (!entry.durationSeconds || entry.durationSeconds <= 0) return sum;
      return sum + Math.min(1, entry.totalWatchSeconds / entry.durationSeconds);
    }, 0) / Math.max(1, watchHistoryEntries.length);
    const lines: string[] = [
      `Total watch time across corpus: ${formatDurationLabel(totalWatchSeconds)}`,
      `Unique videos watched: ${watchHistoryEntries.length.toLocaleString()}`,
      `Average percentage watched: ${(averagePct * 100).toFixed(1)}%`,
      '',
    ];
    watchHistoryEntries.forEach((entry, index) => {
      const pct = entry.durationSeconds && entry.durationSeconds > 0
        ? Math.min(1, entry.totalWatchSeconds / entry.durationSeconds) * 100
        : null;
      const rewatchCount = Math.max(0, entry.qualifyingSessionCount - 1);
      lines.push(
        `${index + 1}. ${entry.title}`,
        `   video id: ${entry.videoId}`,
        `   first watched: ${formatDateDisplay(entry.firstWatchedAt)}`,
        `   last watched: ${formatDateDisplay(entry.lastWatchedAt)}`,
        `   total time watched: ${formatDurationLabel(entry.totalWatchSeconds)}`,
        `   watch session count: ${entry.qualifyingSessionCount.toLocaleString()}`,
        `   rewatch count: ${rewatchCount.toLocaleString()}`,
        `   percentage watched: ${pct === null ? 'unknown' : `${pct.toFixed(1)}%`}`,
        '',
      );
    });
    return lines.join('\n').trim();
  }, [watchHistoryEntries]);

  const researchActionsSectionText = useMemo(() => {
    const meaningful = cleanedResearchHistory.filter((event) => (
      event.type !== 'videos_restored' || (event.affectedIds?.length ?? 0) > 0
    ));
    const tagUsage = buildTagUsageSummary(userTagsByVideoId);
    if (!meaningful.length && !tagUsage.length) return 'No entries recorded';
    const lines: string[] = [];
    if (meaningful.length) {
      lines.push('Timeline of meaningful research actions:');
      meaningful.slice(-60).forEach((event) => {
        lines.push(`- ${formatDateDisplay(event.createdAt)} - ${event.summary}${event.details ? ` (${event.details})` : ''}`);
      });
      lines.push('');
    }
    lines.push('Current tag usage summary:');
    if (!tagUsage.length) {
      lines.push('No entries recorded');
    } else {
      tagUsage.forEach(([tag, count]) => lines.push(`- ${tag}: applied to ${count.toLocaleString()} video(s)`));
    }
    return lines.join('\n');
  }, [cleanedResearchHistory, userTagsByVideoId]);

  const notesAppendixSectionText = useMemo(() => {
    const rowByVideoId = new Map<string, any>();
    sourceRows.forEach((row) => {
      const videoId = resolveVideoId(row);
      if (videoId && !rowByVideoId.has(videoId)) rowByVideoId.set(videoId, row);
    });
    const noteVideoIds = Array.from(new Set([
      ...Object.keys(notesByVideoId),
      ...Object.keys(state.annotations),
      ...Object.keys(userTagsByVideoId),
    ])).filter((videoId) => {
      const notes = notesByVideoId[videoId] || '';
      const annotation = state.annotations[videoId];
      const tags = userTagsByVideoId[videoId] || [];
      return Boolean(notes.trim()) || Boolean(annotation?.quoteRefs?.length) || Boolean(annotation?.timestampRefs?.length) || tags.length > 0;
    });
    if (!noteVideoIds.length) return 'No entries recorded';
    const lines: string[] = [];
    noteVideoIds.forEach((videoId, index) => {
      const row = rowByVideoId.get(videoId);
      const annotation = state.annotations[videoId];
      const tags = userTagsByVideoId[videoId] || [];
      const noteText = (notesByVideoId[videoId] || '').trim() || 'No notes';
      const quotes = annotation?.quoteRefs || [];
      const timestamps = annotation?.timestampRefs || [];
      lines.push(
        `${index + 1}. ${row ? resolveVideoTitle(row) : 'Untitled Video'}`,
        `   video id: ${videoId}`,
        `   user tags: ${tags.length ? tags.join(', ') : 'none'}`,
        `   notes:`,
        noteText.split('\n').map((line) => `     ${line}`).join('\n'),
        `   quotes: ${quotes.length ? quotes.map((quote) => quote.text).join(' | ') : 'none'}`,
        `   timestamps: ${timestamps.length ? timestamps.map((item) => item.label).join(', ') : 'none'}`,
        '',
      );
    });
    return lines.join('\n').trim();
  }, [notesByVideoId, sourceRows, state.annotations, userTagsByVideoId]);

  const dashboardSectionText = useMemo(() => {
    if (!dashboardSnapshotIndex.length && !linkingState.snapshot) return 'No entries recorded';
    const snapshotText = dashboardSnapshotIndex.map((item) => [
      `${item.label}`,
      `- rows: ${item.rowCount.toLocaleString()}`,
      `- calculated: ${item.calculatedAt ? formatDateDisplay(item.calculatedAt) : 'not calculated'}`,
      `- status: ${item.stale ? 'stale' : 'fresh'}`,
      `- calculations write-up:`,
      item.summary.split('\n').map((line) => `  ${line}`).join('\n'),
    ].join('\n')).join('\n\n');
    const linkingBlock = linkingState.snapshot ? [
      `Linking summary`,
      `- source column: ${linkingState.snapshot.sourceColumn}`,
      `- generated: ${formatDateDisplay(linkingState.snapshot.generatedAt)}`,
      `- status: ${linkingState.stale ? 'stale' : 'fresh'}`,
      `- linked rows: ${Number((linkingState.snapshot.model as any)?.summary?.linkedRows || 0).toLocaleString()}`,
      `- total urls: ${Number((linkingState.snapshot.model as any)?.summary?.totalUrls || 0).toLocaleString()}`,
      `- unique domains: ${Number((linkingState.snapshot.model as any)?.summary?.uniqueDomains || 0).toLocaleString()}`,
      `- override count: ${Object.keys(linkingState.overridesByDomain || {}).length.toLocaleString()}`,
      `- visible source fingerprint: ${linkingState.sourceVisibilityFingerprint || 'n/a'}`,
    ].join('\n') : 'Linking summary\n- not generated yet';
    const channelLinkingBlock = [
      `Channel link aggregates`,
      `- status: ${channelLinkingState.stale ? 'stale' : 'fresh'}`,
      `- generated: ${channelLinkingState.snapshot?.generatedAt ? formatDateDisplay(channelLinkingState.snapshot.generatedAt) : 'not generated'}`,
      `- channels covered: ${Object.keys(channelLinkingState.snapshot?.byChannelKey || {}).length.toLocaleString()}`,
    ].join('\n');
    return [snapshotText, linkingBlock, channelLinkingBlock].filter(Boolean).join('\n\n');
  }, [channelLinkingState.snapshot, channelLinkingState.stale, dashboardSnapshotIndex, linkingState.overridesByDomain, linkingState.snapshot, linkingState.sourceVisibilityFingerprint, linkingState.stale]);

  const researchLogGeneratedSections = useMemo(() => ({
    corpusProcessing: corpusProcessingSectionText,
    views: viewsSectionText,
    watchHistory: watchHistorySectionText,
    researchActions: researchActionsSectionText,
    notesAppendix: notesAppendixSectionText,
    dashboard: dashboardSectionText,
  }), [corpusProcessingSectionText, dashboardSectionText, notesAppendixSectionText, researchActionsSectionText, viewsSectionText, watchHistorySectionText]);

  const researchLogGeneratedSectionsWithComments = useMemo(() => {
    const applyComment = (key: ResearchLogCommentSectionId, baseText: string) => {
      const comment = (state.researchLogSectionComments[key] || '').trim();
      if (!comment) return baseText;
      return `${baseText}\n\nResearcher comment:\n${comment}`;
    };
    return {
      corpusProcessing: applyComment('corpusProcessing', researchLogGeneratedSections.corpusProcessing),
      views: applyComment('views', researchLogGeneratedSections.views),
      watchHistory: applyComment('watchHistory', researchLogGeneratedSections.watchHistory),
      researchActions: applyComment('researchActions', researchLogGeneratedSections.researchActions),
      notesAppendix: applyComment('notesAppendix', researchLogGeneratedSections.notesAppendix),
      dashboard: applyComment('dashboard', researchLogGeneratedSections.dashboard),
    };
  }, [researchLogGeneratedSections, state.researchLogSectionComments]);

  const researchLogMarkdown = useMemo(() => buildResearchLogMarkdown({
    projectName: state.fileName || 'Untitled project',
    overview: state.projectOverview,
    diary: state.projectNotes,
    corpusProcessing: researchLogGeneratedSectionsWithComments.corpusProcessing,
    views: researchLogGeneratedSectionsWithComments.views,
    watchHistory: researchLogGeneratedSectionsWithComments.watchHistory,
    researchActions: researchLogGeneratedSectionsWithComments.researchActions,
    notesAppendix: researchLogGeneratedSectionsWithComments.notesAppendix,
    dashboard: researchLogGeneratedSectionsWithComments.dashboard,
    includeNotesAppendix: researchLogMarkdownOptions.includeNotesAppendix,
    includeDashboardSection: researchLogMarkdownOptions.includeDashboardSection,
    dashboardStale: isAnyDashboardSnapshotStale,
  }), [
    isAnyDashboardSnapshotStale,
    researchLogMarkdownOptions.includeDashboardSection,
    researchLogMarkdownOptions.includeNotesAppendix,
    researchLogGeneratedSectionsWithComments,
    state.fileName,
    state.projectNotes,
    state.projectOverview,
  ]);

  if (!isReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center">
          <img
            src="/wave-loader.gif"
            alt="Initializing Playlist Surfer"
            className="mx-auto mb-4 h-11 w-11 object-contain"
            width={44}
            height={44}
          />
          <p className="font-medium text-[var(--text-muted)]">Initializing Playlist Surfer</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-main)]', state.theme === 'pink-pop' && 'pink-ui-mode')}>
      <TopBar
        fileName={hasLoadedData ? currentProjectName : null}
        onFileUpload={handleFileUpload}
        isIngesting={isIngesting}
        savedViews={state.savedViews}
        activeViewId={state.activeViewId}
        onSaveView={saveView}
        onApplyView={applyView}
        onDeleteView={deleteView}
        isRightPanelCollapsed={state.isRightPanelCollapsed}
        onToggleRightPanel={toggleRightPanel}
        onExport={() => setIsExportOpen(true)}
        onToggleColumns={() => setIsColumnsOpen(true)}
        hasLoadedData={hasLoadedData}
        onOpenResearchLog={handleOpenResearchLog}
        onOpenDashboard={() => setIsDashboardOpen(true)}
        isAppFullscreen={isAppFullscreen}
        onToggleAppFullscreen={handleToggleAppFullscreen}
        inclusionView={inclusionView}
        onInclusionViewChange={handleInclusionViewChange}
        includedCount={includedBaseRows.length}
        excludedCount={excludedBaseRows.length}
        viewScope={viewScope}
        onViewScopeChange={handleViewScopeChange}
        hasChannelMetadata={Boolean(channelRows.length > 0)}
        theme={state.theme}
        onToggleTheme={() => setState((previous) => ({ ...previous, theme: previous.theme === 'warm-light' ? 'dark' : 'warm-light' }))}
        saveViewRequestKey={saveViewRequestKey}
        importRequestKey={importRequestKey}
        onRenameProject={handleRenameProject}
        onNavigateBack={() => navigateHistoryByOffset(-1)}
        onNavigateForward={() => navigateHistoryByOffset(1)}
        canNavigateBack={navigationCursor > 0}
        canNavigateForward={navigationCursor >= 0 && navigationCursor < navigationHistory.length - 1}
      />

      <main className="flex flex-1 overflow-hidden">
        <div className={cn('workspace-pane relative flex-1 overflow-hidden', hasLoadedData && !state.isRightPanelCollapsed && 'border-r border-[var(--border-color)]')}>
          <div className="flex h-full min-h-0 flex-col">
            <div className="relative min-h-0 flex-1">
              {hasLoadedData && viewScope === 'channels' && !channelRows.length ? (
                <div className="flex h-full items-center justify-center p-6">
                  <div className="w-full max-w-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 text-center shadow-sm">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Channels view</div>
                    <div className="mt-2 text-lg font-semibold text-[var(--text-main)]">Channel metadata hasn’t been generated yet</div>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">Generate channel-level metadata from the current video list to switch into the channels table.</p>
                    <div className="mt-5 flex justify-center">
                      <button
                        type="button"
                        onClick={handleGenerateChannelMetadata}
                        disabled={isGeneratingChannelMetadata}
                        className="border border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] px-4 py-2 text-sm font-medium text-[var(--text-main)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] disabled:opacity-50"
                      >
                        {isGeneratingChannelMetadata ? 'Generating...' : 'Generate channel metadata'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div key={viewScope} className="h-full w-full">
                  <MetadataGrid
                    rows={activeGridRows}
                    schema={activeGridSchema}
                    selection={getScopeSelection(selectionState, viewScope)}
                    onSelectionChange={handleGridSelectionChange}
                    isLoading={isLoadingRows || isIngesting || isGeneratingChannelMetadata}
                    activeView={viewScope === 'videos' ? state.savedViews.find((view) => view.id === state.activeViewId) : undefined}
                    filterModel={activeGridFilterModel}
                    listLikeColumns={activeGridListLikeColumns}
                    tagValueIndexByColumn={activeGridTagValuesByColumn}
                    booleanMapSchemas={activeGridBooleanMapColumns}
                    onGridReady={handleGridReady}
                    onFilterModelChange={viewScope === 'channels' ? updateChannelFilterModel : updateExternalFilterModel}
                    onSortModelChange={viewScope === 'videos' ? setVideoSortRules : undefined}
                    visibleColumns={activeScopeVisibleColumns}
                    onFileDrop={viewScope === 'videos' ? handleFileUpload : undefined}
                    inclusionView={inclusionView}
                    onMoveSelection={viewScope === 'videos' ? handleMoveSelectedVideos : undefined}
                    onExcludeSelection={viewScope === 'videos' ? handleExcludeSelectedVideos : (viewScope === 'channels' ? handleBatchExcludeChannels : undefined)}
                    onMoveVideos={viewScope === 'videos' ? handleMoveVideos : undefined}
                    viewScope={viewScope}
                    onVideoChannelClick={handleVideoChannelClick}
                    onChannelNavigateToVideos={handleChannelNavigateToVideos}
                    onClearFilters={clearAllExplorerFilters}
                    onShowAllSources={viewScope === 'videos' ? handleShowAllSources : undefined}
                    onToggleInclusionView={viewScope === 'videos'
                      ? (() => handleInclusionViewChange(inclusionView === 'included' ? 'excluded' : 'included'))
                      : undefined}
                    hasHiddenSources={(sourceVisibility.hiddenSourceIds || []).length > 0}
                    columnWidths={viewScope === 'channels' ? channelColumnWidths : videoColumnWidths}
                    onColumnWidthsChange={viewScope === 'channels' ? setChannelColumnWidths : setVideoColumnWidths}
                  />
                </div>
              )}
            </div>
          </div>

          {dbError && (
            <div className="absolute bottom-4 left-4 right-4 z-50 border border-red-300 bg-red-50 p-3 text-sm text-red-700 shadow-lg">
              <strong>Error:</strong> {dbError}
            </div>
          )}
        </div>

        <AnimatePresence initial={false}>
          {hasLoadedData && !state.isRightPanelCollapsed && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: '32%', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="detail-pane-shell h-full min-w-[420px] max-w-[620px] overflow-hidden border-l border-[var(--border-color)] bg-[var(--bg-secondary)]"
            >
              {(() => {
                const isBatchMode = selectedVideoCount > 1;
                if (viewScope !== 'videos') {
                  return (
                    <ChannelSummaryPanel
                      row={selectedChannelDetailRow}
                      defaultRow={filteredChannelRows[0] || null}
                      selectedRows={selectedChannelRows}
                      hasChannelRows={channelRows.length > 0}
                      isGenerating={isGeneratingChannelMetadata}
                      onGenerate={handleGenerateChannelMetadata}
                      channelNotesById={channelNotesById}
                      channelTagsById={channelTagsById}
                      onUpdateChannelNotes={handleUpdateChannelNotes}
                      onReplaceChannelTags={handleReplaceChannelTags}
                      onBatchAddChannelTag={handleBatchAddChannelTag}
                      onBatchRemoveChannelTag={handleBatchRemoveChannelTag}
                      onBatchApplyChannelNotes={handleBatchApplyChannelNotes}
                      inclusionView={inclusionView}
                      onBatchExcludeChannels={handleBatchExcludeChannels}
                      onBatchCopySelection={handleBatchCopyChannelSelection}
                      onChannelNavigateToVideos={handleChannelNavigateToVideos}
                    />
                  );
                }
                return (
                  <DetailPanel
                    row={isBatchMode ? null : detailRow}
                    annotation={isBatchMode ? undefined : (detailVideoId ? ({ ...(state.annotations[detailVideoId] || {}), tags: userTagsByVideoId[detailVideoId] || [] } as Annotation) : undefined)}
                    savedNotes={isBatchMode ? '' : (detailVideoId ? (notesByVideoId[detailVideoId] || '') : '')}
                    selectedCount={selectedVideoCount}
                    batchSelectionKey={batchSelectionKey}
                    onUpdateAnnotation={handleUpdateAnnotation}
                    onUpdateNotes={handleUpdateVideoNotes}
                    onApplyTagFilter={handleApplyTagFilter}
                    onBatchAddTag={handleBatchAddTagToSelection}
                    batchSharedTags={batchSharedTags}
                    onBatchRemoveTag={handleBatchRemoveTagFromSelection}
                    onBatchApplyNotes={handleBatchApplyNotesToSelection}
                    onBatchExclude={handleExcludeSelectedVideos}
                    onBatchCopySelection={handleBatchCopySelection}
                    isBatchTagging={isTagWritePending}
                    onWatchSession={handleWatchSession}
                    openAnnotateRequestKey={openAnnotationsRequestKey}
                  />
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="status-footer flex h-6 flex-shrink-0 items-center justify-between border-t border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 text-[11px] text-[var(--text-muted)]">
        <div>
          {hasLoadedData ? (
            <span>{viewScope === 'channels' ? 'Channels' : 'Videos'}: showing <b className="text-[var(--text-main)]">{displayedRowCount.toLocaleString()}</b> of {totalScopeRowCount.toLocaleString()} rows</span>
          ) : 'No rows loaded'}
          {viewScope === 'videos' && (filteredColumns.length > 0 || state.activeViewId) && ' (Filtering Active)'}
          {viewScope === 'channels' && channelFilteredColumns.length > 0 && ' (Filtering Active)'}
          {viewScope === 'videos' && selectedVideoCount > 0 && (
            <span>
              {' - '}<b className="text-[var(--text-main)]">{selectedVideoCount.toLocaleString()}</b> selected
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          DuckDB-Wasm Engine: Active
        </div>
      </footer>

      <ExportDialog
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        columns={displaySchema}
        onExport={handleExport}
        rowCount={viewScope === 'videos' ? displayedRowCount : rows.length}
        totalRowCount={displayRows.length}
        hasProjectNotes={state.projectNotes.trim().length > 0}
        hasUserTags={hasUserTags}
        currentProjectName={currentProjectName}
        markdownOptions={researchLogMarkdownOptions}
        onMarkdownOptionsChange={setResearchLogMarkdownOptions}
        dashboardSnapshotsStale={isAnyDashboardSnapshotStale}
        onRecalculateSnapshots={recalculateAllDashboardSnapshots}
      />

      <ColumnVisibilitySelector
        isOpen={isColumnsOpen}
        onClose={() => setIsColumnsOpen(false)}
        columns={activeGridSchema.map((column) => column.column_name)}
        schema={activeGridSchema}
        visibleColumns={activeScopeVisibleColumns}
        deletedColumns={viewScope === 'channels' ? [] : deletedColumns}
        onToggle={toggleColumn}
        onSetAll={handleSetAllColumns}
        onDeleteColumn={viewScope === 'channels' ? (() => {}) : handleDeleteColumn}
        onRestoreColumn={handleRestoreColumn}
        onRestoreAll={handleRestoreAllColumns}
        mappedColumns={Object.values(specialMappings).filter(Boolean) as string[]}
        filteredColumns={viewScope === 'channels' ? channelFilteredColumns : filteredColumns}
        currentScope={viewScope}
        activeFilters={activeEditFilters}
        filterColumns={activeFilterColumns}
        filterModel={activeGridFilterModel}
        booleanMapSchemas={activeGridBooleanMapColumns}
        onRemoveFilter={removeCurrentScopeFilter}
        onClearFilters={clearAllExplorerFilters}
        onUpdateFilter={updateCurrentScopeFilter}
        onReorderVisibleColumns={reorderVisibleColumns}
        onResetColumnOrder={resetVisibleColumnOrder}
        onShowAllColumns={showAllColumns}
        onHideOptionalColumns={hideOptionalColumns}
        sourceItems={sourceItemsForVisibility}
        onToggleSourceRows={handleToggleSourceRows}
        onToggleSourceColumns={handleToggleSourceColumns}
        onShowAllSources={handleShowAllSources}
        onHideAllEnrichmentSources={handleHideAllEnrichmentSources}
        onDeleteSource={handleDeleteSource}
        columnSourceByColumn={columnSourceByColumn}
        sourceLabelById={sourceLabelById}
        specialMappings={specialMappings}
        onUpdateSpecialMapping={handleUpdateSpecialMapping}
      />

      <ResearchLogDialog
        isOpen={isResearchLogOpen}
        onClose={() => setIsResearchLogOpen(false)}
        overview={state.projectOverview}
        onUpdateOverview={(value) => setState((previous) => ({ ...previous, projectOverview: value }))}
        diary={state.projectNotes}
        onUpdateDiary={(value) => setState((previous) => ({ ...previous, projectNotes: value }))}
        generatedSections={researchLogGeneratedSectionsWithComments}
        sectionComments={state.researchLogSectionComments}
        onUpdateSectionComment={(sectionId, value) => setState((previous) => ({
          ...previous,
          researchLogSectionComments: { ...previous.researchLogSectionComments, [sectionId]: value },
        }))}
        markdownPreview={researchLogMarkdown}
        markdownOptions={researchLogMarkdownOptions}
        onMarkdownOptionsChange={setResearchLogMarkdownOptions}
        dashboardSnapshotsStale={isAnyDashboardSnapshotStale}
        onRecalculateSnapshots={recalculateAllDashboardSnapshots}
        onOpenDatasetDashboard={() => {
          setIsResearchLogOpen(false);
          setIsDashboardOpen(true);
        }}
        onOpenKeyboardHelp={() => setIsKeyboardHelpOpen(true)}
        onInsertDiaryDate={handleInsertResearchDiaryDate}
        dashboardSnapshotIndex={dashboardSnapshotIndex}
        currentProjectName={currentProjectName}
        onRenameProject={handleRenameProject}
      />

      <CommandPaletteDialog
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onRunCommand={() => setIsCommandPaletteOpen(false)}
        commands={commandPaletteCommands}
      />

      <KeyboardShortcutsDialog
        isOpen={isKeyboardHelpOpen}
        onClose={() => setIsKeyboardHelpOpen(false)}
      />

      <DatasetDashboardDialog
        isOpen={isDashboardOpen}
        onClose={() => setIsDashboardOpen(false)}
        scope={dashboardScope}
        onScopeChange={setDashboardScope}
        onRefresh={handleRefreshDashboard}
        snapshot={currentDashboardSnapshot}
        stale={isDashboardSnapshotStale}
        activeTab={dashboardActiveTab}
        onActiveTabChange={setDashboardActiveTab}
        thumbnailCache={effectiveThumbnailCache}
        thumbnailLoadProgress={thumbnailLoadProgress}
        thumbnailTileSize={thumbnailTileSize}
        canZoomOut={canThumbnailZoomOut}
        canZoomIn={canThumbnailZoomIn}
        onZoomOut={handleThumbnailZoomOut}
        onZoomIn={handleThumbnailZoomIn}
        onLoadFullThumbnails={handleLoadFullDashboardThumbnails}
        onLoadFilteredThumbnails={handleLoadFilteredDashboardThumbnails}
        onThumbnailEntryLoad={handleThumbnailEntryLoad}
        onThumbnailEntryError={handleThumbnailEntryError}
        onRetryFailedThumbnails={handleRetryFailedDashboardThumbnails}
        onNavigateToVideo={handleDashboardNavigateToVideo}
        onNavigateToChannel={handleDashboardNavigateToChannel}
        onApplyContentFilter={handleApplyDashboardContentFilter}
        allChannelIds={allVisibleChannelIdsForDashboard}
        linkingProps={{
          rows: currentLinkingRows,
          state: linkingState,
          sourceItems: linkingSourceItems,
          onGenerate: handleGenerateLinkingSummary,
          onSelectSource: handleSelectLinkingSource,
          onApplyOverride: handleApplyLinkingOverride,
          onSaveOverrideBatch: handleApplyLinkingOverrideBatch,
          onApplyDrilldown: applyDashboardDrilldown,
        }}
      />

      <ImportDialog
        isOpen={isImportOpen}
        onClose={() => {
          setIsImportOpen(false);
          setPendingFile(null);
          setPendingRows([]);
          setPendingSchema([]);
          setImportError(null);
        }}
        fileName={pendingFile?.name || ''}
        columns={pendingSchema}
        incomingRows={pendingRows}
        existingFileName={state.fileName}
        existingRows={sourceRows}
        existingSchema={sourceSchema}
        specialMappings={specialMappings}
        existingVisibleColumns={visibleColumns}
        importError={importError}
        isSubmitting={isImportSubmitting}
        onImport={handleImportConfirm}
      />

      <LongTaskOverlay progress={longTaskProgress} />
    </div>
  );
}
