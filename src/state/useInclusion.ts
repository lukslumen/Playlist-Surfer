import { useCallback, useRef, useState, type TransitionStartFunction } from 'react';
import { flushSync } from 'react-dom';
import type { ExcludedVideoMeta, InclusionView, ViewScope } from '../types';
import {
  applyInclusionChange,
  buildInclusionHistoryEvent,
  invertInclusionActionKind,
  pickChangedRows,
  resolveInclusionActionKind,
  type IncludeExcludeUndoEntry,
  type InclusionActionKind,
  type InclusionSelectionMode,
  type InclusionState,
} from '../lib/inclusion';
import { createHistoryId, summarizeFilterModel } from '../lib/researchHistory';
import type { ExplorerFilterModel } from '../lib/filterCoordinator';
import type { NewResearchHistoryEvent } from './useResearchHistory';

/**
 * Which videos are excluded, which list is being viewed, and the include/exclude undo history.
 * Declared early in App because the row pipeline depends on it.
 */
export function useInclusionState(persisted: {
  inclusionView?: InclusionView;
  excludedVideoIds?: string[];
  excludedVideoMetaById?: Record<string, ExcludedVideoMeta>;
}) {
  const [inclusionView, setInclusionView] = useState<InclusionView>(() => (persisted.inclusionView === 'excluded' ? 'excluded' : 'included'));
  const [inclusionState, setInclusionStateValue] = useState<InclusionState>(() => ({
    excludedVideoIds: persisted.excludedVideoIds ?? [],
    excludedVideoMetaById: persisted.excludedVideoMetaById ?? {},
  }));
  // Mirrors the latest requested state so back-to-back actions never compute from a stale render.
  const inclusionStateRef = useRef(inclusionState);
  const setInclusionState = useCallback((next: InclusionState) => {
    inclusionStateRef.current = next;
    setInclusionStateValue(next);
  }, []);
  const [undoStack, setUndoStack] = useState<IncludeExcludeUndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<IncludeExcludeUndoEntry[]>([]);

  /** Forget undo/redo history, e.g. after loading another project. */
  const resetInclusionHistory = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  return {
    inclusionView,
    setInclusionView,
    inclusionStateRef,
    setInclusionState,
    excludedVideoIds: inclusionState.excludedVideoIds,
    excludedVideoMetaById: inclusionState.excludedVideoMetaById,
    undoStack,
    setUndoStack,
    redoStack,
    setRedoStack,
    resetInclusionHistory,
  };
}

type InclusionStateApi = ReturnType<typeof useInclusionState>;

export interface ApplyInclusionOptions {
  skipUndo?: boolean;
  reason?: string;
  preserveRedo?: boolean;
  scope?: ViewScope;
  selectionMode?: InclusionSelectionMode;
  filterSummary?: string;
  selectedRows?: any[];
}

/** Include/exclude actions with undo/redo and research-log entries. */
export function useInclusionActions(args: {
  inclusion: InclusionStateApi;
  viewScope: ViewScope;
  /** Video ids present in the dataset; anything else is ignored. */
  sourceVideoIdSet: Set<string>;
  sourceRowByVideoId: Map<string, any>;
  selectedVideoIds: string[];
  visibleVideoIds: string[];
  areAllVisibleVideosSelected: boolean;
  selectedVideoRows: any[];
  filterModel: ExplorerFilterModel;
  startTransition: TransitionStartFunction;
  /** Called synchronously before the change, e.g. to clear selections and caches. */
  onBeforeChange: () => void;
  /** Called inside the transition after the change, e.g. to bump dataset versions. */
  onChanged: () => void;
  appendResearchHistory: (event: NewResearchHistoryEvent) => void;
  markResearchHistoryEventReverted: (eventId?: string) => void;
}) {
  const {
    inclusion,
    viewScope,
    sourceVideoIdSet,
    sourceRowByVideoId,
    selectedVideoIds,
    visibleVideoIds,
    areAllVisibleVideosSelected,
    selectedVideoRows,
    filterModel,
    startTransition,
    onBeforeChange,
    onChanged,
    appendResearchHistory,
    markResearchHistoryEventReverted,
  } = args;
  const { inclusionView, inclusionStateRef, setInclusionState, setUndoStack, setRedoStack, undoStack, redoStack } = inclusion;

  const applyIncludeExcludeAction = useCallback((videoIds: string[], targetKind?: InclusionActionKind, options?: ApplyInclusionOptions) => {
    const kind = targetKind ?? resolveInclusionActionKind(inclusionView);
    const scope = options?.scope || viewScope;
    const selectionMode = options?.selectionMode || 'manual';
    const filterSummary = String(options?.filterSummary || '').trim();
    const previous = inclusionStateRef.current;
    const now = new Date().toISOString();
    const result = applyInclusionChange(previous, {
      kind,
      videoIds,
      validVideoIds: sourceVideoIdSet,
      now,
      scope,
      selectionMode,
      reason: options?.reason,
      filterSummary,
    });
    const { changedVideoIds } = result;
    if (changedVideoIds.length === 0) return;

    const eventId = options?.skipUndo ? undefined : createHistoryId('exclusion');
    const historyEvent = options?.skipUndo ? null : buildInclusionHistoryEvent({
      kind,
      changedVideoIds,
      scope,
      selectionMode,
      filterSummary,
      reason: options?.reason,
      changedRows: pickChangedRows(changedVideoIds, options?.selectedRows, sourceRowByVideoId),
      previousMetaById: previous.excludedVideoMetaById,
      eventId,
      now,
    });

    flushSync(onBeforeChange);

    startTransition(() => {
      setInclusionState(result.state);
      if (historyEvent) {
        setUndoStack((current) => [...current, {
          kind,
          videoIds: changedVideoIds,
          scope,
          selectionMode,
          filterSummary: filterSummary || undefined,
          historyEventId: eventId,
        }]);
        if (!options?.preserveRedo) setRedoStack([]);
        appendResearchHistory(historyEvent);
      }
      onChanged();
    });
  }, [appendResearchHistory, inclusionStateRef, inclusionView, onBeforeChange, onChanged, setInclusionState, setRedoStack, setUndoStack, sourceRowByVideoId, sourceVideoIdSet, startTransition, viewScope]);

  const handleMoveVideos = useCallback((videoIds: string[]) => {
    applyIncludeExcludeAction(videoIds);
  }, [applyIncludeExcludeAction]);

  // The grid passes its own keys: a shortcut pressed right after a click can arrive before App re-renders.
  const handleMoveSelectedVideos = useCallback((videoIdsFromGrid?: string[]) => {
    const fromGrid = Array.isArray(videoIdsFromGrid);
    const nextVideoIds = fromGrid ? videoIdsFromGrid : selectedVideoIds;
    if (nextVideoIds.length === 0) return;
    const targetKind = resolveInclusionActionKind(inclusionView);
    const allVisibleSelected = fromGrid
      ? (() => {
          if (!visibleVideoIds.length || nextVideoIds.length !== visibleVideoIds.length) return false;
          const nextSet = new Set(nextVideoIds);
          return visibleVideoIds.every((videoId) => nextSet.has(videoId));
        })()
      : areAllVisibleVideosSelected;
    applyIncludeExcludeAction(nextVideoIds, targetKind, {
      scope: 'videos',
      selectionMode: targetKind === 'exclude' && allVisibleSelected ? 'filtered_bulk' : 'manual',
      filterSummary: summarizeFilterModel(filterModel),
      selectedRows: fromGrid ? undefined : selectedVideoRows,
    });
  }, [applyIncludeExcludeAction, areAllVisibleVideosSelected, filterModel, inclusionView, selectedVideoIds, selectedVideoRows, visibleVideoIds]);

  const handleUndoIncludeExclude = useCallback(() => {
    const lastAction = undoStack[undoStack.length - 1];
    if (!lastAction) return;
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current, lastAction]);
    markResearchHistoryEventReverted(lastAction.historyEventId);
    applyIncludeExcludeAction(lastAction.videoIds, invertInclusionActionKind(lastAction.kind), {
      skipUndo: true,
      scope: lastAction.scope,
      selectionMode: lastAction.selectionMode,
      filterSummary: lastAction.filterSummary,
    });
  }, [applyIncludeExcludeAction, markResearchHistoryEventReverted, setRedoStack, setUndoStack, undoStack]);

  const handleRedoIncludeExclude = useCallback(() => {
    const lastAction = redoStack[redoStack.length - 1];
    if (!lastAction) return;
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current, lastAction]);
    applyIncludeExcludeAction(lastAction.videoIds, lastAction.kind, {
      skipUndo: true,
      scope: lastAction.scope,
      selectionMode: lastAction.selectionMode,
      filterSummary: lastAction.filterSummary,
    });
  }, [applyIncludeExcludeAction, redoStack, setRedoStack, setUndoStack]);

  return {
    applyIncludeExcludeAction,
    handleMoveVideos,
    handleMoveSelectedVideos,
    handleUndoIncludeExclude,
    handleRedoIncludeExclude,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
