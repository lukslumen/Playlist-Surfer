import { describe, expect, test } from 'vitest';
import {
  EMPTY_NAVIGATION_HISTORY,
  NAVIGATION_HISTORY_LIMIT,
  moveNavigationCursor,
  recordNavigationEntry,
  type AppNavigationEntry,
} from '../navigation';

const entry = (selectedVideoId: string): AppNavigationEntry => ({
  viewScope: 'videos',
  inclusionView: 'included',
  activeViewId: null,
  filterModel: {},
  channelFilterModel: {},
  selectedVideoId,
  channelId: null,
  channelName: null,
  videoScopeChannelKeys: null,
  isChannelDrilldownFilterActive: false,
  drilldownPreviousVideoFilter: null,
});

describe('navigation history', () => {
  test('records entries and skips exact repeats', () => {
    let state = recordNavigationEntry(EMPTY_NAVIGATION_HISTORY, entry('a'));
    state = recordNavigationEntry(state, entry('a'));
    state = recordNavigationEntry(state, entry('b'));
    expect(state.entries.map((e) => e.selectedVideoId)).toEqual(['a', 'b']);
    expect(state.cursor).toBe(1);
  });

  test('moving back then recording drops the forward entries', () => {
    let state = ['a', 'b', 'c'].reduce((s, id) => recordNavigationEntry(s, entry(id)), EMPTY_NAVIGATION_HISTORY);
    const back = moveNavigationCursor(state, -1);
    expect(back.entry?.selectedVideoId).toBe('b');
    state = recordNavigationEntry(back.state, entry('d'));
    expect(state.entries.map((e) => e.selectedVideoId)).toEqual(['a', 'b', 'd']);
  });

  test('returns no entry at either end', () => {
    const state = recordNavigationEntry(EMPTY_NAVIGATION_HISTORY, entry('a'));
    expect(moveNavigationCursor(state, -1).entry).toBeNull();
    expect(moveNavigationCursor(state, 1).entry).toBeNull();
  });

  test('the cursor stays on the newest entry when the history is capped', () => {
    let state = EMPTY_NAVIGATION_HISTORY;
    for (let i = 0; i < NAVIGATION_HISTORY_LIMIT + 5; i += 1) state = recordNavigationEntry(state, entry(String(i)));
    expect(state.entries).toHaveLength(NAVIGATION_HISTORY_LIMIT);
    expect(state.cursor).toBe(NAVIGATION_HISTORY_LIMIT - 1);
    // Going back must land on the previous entry, not on the current one.
    expect(moveNavigationCursor(state, -1).entry?.selectedVideoId).toBe(String(NAVIGATION_HISTORY_LIMIT + 3));
  });
});
