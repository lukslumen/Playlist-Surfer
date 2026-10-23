import { describe, expect, test } from 'vitest';
import {
  EMPTY_INCLUSION_STATE,
  applyInclusionChange,
  buildInclusionHistoryEvent,
  invertInclusionActionKind,
  pruneInclusionState,
  resolveInclusionActionKind,
  type InclusionChange,
  type InclusionState,
} from '../inclusion';

const valid = new Set(['a', 'b', 'c', 'd']);

function change(overrides: Partial<InclusionChange>): InclusionChange {
  return {
    kind: 'exclude',
    videoIds: [],
    validVideoIds: valid,
    now: '2026-10-23T12:00:00.000Z',
    scope: 'videos',
    selectionMode: 'manual',
    ...overrides,
  };
}

describe('resolveInclusionActionKind', () => {
  test('moves selection to the opposite list of the current view', () => {
    expect(resolveInclusionActionKind('included')).toBe('exclude');
    expect(resolveInclusionActionKind('excluded')).toBe('restore');
    expect(invertInclusionActionKind('exclude')).toBe('restore');
    expect(invertInclusionActionKind('restore')).toBe('exclude');
  });
});

describe('applyInclusionChange', () => {
  test('excludes ids and records meta', () => {
    const result = applyInclusionChange(EMPTY_INCLUSION_STATE, change({ videoIds: ['a', 'b'], reason: 'off-topic' }));
    expect(result.changedVideoIds).toEqual(['a', 'b']);
    expect(result.state.excludedVideoIds.sort()).toEqual(['a', 'b']);
    expect(result.state.excludedVideoMetaById.a).toMatchObject({
      videoId: 'a',
      reason: 'off-topic',
      excludedAt: '2026-10-23T12:00:00.000Z',
      restoredAt: null,
      exclusionMode: 'manual',
      exclusionScope: 'videos',
    });
  });

  test('skips unknown and duplicate ids', () => {
    const result = applyInclusionChange(EMPTY_INCLUSION_STATE, change({ videoIds: ['a', 'a', 'zzz'] }));
    expect(result.changedVideoIds).toEqual(['a']);
    expect(result.skippedVideoIds).toEqual(['zzz']);
  });

  test('only reports ids that actually changed, so undo cannot restore earlier exclusions', () => {
    const first = applyInclusionChange(EMPTY_INCLUSION_STATE, change({ videoIds: ['a'] }));
    const second = applyInclusionChange(first.state, change({ videoIds: ['a', 'b'] }));
    expect(second.changedVideoIds).toEqual(['b']);
    expect(second.skippedVideoIds).toEqual(['a']);

    const undo = applyInclusionChange(second.state, change({ kind: 'restore', videoIds: second.changedVideoIds }));
    expect(undo.state.excludedVideoIds).toEqual(['a']);
  });

  test('keeps the original exclusion meta when excluding an already excluded id', () => {
    const first = applyInclusionChange(EMPTY_INCLUSION_STATE, change({ videoIds: ['a'], reason: 'first' }));
    const second = applyInclusionChange(first.state, change({ videoIds: ['a'], reason: 'second', now: 'later' }));
    expect(second.state).toBe(first.state);
    expect(second.state.excludedVideoMetaById.a.reason).toBe('first');
  });

  test('restore keeps meta with a restoredAt timestamp', () => {
    const excluded = applyInclusionChange(EMPTY_INCLUSION_STATE, change({ videoIds: ['a', 'b'] }));
    const restored = applyInclusionChange(excluded.state, change({ kind: 'restore', videoIds: ['a'], now: 'restore-time' }));
    expect(restored.state.excludedVideoIds).toEqual(['b']);
    expect(restored.state.excludedVideoMetaById.a.restoredAt).toBe('restore-time');
  });

  test('restoring an included id is a no-op', () => {
    const result = applyInclusionChange(EMPTY_INCLUSION_STATE, change({ kind: 'restore', videoIds: ['a'] }));
    expect(result.changedVideoIds).toEqual([]);
    expect(result.state).toBe(EMPTY_INCLUSION_STATE);
  });

  test('filter summary is only stored for filtered bulk exclusions', () => {
    const manual = applyInclusionChange(EMPTY_INCLUSION_STATE, change({ videoIds: ['a'], filterSummary: 'views > 10' }));
    expect(manual.state.excludedVideoMetaById.a.exclusionFilterSummary).toBeUndefined();
    const bulk = applyInclusionChange(EMPTY_INCLUSION_STATE, change({
      videoIds: ['a'],
      selectionMode: 'filtered_bulk',
      filterSummary: 'views > 10',
    }));
    expect(bulk.state.excludedVideoMetaById.a.exclusionFilterSummary).toBe('views > 10');
  });
});

test('pruneInclusionState drops ids that left the dataset', () => {
  const state: InclusionState = applyInclusionChange(EMPTY_INCLUSION_STATE, change({ videoIds: ['a', 'b'] })).state;
  const pruned = pruneInclusionState(state, new Set(['b']));
  expect(pruned.excludedVideoIds).toEqual(['b']);
  expect(Object.keys(pruned.excludedVideoMetaById)).toEqual(['b']);
});

describe('buildInclusionHistoryEvent', () => {
  const base = {
    changedVideoIds: ['a', 'b'],
    scope: 'videos' as const,
    filterSummary: '',
    previousMetaById: {},
    now: '2026-10-23T12:00:00.000Z',
  };

  test('lists manually excluded videos alphabetically by title', () => {
    const event = buildInclusionHistoryEvent({
      ...base,
      kind: 'exclude',
      selectionMode: 'manual',
      reason: 'off-topic',
      changedRows: [
        { videoId: 'b', videoTitle: 'Zebra', channelTitle: 'Chan' },
        { videoId: 'a', videoTitle: 'Apple', channelTitle: 'Chan' },
      ],
    });
    expect(event.type).toBe('videos_excluded');
    expect(event.summary).toBe('Excluded 2 video(s).');
    expect(event.affectedIds).toEqual(['a', 'b']);
    const lines = String(event.details).split('\n');
    expect(lines[0]).toBe('Reason: off-topic');
    expect(lines.indexOf(lines.find((line) => line.includes('Apple'))!)).toBeLessThan(lines.indexOf(lines.find((line) => line.includes('Zebra'))!));
  });

  test('records the filter for bulk exclusions and explains restores of them', () => {
    const bulk = buildInclusionHistoryEvent({ ...base, kind: 'exclude', selectionMode: 'filtered_bulk', filterSummary: 'views > 10', changedRows: [] });
    expect(bulk.details).toBe('Filter context: views > 10');
    expect(bulk.meta?.selectionMode).toBe('filtered_bulk');

    const restore = buildInclusionHistoryEvent({
      ...base,
      kind: 'restore',
      selectionMode: 'manual',
      changedRows: [],
      previousMetaById: {
        a: { videoId: 'a', excludedAt: 'x', exclusionMode: 'filtered_bulk', exclusionFilterSummary: 'views > 10' },
      },
    });
    expect(restore.type).toBe('videos_restored');
    expect(restore.details).toContain('restored 1 row(s) previously excluded by exclude-all filtered action(s)');
    expect(restore.details).toContain('Original filter context: views > 10');
  });
});
