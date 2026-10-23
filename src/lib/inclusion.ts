import type { ExcludedVideoMeta, IncludeExcludeAction, InclusionView, ViewScope } from '../types';

export type InclusionActionKind = IncludeExcludeAction['kind'];
export type InclusionSelectionMode = NonNullable<IncludeExcludeAction['selectionMode']>;

export interface InclusionState {
  excludedVideoIds: string[];
  excludedVideoMetaById: Record<string, ExcludedVideoMeta>;
}

export interface InclusionChange {
  kind: InclusionActionKind;
  videoIds: string[];
  /** Video ids that exist in the current dataset; anything else is skipped. */
  validVideoIds: Set<string>;
  now: string;
  scope: ViewScope;
  selectionMode: InclusionSelectionMode;
  reason?: string;
  filterSummary?: string;
}

export interface InclusionChangeResult {
  state: InclusionState;
  /** Ids whose membership actually flipped. Undo must only reverse these. */
  changedVideoIds: string[];
  /** Ids that were unknown or already on the target side. */
  skippedVideoIds: string[];
}

export const EMPTY_INCLUSION_STATE: InclusionState = {
  excludedVideoIds: [],
  excludedVideoMetaById: {},
};

/** Moving a selection always sends it to the other list from the one being viewed. */
export function resolveInclusionActionKind(view: InclusionView): InclusionActionKind {
  return view === 'included' ? 'exclude' : 'restore';
}

export function invertInclusionActionKind(kind: InclusionActionKind): InclusionActionKind {
  return kind === 'exclude' ? 'restore' : 'exclude';
}

export function applyInclusionChange(state: InclusionState, change: InclusionChange): InclusionChangeResult {
  const excluded = new Set(state.excludedVideoIds);
  const changedVideoIds: string[] = [];
  const skippedVideoIds: string[] = [];

  Array.from(new Set(change.videoIds)).forEach((videoId) => {
    const isExcluded = excluded.has(videoId);
    const alreadyOnTarget = change.kind === 'exclude' ? isExcluded : !isExcluded;
    if (!change.validVideoIds.has(videoId) || alreadyOnTarget) {
      skippedVideoIds.push(videoId);
      return;
    }
    changedVideoIds.push(videoId);
  });

  if (!changedVideoIds.length) {
    return { state, changedVideoIds, skippedVideoIds };
  }

  const nextMeta = { ...state.excludedVideoMetaById };
  changedVideoIds.forEach((videoId) => {
    if (change.kind === 'exclude') {
      excluded.add(videoId);
      nextMeta[videoId] = {
        videoId,
        reason: change.reason,
        excludedAt: change.now,
        restoredAt: null,
        exclusionMode: change.selectionMode,
        exclusionScope: change.scope,
        exclusionFilterSummary: change.selectionMode === 'filtered_bulk' ? change.filterSummary : undefined,
      };
      return;
    }
    excluded.delete(videoId);
    // Keep the exclusion record so the research log can explain the restore.
    if (nextMeta[videoId]) {
      nextMeta[videoId] = { ...nextMeta[videoId], restoredAt: change.now };
    }
  });

  return {
    state: {
      excludedVideoIds: Array.from(excluded),
      excludedVideoMetaById: nextMeta,
    },
    changedVideoIds,
    skippedVideoIds,
  };
}

/** Drops exclusions for videos that are no longer in the dataset (e.g. after deleting a source). */
export function pruneInclusionState(state: InclusionState, survivingVideoIds: Set<string>): InclusionState {
  return {
    excludedVideoIds: state.excludedVideoIds.filter((videoId) => survivingVideoIds.has(videoId)),
    excludedVideoMetaById: Object.fromEntries(
      Object.entries(state.excludedVideoMetaById).filter(([videoId]) => survivingVideoIds.has(videoId)),
    ),
  };
}
