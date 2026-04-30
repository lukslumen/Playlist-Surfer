import {
  EMPTY_EXPLORER_SELECTION,
  clearScopeSelectionAction,
  getScopeSelection,
  pruneScopeSelectionAction,
  selectionReducer,
  setScopeDetailAction,
  setScopeSelectionAction,
} from '../selectionState';

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

let state = EMPTY_EXPLORER_SELECTION;

state = selectionReducer(state, setScopeSelectionAction('videos', {
  selectedKeys: ['v1', 'v2', 'v2', 'v3'],
}));

let videos = getScopeSelection(state, 'videos');
assert(videos.selectedKeys.length === 3, 'Video selection should dedupe keys.');
assert(videos.anchorKey === 'v1', 'Anchor should default to the first selected key.');
assert(videos.focusKey === 'v3', 'Focus should default to the last selected key.');
assert(videos.detailKey === 'v3', 'Detail should default to the focused key.');

state = selectionReducer(state, setScopeSelectionAction('channels', {
  selectedKeys: ['id:c1', 'id:c2'],
  anchorKey: 'id:c1',
  focusKey: 'id:c2',
  detailKey: 'id:c2',
}));

let channels = getScopeSelection(state, 'channels');
assert(channels.selectedKeys.length === 2, 'Channel selection should be independently tracked.');
assert(channels.detailKey === 'id:c2', 'Channel detail key should follow selection updates.');

state = selectionReducer(state, clearScopeSelectionAction('videos', true));
videos = getScopeSelection(state, 'videos');
assert(videos.selectedKeys.length === 0, 'Ctrl/Cmd + D clear should empty selected video keys.');
assert(videos.detailKey === 'v3', 'Clearing with preserveDetail should keep detail context.');

state = selectionReducer(state, pruneScopeSelectionAction('videos', ['v2', 'v3']));
videos = getScopeSelection(state, 'videos');
assert(videos.selectedKeys.length === 0, 'Pruning after clear should keep explicit selection empty.');
assert(videos.detailKey === 'v3', 'Pruning should keep preserved detail when still valid.');

state = selectionReducer(state, setScopeSelectionAction('videos', {
  selectedKeys: ['v2', 'v5', 'v7'],
  anchorKey: 'v2',
  focusKey: 'v7',
  detailKey: 'v5',
}));
state = selectionReducer(state, pruneScopeSelectionAction('videos', ['v5', 'v7']));
videos = getScopeSelection(state, 'videos');
assert(videos.selectedKeys.length === 2, 'Prune should remove keys no longer visible.');
assert(videos.anchorKey === 'v5', 'Anchor should move to first surviving key when old anchor is removed.');
assert(videos.focusKey === 'v7', 'Focus should remain when still visible.');
assert(videos.detailKey === 'v5', 'Detail key should remain aligned to a visible selected key.');

state = selectionReducer(state, setScopeDetailAction('channels', 'id:missing'));
channels = getScopeSelection(state, 'channels');
assert(channels.detailKey === null, 'Setting a missing detail key should clear channel detail.');

state = selectionReducer(state, clearScopeSelectionAction('channels', false));
channels = getScopeSelection(state, 'channels');
assert(channels.selectedKeys.length === 0, 'Channel clear should empty selected channel keys.');
assert(channels.detailKey === null, 'Channel clear without preserveDetail should clear detail context.');

console.log('selectionState.test.ts: ok');
