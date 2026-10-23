import type { ExcludedVideoMeta, IncludeExcludeAction, InclusionView, ResearchHistoryEvent, ViewScope } from '../types';
import { resolveVideoId } from './data';
import { buildAlphabetizedVideoTitleChannelList } from './researchHistory';

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

export function normalizeVideoIds(videoIds: string[], validIds: Set<string>) {
  return Array.from(new Set(videoIds.filter((videoId) => validIds.has(videoId))));
}

export type IncludeExcludeUndoEntry = IncludeExcludeAction & { historyEventId?: string; };

export interface InclusionHistoryInput {
  kind: InclusionActionKind;
  changedVideoIds: string[];
  scope: ViewScope;
  selectionMode: InclusionSelectionMode;
  filterSummary: string;
  reason?: string;
  /** Rows of the changed videos, for the alphabetical list of manually excluded titles. */
  changedRows: any[];
  /** Exclusion records before the change, to explain restores of filtered-bulk exclusions. */
  previousMetaById: Record<string, ExcludedVideoMeta>;
  eventId?: string;
  now: string;
}

/** The research-log entry for an include/exclude action, so the curation stays auditable. */
export function buildInclusionHistoryEvent(input: InclusionHistoryInput): Omit<ResearchHistoryEvent, 'id'> & { id?: string } {
  const { kind, changedVideoIds, selectionMode, filterSummary } = input;
  const details: string[] = [];
  if (input.reason?.trim()) details.push(`Reason: ${input.reason.trim()}`);
  if (kind === 'exclude' && selectionMode === 'filtered_bulk' && filterSummary) {
    details.push(`Filter context: ${filterSummary}`);
  }
  if (kind === 'exclude' && selectionMode === 'manual') {
    const labels = buildAlphabetizedVideoTitleChannelList(input.changedRows);
    if (labels.length) {
      details.push('Manually selected rows (alphabetical Title — Channel):');
      labels.forEach((label) => details.push(`- ${label}`));
    }
  }
  if (kind === 'restore') {
    const restoredFilteredBulkMeta = changedVideoIds
      .map((videoId) => input.previousMetaById[videoId])
      .filter((meta): meta is ExcludedVideoMeta => meta?.exclusionMode === 'filtered_bulk');
    if (restoredFilteredBulkMeta.length) {
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
  }
  return {
    id: input.eventId,
    type: kind === 'exclude' ? 'videos_excluded' : 'videos_restored',
    createdAt: input.now,
    summary: `${kind === 'exclude' ? 'Excluded' : 'Restored'} ${changedVideoIds.length.toLocaleString()} video(s).`,
    affectedIds: changedVideoIds,
    details: details.length ? details.join('\n') : undefined,
    meta: {
      scope: input.scope,
      selectionMode,
      filterSummary: filterSummary || undefined,
      count: changedVideoIds.length,
    },
  };
}

/** Rows for the changed videos: from the caller's selection if given, else looked up by id. */
export function pickChangedRows(changedVideoIds: string[], selectedRows: any[] | undefined, rowByVideoId: Map<string, any>) {
  const changed = new Set(changedVideoIds);
  if (Array.isArray(selectedRows) && selectedRows.length) {
    return selectedRows.filter((row) => changed.has(resolveVideoId(row) || ''));
  }
  return changedVideoIds.map((videoId) => rowByVideoId.get(videoId)).filter((row): row is any => Boolean(row));
}
