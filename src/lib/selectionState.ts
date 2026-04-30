import type { ViewScope } from '../types';

export interface ScopeSelectionState {
  selectedKeys: string[];
  anchorKey: string | null;
  focusKey: string | null;
  detailKey: string | null;
}

export interface ExplorerSelectionState {
  videos: ScopeSelectionState;
  channels: ScopeSelectionState;
}

export type SelectionScope = ViewScope;

export type ScopeSelectionUpdate = {
  selectedKeys: string[];
  anchorKey?: string | null;
  focusKey?: string | null;
  detailKey?: string | null;
};

type SelectionAction =
  | { type: 'setScopeSelection'; scope: SelectionScope; update: ScopeSelectionUpdate }
  | { type: 'clearScopeSelection'; scope: SelectionScope; preserveDetail?: boolean }
  | { type: 'pruneScopeSelection'; scope: SelectionScope; validKeys: Set<string> | string[] }
  | { type: 'setScopeDetail'; scope: SelectionScope; detailKey: string | null };

export const EMPTY_SCOPE_SELECTION: ScopeSelectionState = {
  selectedKeys: [],
  anchorKey: null,
  focusKey: null,
  detailKey: null,
};

export const EMPTY_EXPLORER_SELECTION: ExplorerSelectionState = {
  videos: { ...EMPTY_SCOPE_SELECTION },
  channels: { ...EMPTY_SCOPE_SELECTION },
};

function normalizeKeys(keys: string[]) {
  return Array.from(new Set(
    keys
      .map((key) => String(key || '').trim())
      .filter((key) => key.length > 0),
  ));
}

function resolveAnchor(selectedKeys: string[], requestedAnchor: string | null | undefined) {
  if (!selectedKeys.length) return null;
  if (requestedAnchor && selectedKeys.includes(requestedAnchor)) return requestedAnchor;
  return selectedKeys[0];
}

function resolveFocus(selectedKeys: string[], requestedFocus: string | null | undefined) {
  if (!selectedKeys.length) return null;
  if (requestedFocus && selectedKeys.includes(requestedFocus)) return requestedFocus;
  return selectedKeys[selectedKeys.length - 1];
}

function resolveDetail(
  selectedKeys: string[],
  requestedDetail: string | null | undefined,
  fallback: string | null,
) {
  if (requestedDetail && selectedKeys.includes(requestedDetail)) return requestedDetail;
  if (fallback && selectedKeys.includes(fallback)) return fallback;
  if (selectedKeys.length > 0) return selectedKeys[selectedKeys.length - 1];
  return null;
}

function buildScopeSelection(current: ScopeSelectionState, update: ScopeSelectionUpdate): ScopeSelectionState {
  const selectedKeys = normalizeKeys(update.selectedKeys);
  if (!selectedKeys.length) {
    return {
      selectedKeys: [],
      anchorKey: null,
      focusKey: null,
      detailKey: update.detailKey ?? current.detailKey ?? null,
    };
  }
  const anchorKey = resolveAnchor(selectedKeys, update.anchorKey);
  const focusKey = resolveFocus(selectedKeys, update.focusKey);
  const detailKey = resolveDetail(selectedKeys, update.detailKey, current.detailKey);
  return {
    selectedKeys,
    anchorKey,
    focusKey,
    detailKey,
  };
}

function pruneScopeSelection(current: ScopeSelectionState, validKeysInput: Set<string> | string[]): ScopeSelectionState {
  const validKeys = validKeysInput instanceof Set ? validKeysInput : new Set(validKeysInput);
  const selectedKeys = current.selectedKeys.filter((key) => validKeys.has(key));
  if (!selectedKeys.length) {
    return {
      selectedKeys: [],
      anchorKey: null,
      focusKey: null,
      detailKey: current.detailKey && validKeys.has(current.detailKey) ? current.detailKey : null,
    };
  }
  const anchorKey = current.anchorKey && selectedKeys.includes(current.anchorKey) ? current.anchorKey : selectedKeys[0];
  const focusKey = current.focusKey && selectedKeys.includes(current.focusKey) ? current.focusKey : selectedKeys[selectedKeys.length - 1];
  const detailKey = resolveDetail(selectedKeys, current.detailKey, focusKey);
  return {
    selectedKeys,
    anchorKey,
    focusKey,
    detailKey,
  };
}

export function getScopeSelection(state: ExplorerSelectionState, scope: SelectionScope): ScopeSelectionState {
  return scope === 'channels' ? state.channels : state.videos;
}

export function selectionReducer(state: ExplorerSelectionState, action: SelectionAction): ExplorerSelectionState {
  const current = getScopeSelection(state, action.scope);
  const apply = (next: ScopeSelectionState) => (
    action.scope === 'channels'
      ? { ...state, channels: next }
      : { ...state, videos: next }
  );

  if (action.type === 'setScopeSelection') {
    return apply(buildScopeSelection(current, action.update));
  }

  if (action.type === 'clearScopeSelection') {
    return apply({
      selectedKeys: [],
      anchorKey: null,
      focusKey: null,
      detailKey: action.preserveDetail ? current.detailKey : null,
    });
  }

  if (action.type === 'pruneScopeSelection') {
    return apply(pruneScopeSelection(current, action.validKeys));
  }

  if (action.type === 'setScopeDetail') {
    const detailKey = action.detailKey === null
      ? null
      : (action.detailKey && current.selectedKeys.includes(action.detailKey) ? action.detailKey : null);
    return apply({ ...current, detailKey: detailKey ?? null });
  }

  return state;
}

export function setScopeSelectionAction(scope: SelectionScope, update: ScopeSelectionUpdate): SelectionAction {
  return { type: 'setScopeSelection', scope, update };
}

export function clearScopeSelectionAction(scope: SelectionScope, preserveDetail = true): SelectionAction {
  return { type: 'clearScopeSelection', scope, preserveDetail };
}

export function pruneScopeSelectionAction(scope: SelectionScope, validKeys: Set<string> | string[]): SelectionAction {
  return { type: 'pruneScopeSelection', scope, validKeys };
}

export function setScopeDetailAction(scope: SelectionScope, detailKey: string | null): SelectionAction {
  return { type: 'setScopeDetail', scope, detailKey };
}
