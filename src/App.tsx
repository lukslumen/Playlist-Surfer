import { useState, useCallback, useEffect, useRef, useMemo, useReducer, useTransition } from 'react';
import { flushSync } from 'react-dom';
import { GridApi } from 'ag-grid-community';
import { useDuckDB } from './hooks/useDuckDB';
import { AppState, ChannelLinkingState, ColumnLineageState, SavedView, Annotation, IncludeExcludeAction, InclusionView, ExportOptions, ImportSubmission, SpecialMappings, DashboardScope, DashboardTemplateTab, DashboardThumbnailArchiveEntry, DashboardThumbnailCacheIndex, DashboardThumbnailCacheSnapshot, DashboardThumbnailSortRule, DatasetDashboardSnapshot, ChannelMetadataSnapshot, ImportedChannelMetadataState, ResearchLogCommentSectionId, ResearchLogMarkdownOptions, SavedViewDashboardSnapshot, ViewScope, WatchHistoryEntry, SourceRegistryState, SourceVisibilityState, RowLineageState, GeneratedMetadataState, LinkingState, LinkingGeneratedRowMetadata, LongTaskProgress, SourceKind } from './types';
import { EMPTY_EXPLORER_SELECTION, buildScopeSelectionFromKeys, clearScopeSelectionAction, getScopeSelection, pruneScopeSelectionAction, selectionReducer, setScopeSelectionAction, type ScopeSelectionUpdate } from './lib/selectionState';
import TopBar from './components/TopBar';
import MetadataGrid from './components/MetadataGrid';
import DetailPanel from './components/DetailPanel';
import ChannelSummaryPanel from './components/ChannelSummaryPanel';
import { applyFriendlyColumnMappings, buildBatchCopyClipboardPayload, buildChannelMetadataRows, buildImportedChannelMetadataState, buildDisplayRows, buildDisplaySchema, buildResearchLogMarkdown, collectVideoIds, convertRowsToCsv, createProjectManifest, deleteColumnFromProject, deriveSchemaFromRows, partitionRowsByInclusion, detectSpecialMappings, downloadBlob, cleanupAutoSeededResearchDiary, NOTES_COLUMN, formatDateDisplay, resolveTagFilterColumn, resolveChannelId, resolveChannelName, detectIncomingChannelIdColumn, resolveTranscript, resolveVideoTitle, resolveVideoId, sanitizeFileName, stripDeletedColumnsFromRows, stripDeletedColumnsFromSchema, buildGeneratedMetadataSchema, overlayGeneratedMetadataRows, TRANSCRIPT_COLUMN, USER_TAGS_COLUMN, VIDEO_DESCRIPTION_COLUMN, type BatchCopyExportMode } from './lib/data';
import { createStoredZip, readStoredZip } from './lib/archive';
import { buildTagValuesForColumn, buildUnifiedFilterState, detectBooleanMapColumns, detectListLikeColumns, ExplorerFilterModel } from './lib/filterCoordinator';
import { extractUserTagsFromAnnotations, mergeAnnotationsWithUserTags, stripTagsFromAnnotations, userTagsReducer } from './lib/userTags';
import { buildDatasetDashboardStats } from './lib/datasetDashboard';
import { buildDashboardTemplateSnapshot, inferIntentFromText } from './lib/dashboardTemplate';
import { aggregateChannelLinkingFromVideoRows } from './lib/linkingDashboard';
import { loadLastProjectAutosaveSnapshot, shouldAttemptLastProjectRestore } from './lib/projectAutosave';
import { THUMBNAIL_LIMIT, buildSavedViewThumbnailScopeKey, buildThumbnailSortSignature, inferFileExtensionFromMimeType, isPersistentThumbnailScopeKey, isSavedViewThumbnailScopeKey, resolveThumbnailCacheLabel, sanitizeThumbnailPathSegment, selectThumbnailCandidates } from './lib/dashboardThumbnails';
import { cn } from './lib/utils';
import { getBootPersistedStateJson } from './lib/persistedState';
import { normalizeVideoIds, pruneInclusionState } from './lib/inclusion';
import { applySupportMappings, buildDefaultProjectSourceState, createEmptyChannelLinkingState, createEmptyColumnLineage, createEmptyGeneratedMetadata, createEmptyLinkingState, createEmptyRowLineage, createEmptySourceRegistry, createEmptySourceVisibility, ensureGeneratedColumnLineage, flattenGeneratedMetadataForOverlay, joinUnique, LINKING_FILTER_COLUMNS, reconcileSourceVisibility, resolveChannelRowKey, resolveRecoverableInclusionView, resolveRowLineageKey, withSourceRegistryCounts } from './lib/projectSourceState';
import { CHANNEL_USER_TAGS_COLUMN, findDashboardCategoryColumn, findDashboardDurationColumn, findDashboardIntentColumn, findDashboardTopicColumn, findVideoChannelColumn, getDefaultChannelVisibleColumns, getDefaultVideoVisibleColumns } from './lib/columnDefaults';
import { buildChannelMetadataCacheKey, buildDatasetFingerprint, buildExcludedMembershipFingerprint, buildSourceVisibilityFingerprint, buildVideoCorpusFingerprint } from './lib/fingerprints';
import { buildThumbnailEntriesFromCacheSeed, FILTERED_TEMP_THUMBNAIL_SCOPE, normalizeRestoredThumbnailCaches, restoreThumbnailCachesFromArchive } from './lib/thumbnailCache';
import { appendNotesBlock, buildLegacyNotesFromAnnotations, buildNoteArchiveFiles, buildTagUsageSummary, extractAnnotationsFromRows, stripNotesFromAnnotations } from './lib/projectNotes';
import { copyTextToClipboard, readFileBufferWithProgress, waitForNextPaint } from './lib/browser';
import { describeFilterModelEntry, formatDurationLabel, parseDateLabel, resolveEditViewFilterKind, summarizeDashboardSnapshot, summarizeFilterModel } from './lib/researchHistory';
import type { AppNavigationEntry } from './lib/navigation';
import type { HydrateProjectArgs } from './lib/projectHydration';
import { LongTaskOverlay } from './components/LongTaskOverlay';
import { StatusFooter } from './components/layout/StatusFooter';
import { ChannelMetadataEmptyState } from './components/layout/ChannelMetadataEmptyState';
import { RightPanelShell } from './components/layout/RightPanelShell';
import { useShortcuts } from './hooks/useShortcuts';
import { useDialogs } from './state/useDialogs';
import { useImportFlow } from './state/useImportFlow';
import { addEnrichmentSource, importProgressTitle, planMergeImport, planReplaceImport } from './lib/importPlan';
import { useResearchHistory } from './state/useResearchHistory';
import { useInclusionActions, useInclusionState, type InclusionActionResult } from './state/useInclusion';
import { useToast } from './components/toast/ToastProvider';
import { autosaveRestoreFailedToast, describeInclusionResult, readFailedToast, restoreFailedToast, saveFailedToast } from './lib/feedbackMessages';
import { usePersistence } from './state/usePersistence';
import { useNavigationHistory } from './state/useNavigationHistory';
import { useThumbnailCaches } from './state/useThumbnailCaches';
import { useChannelAnnotations } from './state/useChannelAnnotations';
import { useChannelRows } from './state/useChannelRows';
import { useLinkingActions } from './state/useLinkingActions';
import { planAutosaveRestore, planBackupRestore, unpackProjectBackup, type SavedAppState } from './lib/projectRestore';
import { buildChannelMetadataSnapshot, isChannelMetadataSnapshotFresh } from './lib/channelMetadata';
import { ExportDialog } from './components/dialogs/ExportDialog';
import { ColumnVisibilitySelector } from './components/dialogs/ColumnVisibilitySelector';
import { ResearchLogDialog } from './components/dialogs/ResearchLogDialog';
import { ImportDialog } from './components/dialogs/ImportDialog';
import { DatasetDashboardDialog } from './components/dialogs/DatasetDashboardDialog';
import { KeyboardShortcutsDialog } from './components/dialogs/KeyboardShortcutsDialog';
import { CommandPaletteDialog } from './components/dialogs/CommandPaletteDialog';

// Shared empty values: a fresh [] or {} on every render would defeat the memos that depend on them.
const NO_SELECTED_KEYS: string[] = [];

export default function App() {
  const { isReady, isIngesting, error: dbError, readCSVBuffer } = useDuckDB();
  const { showToast } = useToast();
  const persisted = useMemo(() => {
    const saved = getBootPersistedStateJson();
    let initial: any = {};
    try {
      initial = saved ? JSON.parse(saved) : {};
    } catch (error) {
      console.warn('[state] Saved state is not valid JSON; starting fresh.', error);
    }
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
  const {
    channelNotesById,
    setChannelNotesById,
    channelTagsById,
    setChannelTagsById,
    handleUpdateChannelNotes,
    handleReplaceChannelTags,
    addTagToChannelKeys,
    removeTagFromChannelKeys,
    appendNotesToChannelKeys,
  } = useChannelAnnotations({ notes: persisted.channelNotesById, tags: persisted.channelTagsById });
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
  const [isAppFullscreen, setIsAppFullscreen] = useState(false);
  const [dashboardScope, setDashboardScope] = useState<DashboardScope>('full');
  const [dashboardActiveTab, setDashboardActiveTab] = useState<DashboardTemplateTab>('overview');
  const [dashboardSnapshots, setDashboardSnapshots] = useState<Partial<Record<DashboardScope, DatasetDashboardSnapshot>>>(() => {
    return persisted.dashboardSnapshots ?? {};
  });
  const [savedViewDashboardSnapshots, setSavedViewDashboardSnapshots] = useState<Record<string, SavedViewDashboardSnapshot>>(() => {
    return persisted.savedViewDashboardSnapshots ?? {};
  });
  const [videoSortRules, setVideoSortRules] = useState<DashboardThumbnailSortRule[]>([]);
  const {
    thumbnailCaches,
    thumbnailCachesRef,
    thumbnailLoadProgress,
    nextThumbnailSessionId,
    peekThumbnailSessionId,
    clearAllThumbnailCaches,
    replaceThumbnailCaches,
    writeThumbnailScopes,
    removeThumbnailScopes,
    handleThumbnailEntryLoad,
    handleThumbnailEntryError,
    retryFailedThumbnails,
    thumbnailTileSize,
    canThumbnailZoomOut,
    canThumbnailZoomIn,
    handleThumbnailZoomOut,
    handleThumbnailZoomIn,
  } = useThumbnailCaches();
  const inclusion = useInclusionState(persisted);
  const {
    inclusionView,
    setInclusionView,
    inclusionStateRef,
    setInclusionState,
    excludedVideoIds,
    excludedVideoMetaById,
    resetInclusionHistory,
  } = inclusion;
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
  const [openAnnotationsRequestKey, setOpenAnnotationsRequestKey] = useState(0);
  const [pendingViewerTarget, setPendingViewerTarget] = useState<
    | { kind: 'video'; videoId: string }
    | { kind: 'channel'; channelId?: string | null; channelName?: string }
    | null
  >(null);
  const [saveViewRequestKey, setSaveViewRequestKey] = useState(0);
  const [importRequestKey, setImportRequestKey] = useState(0);
  const {
    researchHistory,
    setResearchHistory,
    appendResearchHistory,
    markResearchHistoryEventReverted,
  } = useResearchHistory(persisted.researchHistory ?? []);
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
  const drilldownPreviousVideoFilterRef = useRef<ExplorerFilterModel | null>(null);
  const selectionScrollModeRef = useRef<'none' | 'middle'>('none');
  const sourceRowsRef = useRef<any[]>([]);
  const sourceSchemaRef = useRef<any[]>([]);
  const isAutoRestoreInFlightRef = useRef(false);
  const [isChannelDrilldownFilterActive, setIsChannelDrilldownFilterActive] = useState(false);
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

  const handleCsvReadError = useCallback((fileName: string, error: unknown) => {
    showToast(readFailedToast(fileName, error));
  }, [showToast]);
  const {
    isImportOpen,
    pendingFile,
    pendingSchema,
    pendingRows,
    importError,
    setImportError,
    isImportSubmitting,
    closeImport,
    openCsvForImport,
    runImport,
  } = useImportFlow({
    readCSVBuffer,
    updateLongTaskProgress,
    setIsLoadingRows,
    onReadError: handleCsvReadError,
  });
  const {
    isCommandPaletteOpen, setIsCommandPaletteOpen,
    isKeyboardHelpOpen, setIsKeyboardHelpOpen,
    isDashboardOpen, setIsDashboardOpen,
    isExportOpen, setIsExportOpen,
    isColumnsOpen, setIsColumnsOpen,
    isResearchLogOpen, setIsResearchLogOpen,
    hasBlockingOverlay,
    closeTopOverlay,
  } = useDialogs({ isImportOpen, closeImport });

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
  // Overlay generated metadata and user tags once for the whole dataset and only then split by
  // inclusion: an include/exclude then just filters arrays, every other row keeps its object, and
  // AG Grid can skip re-processing rows it already has.
  const sourceRowsWithGenerated = useMemo(
    () => overlayGeneratedMetadataRows(sourceMaskedRows, generatedOverlayByVideoId),
    [generatedOverlayByVideoId, sourceMaskedRows],
  );
  const sourceDisplayRows = useMemo(
    () => buildDisplayRows(sourceRowsWithGenerated, userTagsByVideoId),
    [sourceRowsWithGenerated, userTagsByVideoId],
  );
  const generatedInclusionPartition = useMemo(
    () => partitionRowsByInclusion(sourceRowsWithGenerated, excludedVideoIdSet),
    [excludedVideoIdSet, sourceRowsWithGenerated],
  );
  const displayInclusionPartition = useMemo(
    () => partitionRowsByInclusion(sourceDisplayRows, excludedVideoIdSet),
    [excludedVideoIdSet, sourceDisplayRows],
  );
  const includedBaseRowsWithGenerated = generatedInclusionPartition.included;
  const includedDisplayRows = displayInclusionPartition.included;
  const displaySchema = useMemo(() => buildDisplaySchema(workingSchemaWithGenerated, userTagsByVideoId), [workingSchemaWithGenerated, userTagsByVideoId]);
  const displayRows = inclusionView === 'excluded' ? displayInclusionPartition.excluded : displayInclusionPartition.included;
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
  const isChannelMetadataFresh = useMemo(() => isChannelMetadataSnapshotFresh(channelMetadataSnapshot, {
    cacheKey: currentChannelMetadataCacheKey,
    datasetVersion,
    inclusionView,
  }), [channelMetadataSnapshot, currentChannelMetadataCacheKey, datasetVersion, inclusionView]);
  const {
    channelRows,
    hasChannelUserTags,
    channelRowsWithLinking,
    channelSchema,
    channelBooleanMapColumns,
    channelListLikeColumns,
    filteredChannelRows,
    channelFilteredColumns,
  } = useChannelRows({
    snapshot: channelMetadataSnapshot,
    importedChannelMetadata,
    videoRows: activeBaseRows,
    channelTagsById,
    channelLinkingState,
    channelFilterModel,
  });
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
  const displayedRowCount = viewScope === 'channels' ? filteredChannelRows.length : rows.length;
  const totalScopeRowCount = viewScope === 'channels' ? channelRowsWithLinking.length : displayRows.length;
  const activeGridRows = viewScope === 'channels' ? filteredChannelRows : rows;
  const activeGridSchema = viewScope === 'channels' ? channelSchema : displaySchema;
  const activeGridListLikeColumns = viewScope === 'channels' ? channelListLikeColumns : listLikeColumns;
  const activeGridBooleanMapColumns = viewScope === 'channels' ? channelBooleanMapColumns : booleanMapColumns;
  // Tag filter options are built when a tag filter opens, from whatever the grid shows at that moment.
  const tagValueSourceRef = useRef<Omit<Parameters<typeof buildTagValuesForColumn>[0], 'column'> | null>(null);
  tagValueSourceRef.current = viewScope === 'channels'
    ? {
        rows: channelRowsWithLinking,
        schema: channelSchema,
        filterModel: channelFilterModel,
        listLikeColumns: channelListLikeColumns,
        booleanMapColumns: channelBooleanMapColumns,
      }
    : {
        rows: channelScopedDisplayRows,
        schema: displaySchema,
        filterModel,
        listLikeColumns,
        booleanMapColumns,
      };
  const getActiveGridTagValues = useCallback((column: string) => {
    const source = tagValueSourceRef.current;
    return source ? buildTagValuesForColumn({ ...source, column }) : [];
  }, []);
  const activeGridFilterModel = viewScope === 'channels' ? channelFilterModel : filterModel;
  const selectedVideoIdsForActions = viewScope === 'videos' ? videoSelection.selectedKeys : NO_SELECTED_KEYS;
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
    sourceRowsRef.current = sourceRows;
  }, [sourceRows]);

  useEffect(() => {
    sourceSchemaRef.current = sourceSchema;
  }, [sourceSchema]);

  // Everything that survives a reload. usePersistence saves it whenever a field changes.
  const persistedAppState = {
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
  const { getLatestPersistedState } = usePersistence({
    state: persistedAppState,
    rows: sourceRows,
    schema: sourceSchema,
    fileName: state.fileName ?? null,
    onSaveError: (what, error) => showToast(saveFailedToast(what, error)),
  });

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
  }, [clearScopeSelection, setInclusionView]);

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

  // Navigation history is set up further down (it depends on later values); hydrate reaches it via a ref.
  const resetNavigationHistoryRef = useRef<() => void>(() => {});
  const hydrateProject = useCallback((args: HydrateProjectArgs) => {
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
    const restoredThumbnails = normalizeRestoredThumbnailCaches(args.thumbnailCaches ?? {}, {
      sessionStart: peekThumbnailSessionId(),
      datasetVersion: nextDatasetVersion,
      filteredViewVersion: nextFilteredVersion,
      savedViewsVersion: args.savedViewsVersion,
    });
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
    setInclusionState({
      excludedVideoIds: nextExcludedVideoIds,
      excludedVideoMetaById: args.excludedVideoMetaById ?? {},
    });
    setInclusionView(nextInclusionView);
    clearScopeSelection('videos', false);
    clearScopeSelection('channels', false);
    resetInclusionHistory();
    setFilterModel({});
    setChannelFilterModel(args.channelFilterModel ?? {});
    clearChannelDrilldownState({ restoreVideoFilters: false });
    setVideoScopeChannelKeys(null);
    resetNavigationHistoryRef.current();
    setDashboardActiveTab('overview');
    setDashboardSnapshots(nextDashboardSnapshots);
    setSavedViewDashboardSnapshots(nextSavedViewSnapshots);
    // New thumbnail sessions start above any session id restored from the project.
    replaceThumbnailCaches(restoredThumbnails.caches, restoredThumbnails.maxSessionId);
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
  }, [channelVisibleColumns, clearChannelDrilldownState, clearScopeSelection, datasetVersion, filteredViewVersion, peekThumbnailSessionId, replaceThumbnailCaches, resetInclusionHistory, setChannelNotesById, setChannelTagsById, setInclusionState, setInclusionView, setResearchHistory]);

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

      const plan = planAutosaveRestore(autosavedSnapshot, (getLatestPersistedState() ?? persisted) as SavedAppState);
      if (plan.recoveredInclusion !== plan.preferredInclusion) {
        console.warn(
          `[autosave] Restore (${trigger}) switched inclusion view to "${plan.recoveredInclusion}" because ` +
          `${plan.preferredInclusion} had no visible rows.`,
        );
      }
      hydrateProject(plan.project);
      console.warn(`[autosave] Restore completed (${trigger}) from snapshot saved at ${autosavedSnapshot.savedAt}.`);
    } catch (error) {
      console.warn(`[autosave] Restore failed (${trigger}).`, error);
      showToast(autosaveRestoreFailedToast(error));
    } finally {
      isAutoRestoreInFlightRef.current = false;
    }
  }, [getLatestPersistedState, hydrateProject, persisted, showToast]);

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
      const { manifest, dataBytes, noteFiles } = unpackProjectBackup(archiveFiles);
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
      hydrateProject(planBackupRestore({ manifest, noteFiles, parsed, restoredThumbnailCaches }));
    } catch (error) {
      console.error('Failed to restore backup:', error);
      showToast(restoreFailedToast(file.name, error));
    } finally {
      updateLongTaskProgress(null);
      setIsLoadingRows(false);
    }
  }, [hydrateProject, readCSVBuffer, showToast, updateLongTaskProgress]);

  const handleFileUpload = useCallback(async (file: File) => {
    if (file.name.toLowerCase().endsWith('.zip')) {
      await restoreProjectBackup(file);
      return;
    }
    await openCsvForImport(file);
  }, [openCsvForImport, restoreProjectBackup]);

  const handleImportConfirm = useCallback(async ({ options, incomingRows }: ImportSubmission) => {
    if (!pendingFile) return;
    const fileName = pendingFile.name;
    await runImport(importProgressTitle(options, sourceRows.length > 0), async (progress) => {
      if (options.importKind === 'channelMetadata') {
        if (!sourceRows.length) {
          throw new Error('Import a video dataset before merging channel metadata.');
        }
        const relationshipType = options.channelMetadataRelationship || 'channelId';
        await progress('Matching imported channel rows to existing channels', 2, { indeterminate: true });
        const mergeResult = buildImportedChannelMetadataState({
          existingVideoRows: sourceRows,
          incomingRows,
          incomingSchema: pendingSchema,
          relationshipType,
          sourceFileName: fileName,
          previousState: importedChannelMetadata,
        });
        const nextImportedState = mergeResult.state;
        await progress('Rebuilding the channel table', 3, { indeterminate: true });
        setImportedChannelMetadata(nextImportedState);
        setChannelMetadataSnapshot(buildChannelMetadataSnapshot(buildChannelMetadataRows(activeBaseRows, nextImportedState), {
          datasetVersion,
          inclusionView,
          videoCorpusFingerprint,
          exclusionMembershipFingerprint,
          cacheKey: currentChannelMetadataCacheKey,
        }));
        setChannelFilterModel({});
        setSourceRegistry((current) => addEnrichmentSource(current, {
          fileName,
          rowCount: incomingRows.length,
          columns: pendingSchema.map((column) => column.column_name),
          now: new Date().toISOString(),
        }));
        setChannelLinkingState((current) => ({
          ...current,
          stale: true,
          staleReason: 'Channel metadata merge changed channel table. Refresh channel metadata to rebuild linking aggregates.',
        }));
        appendResearchHistory({
          type: 'import_merge_completed',
          summary: `Merged channel metadata from ${fileName}: ${mergeResult.updatedCount.toLocaleString()} matched / updated, ${mergeResult.skippedCount.toLocaleString()} skipped.`,
          details: `Relationship: ${relationshipType === 'channelId' ? 'channelId → channelId' : 'normalized channel title'}; matched on ${mergeResult.relationshipColumn || 'n/a'}.`,
        });
        return;
      }

      const plan = options.mode === 'replace' || sourceRows.length === 0
        ? await planReplaceImport({
            incomingRows,
            incomingSchema: pendingSchema,
            fileName,
            options,
            specialMappings: { ...detectSpecialMappings(pendingSchema), ...(options.specialMappings || {}) },
            carryOver: {
              projectOverview: state.projectOverview,
              projectNotes: state.projectNotes,
              researchLogSectionComments: state.researchLogSectionComments,
            },
            isFirstDataset: sourceRows.length === 0,
            progress,
          })
        : await planMergeImport({
            current: {
              rows: sourceRows,
              schema: sourceSchema,
              fileName: state.fileName,
              videoColumnWidths,
              channelColumnWidths,
              annotations: mergeAnnotationsWithUserTags(state.annotations, userTagsByVideoId),
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
              specialMappings,
              deletedColumns,
              excludedVideoIds,
              excludedVideoMetaById,
              inclusionView,
              savedViewDashboardSnapshots,
              savedViewsVersion,
              importedChannelMetadata,
              viewScope,
              sourceRegistry,
              sourceVisibility,
              rowLineage,
              columnLineage,
              generatedMetadata,
              linkingState,
              channelLinkingState,
            },
            incomingRows,
            incomingSchema: pendingSchema,
            incomingFileName: fileName,
            options,
            progress,
          });
      hydrateProject(plan.project);
      plan.history.forEach((entry) => appendResearchHistory(entry));
    });
  }, [
    activeBaseRows,
    appendResearchHistory,
    channelColumnWidths,
    channelLinkingState,
    channelNotesById,
    channelTagsById,
    columnLineage,
    currentChannelMetadataCacheKey,
    datasetVersion,
    deletedColumns,
    excludedVideoIds,
    excludedVideoMetaById,
    exclusionMembershipFingerprint,
    generatedMetadata,
    hydrateProject,
    importedChannelMetadata,
    inclusionView,
    linkingState,
    notesByVideoId,
    pendingFile,
    pendingSchema,
    researchHistory,
    rowLineage,
    runImport,
    savedViewDashboardSnapshots,
    savedViewsVersion,
    sourceRegistry,
    sourceRows,
    sourceSchema,
    sourceVisibility,
    specialMappings,
    state.activeViewId,
    state.annotations,
    state.fileName,
    state.projectNotes,
    state.projectOverview,
    state.researchLogSectionComments,
    state.savedViews,
    userTagsByVideoId,
    videoColumnWidths,
    videoCorpusFingerprint,
    viewScope,
    watchHistoryByVideoId,
  ]);

  const handleUnkeyedRowInteraction = useCallback(() => {
    showToast({
      kind: 'warning',
      key: 'unkeyed-row',
      message: "This row has no video ID, so it can't be selected or excluded",
      detail: 'Rows need a videoId, video_id, id or Video_ID column value. Check the column mapping in the import dialog.',
    });
  }, [showToast]);
  const handleInclusionResult = useCallback((result: InclusionActionResult) => {
    const toast = describeInclusionResult(result);
    if (toast) showToast(toast);
  }, [showToast]);
  const handleBeforeInclusionChange = useCallback(() => {
    clearAllThumbnailCaches();
    clearScopeSelection('videos', true);
    clearScopeSelection('channels', true);
  }, [clearAllThumbnailCaches, clearScopeSelection]);
  const handleInclusionChanged = useCallback(() => {
    setDatasetVersion((version) => version + 1);
    setFilteredViewVersion((version) => version + 1);
  }, []);
  const {
    applyIncludeExcludeAction,
    handleMoveVideos,
    handleMoveSelectedVideos,
    handleUndoIncludeExclude,
    handleRedoIncludeExclude,
    canUndo: canUndoIncludeExclude,
    canRedo: canRedoIncludeExclude,
  } = useInclusionActions({
    inclusion,
    viewScope,
    sourceVideoIdSet,
    sourceRowByVideoId: sourceMaskedRowByVideoId,
    selectedVideoIds: selectedVideoIdsForActions,
    visibleVideoIds,
    areAllVisibleVideosSelected: areAllFilteredVideosSelectedForAction,
    selectedVideoRows: selectedRowsForBatchCopy,
    filterModel,
    startTransition: startFilterTransition,
    onBeforeChange: handleBeforeInclusionChange,
    onChanged: handleInclusionChanged,
    appendResearchHistory,
    markResearchHistoryEventReverted,
    onResult: handleInclusionResult,
  });

  // The batch button and Ctrl/Cmd+Delete used to always exclude, which did nothing in the Excluded view.
  const handleExcludeSelectedVideos = handleMoveSelectedVideos;

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
  }, [setIsDashboardOpen]);

  const handleOpenResearchLog = useCallback(() => {
    setIsResearchLogOpen(true);
  }, [setIsResearchLogOpen]);

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

  const hasVideoSelection = viewScope === 'videos' && selectedVideoIdsForActions.length > 0;
  useShortcuts({
    closeOverlay: closeTopOverlay,
    historyBack: () => navigateHistoryByOffset(-1),
    historyForward: () => navigateHistoryByOffset(1),
    selectNext: () => moveActiveSelectionByDirection(1),
    selectPrevious: () => moveActiveSelectionByDirection(-1),
    openThumbnailsDashboard: () => handleOpenDatasetDashboardTab('thumbnails'),
    openAttentionDashboard: () => handleOpenDatasetDashboardTab('attention'),
    openContentDashboard: () => handleOpenDatasetDashboardTab('content'),
    openOverviewDashboard: () => handleOpenDatasetDashboardTab('overview'),
    openColumns: () => setIsColumnsOpen(true),
    openExport: () => setIsExportOpen(true),
    openImport: () => handleRequestImport(),
    openKeyboardHelp: () => setIsKeyboardHelpOpen(true),
    openCommandPalette: () => setIsCommandPaletteOpen(true),
    saveView: () => handleOpenSaveView(),
    undo: () => {
      if (!canUndoIncludeExclude || viewScope !== 'videos') return false;
      handleUndoIncludeExclude();
    },
    redo: () => {
      if (!canRedoIncludeExclude || viewScope !== 'videos') return false;
      handleRedoIncludeExclude();
    },
    excludeSelection: () => {
      if (!hasVideoSelection) return false;
      handleExcludeSelectedVideos();
    },
    moveSelection: () => {
      if (!hasVideoSelection) return false;
      handleMoveSelectedVideos();
    },
  }, { hasBlockingOverlay });

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

  const handleBatchAddChannelTag = useCallback((tag: string) => addTagToChannelKeys(selectedChannelKeys, tag), [addTagToChannelKeys, selectedChannelKeys]);
  const handleBatchRemoveChannelTag = useCallback((tag: string) => removeTagFromChannelKeys(selectedChannelKeys, tag), [removeTagFromChannelKeys, selectedChannelKeys]);
  const handleBatchApplyChannelNotes = useCallback((notes: string) => appendNotesToChannelKeys(selectedChannelKeys, notes), [appendNotesToChannelKeys, selectedChannelKeys]);

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
      setChannelMetadataSnapshot(buildChannelMetadataSnapshot(nextRows, {
        datasetVersion,
        inclusionView,
        videoCorpusFingerprint,
        exclusionMembershipFingerprint,
        cacheKey: currentChannelMetadataCacheKey,
      }));

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
  }, [isGeneratingChannelMetadata, channelMetadataSnapshot?.rows?.length, updateLongTaskProgress, activeBaseRows, importedChannelMetadata, datasetVersion, inclusionView, videoCorpusFingerprint, exclusionMembershipFingerprint, currentChannelMetadataCacheKey, effectiveGeneratedMetadataByVideoId, clearScopeSelection, includedBaseRows, sourceVisibility, appendResearchHistory]);

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
  }, [clearChannelDrilldownState, clearChannelScopedVideoUniverse, clearScopeSelection, excludedBaseRows.length, includedBaseRows.length, setInclusionView, updateExternalFilterModel, viewScope]);

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
      setInclusionState(pruneInclusionState(inclusionStateRef.current, survivingVideoIds));
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
  }, [sourceRegistry.byId, sourceRegistry.primarySourceId, sourceRegistry.orderedIds, rowLineage.byRowId, updateLongTaskProgress, sourceRows, columnLineage.byColumn, sourceSchema, deletedColumns, visibleColumns, channelVisibleColumns, state.savedViews, sourceVisibility.hiddenSourceIds, sourceVisibility.hiddenColumnSourceIdsByScope?.videos, sourceVisibility.hiddenColumnSourceIdsByScope?.channels, clearScopeSelection, userTagsByVideoId, setInclusionState, inclusionStateRef, markDerivedSnapshotsStale, clearAllThumbnailCaches, appendResearchHistory]);

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
  }, [clearScopeSelection, setInclusionView]);

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
  }, [clearChannelDrilldownState, clearChannelScopedVideoUniverse, displaySchema, filterModel, setIsDashboardOpen, updateExternalFilterModel, viewScope]);

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
  }, [resetVisibleColumnOrder, viewScope, hasLoadedData, showAllColumns, hideOptionalColumns, handleRequestImport, handleOpenSaveView, handleOpenResearchLog, channelRows.length, channelMetadataSnapshot?.rows?.length, isChannelMetadataFresh, handleGenerateChannelMetadata, isGeneratingChannelMetadata, handleOpenAnnotations, clearAllExplorerFilters, inclusionView, state.isRightPanelCollapsed, state.theme, toggleRightPanel, handleOpenDatasetDashboardTab, setIsColumnsOpen, setIsExportOpen, setIsKeyboardHelpOpen, handleViewScopeChange, handleInclusionViewChange]);
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
  }, [clearAllExplorerFilters, requestSelectionScroll, rows, setIsDashboardOpen]);

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
  }, [channelRowsWithLinking, clearAllExplorerFilters, clearChannelDrilldownState, clearChannelScopedVideoUniverse, requestSelectionScroll, rows, setIsDashboardOpen]);

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

  const {
    navigateHistoryByOffset,
    resetNavigationHistory,
    canNavigateBack,
    canNavigateForward,
  } = useNavigationHistory({
    enabled: hasLoadedData,
    currentEntry: currentNavigationEntry,
    restoreEntry: restoreNavigationEntry,
  });
  resetNavigationHistoryRef.current = resetNavigationHistory;

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
    removeThumbnailScopes((scopeKey) => scopeKey === buildSavedViewThumbnailScopeKey(id));
    appendResearchHistory({
      type: 'saved_view_deleted',
      summary: `Saved view "${deletedView?.name || id}" deleted.`,
      meta: { viewId: id, viewName: deletedView?.name || '' },
    });
    if (state.activeViewId === id) {
      updateExternalFilterModel({});
    }
  }, [appendResearchHistory, removeThumbnailScopes, state.activeViewId, state.savedViews, updateExternalFilterModel]);

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
    removeThumbnailScopes((scopeKey) => isSavedViewThumbnailScopeKey(scopeKey) && !validSavedViewKeys.has(scopeKey));
  }, [removeThumbnailScopes, state.savedViews]);

  useEffect(() => {
    removeThumbnailScopes((scopeKey) => scopeKey === FILTERED_TEMP_THUMBNAIL_SCOPE);
  }, [filteredViewVersion, removeThumbnailScopes]);

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
      sessionIdByScope.set(target.scopeKey, nextThumbnailSessionId());
    });

    const seedSnapshot = mode === 'filtered'
      ? thumbnailCachesRef.current.full
      : undefined;
    const primaryEntries = buildThumbnailEntriesFromCacheSeed({
      candidates,
      seedSnapshot,
    });
    writeThumbnailScopes(targetScopes.map((target): DashboardThumbnailCacheSnapshot => ({
      scopeKey: target.scopeKey as DashboardThumbnailCacheSnapshot['scopeKey'],
      label: target.label,
      sessionId: sessionIdByScope.get(target.scopeKey) ?? 0,
      rowCount: sourceRowCount,
      totalCandidates: primaryEntries.length,
      calculatedAt: new Date().toISOString(),
      datasetVersionAtCalculation: datasetVersion,
      filteredViewVersionAtCalculation: mode === 'filtered' ? filteredViewVersion : undefined,
      savedViewsVersionAtCalculation: target.savedViewsVersionAtCalculation,
      sortSignature,
      entries: target.scopeKey === primaryScopeKey
        ? primaryEntries
        : buildThumbnailEntriesFromCacheSeed({ candidates, seedSnapshot }),
    })), { showProgressFor: primaryScopeKey as DashboardThumbnailCacheSnapshot['scopeKey'] });
  }, [
    activeSavedView,
    datasetVersion,
    filteredViewVersion,
    includedBaseRows,
    nextThumbnailSessionId,
    rows,
    savedViewsVersion,
    thumbnailCachesRef,
    videoSortRules,
    writeThumbnailScopes,
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
    const sessionId = nextThumbnailSessionId();
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

    writeThumbnailScopes([nextSnapshot], { showProgressFor: nextSnapshot.scopeKey, onlyIfMissing: true });
  }, [
    activeSavedViewThumbnailScopeKey,
    dashboardScope,
    datasetVersion,
    filteredViewVersion,
    isActiveSavedViewFilterAligned,
    nextThumbnailSessionId,
    rows,
    thumbnailCaches,
    videoSortRules,
    writeThumbnailScopes,
  ]);

  const handleRetryFailedDashboardThumbnails = useCallback(() => {
    retryFailedThumbnails(effectiveThumbnailScopeKey);
  }, [effectiveThumbnailScopeKey, retryFailedThumbnails]);

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
  const channelLinkingDatasetFingerprint = useMemo(() => buildDatasetFingerprint({
    datasetVersion,
    inclusionView,
    rowCount: includedBaseRows.length,
    sourceVisibility,
  }), [datasetVersion, includedBaseRows.length, inclusionView, sourceVisibility]);
  const visibleLinkingSourceLabels = useMemo(
    () => linkingSourceItems.filter((item) => item.visible).map((item) => item.label),
    [linkingSourceItems],
  );
  const {
    handleSelectLinkingSource,
    handleGenerateLinkingSummary,
    handleApplyLinkingOverride,
    handleApplyLinkingOverrideBatch,
  } = useLinkingActions({
    linkingState,
    setLinkingState,
    setChannelLinkingState,
    setGeneratedMetadata,
    setColumnLineage,
    linkingRows: currentLinkingRows,
    linkingVideoIds: currentLinkingVideoIds,
    linkingDatasetFingerprint: currentLinkingDatasetFingerprint,
    sourceVisibilityFingerprint: currentSourceVisibilityFingerprint,
    channelVideoRows: includedBaseRows,
    channelDatasetFingerprint: channelLinkingDatasetFingerprint,
    hasChannelMetadata: Boolean(channelMetadataSnapshot?.rows?.length),
    contentIntentByVideoId: computedContentIntentByVideoId,
    visibleSourceLabels: visibleLinkingSourceLabels,
    appendResearchHistory,
    updateLongTaskProgress,
  });
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

  const isBatchMode = selectedVideoCount > 1;
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
        canNavigateBack={canNavigateBack}
        canNavigateForward={canNavigateForward}
      />

      <main className="flex flex-1 overflow-hidden">
        <div className={cn('workspace-pane relative flex-1 overflow-hidden', hasLoadedData && !state.isRightPanelCollapsed && 'border-r border-[var(--border-color)]')}>
          <div className="flex h-full min-h-0 flex-col">
            <div className="relative min-h-0 flex-1">
              {hasLoadedData && viewScope === 'channels' && !channelRows.length ? (
                <ChannelMetadataEmptyState isGenerating={isGeneratingChannelMetadata} onGenerate={handleGenerateChannelMetadata} />
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
                    getTagValues={getActiveGridTagValues}
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
                    onUnkeyedRowInteraction={handleUnkeyedRowInteraction}
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

        <RightPanelShell isOpen={hasLoadedData && !state.isRightPanelCollapsed}>
          {viewScope !== 'videos' ? (
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
          ) : (
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
              inclusionView={inclusionView}
              onBatchCopySelection={handleBatchCopySelection}
              isBatchTagging={isTagWritePending}
              onWatchSession={handleWatchSession}
              openAnnotateRequestKey={openAnnotationsRequestKey}
            />
          )}
        </RightPanelShell>
      </main>

      <StatusFooter
        hasLoadedData={hasLoadedData}
        viewScope={viewScope}
        displayedRowCount={displayedRowCount}
        totalRowCount={totalScopeRowCount}
        isFilteringActive={viewScope === 'videos'
          ? (filteredColumns.length > 0 || Boolean(state.activeViewId))
          : channelFilteredColumns.length > 0}
        selectedVideoCount={selectedVideoCount}
      />

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
          closeImport();
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
