import { ViewScope, InclusionView } from '../types';
import { ExplorerFilterModel } from './filterCoordinator';

export type AppNavigationEntry = {
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

export const NAVIGATION_HISTORY_LIMIT = 120;

export interface NavigationHistoryState {
  entries: AppNavigationEntry[];
  /** Index of the current entry, or -1 when empty. */
  cursor: number;
}

export const EMPTY_NAVIGATION_HISTORY: NavigationHistoryState = { entries: [], cursor: -1 };

const entryKey = (entry: AppNavigationEntry) => JSON.stringify(entry);

/**
 * Records a new current location: drops any "forward" entries, skips exact repeats, and keeps the
 * newest NAVIGATION_HISTORY_LIMIT entries with the cursor on the last one.
 */
export function recordNavigationEntry(state: NavigationHistoryState, entry: AppNavigationEntry): NavigationHistoryState {
  const base = state.cursor >= 0 ? state.entries.slice(0, state.cursor + 1) : state.entries;
  const last = base[base.length - 1];
  if (last && entryKey(last) === entryKey(entry)) {
    return base.length === state.entries.length ? state : { entries: base, cursor: base.length - 1 };
  }
  const entries = [...base, entry].slice(-NAVIGATION_HISTORY_LIMIT);
  return { entries, cursor: entries.length - 1 };
}

/** Moves back (-1) or forward (+1); returns the entry to restore, or null at either end. */
export function moveNavigationCursor(state: NavigationHistoryState, offset: -1 | 1): { state: NavigationHistoryState; entry: AppNavigationEntry | null } {
  const target = state.cursor + offset;
  const entry = state.entries[target];
  if (!entry) return { state, entry: null };
  return { state: { ...state, cursor: target }, entry };
}
