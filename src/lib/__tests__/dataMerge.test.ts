import { describe, expect, test } from 'vitest';
import type { ColumnSchema, MergeOptions } from '../../types';
import {
  applyDuplicateSelections,
  applyMerge,
  buildMergePreview,
  groupDuplicateRows,
} from '../data';

function cols(...names: string[]): ColumnSchema[] {
  return names.map((column_name) => ({ column_name, column_type: 'VARCHAR' }));
}

function options(overrides: Partial<MergeOptions> = {}): MergeOptions {
  return {
    mergeMode: 'add-update',
    columnMapping: {},
    conflictStrategies: {},
    rowConflictDecisions: {},
    unmatchedRowMode: 'all',
    selectedUnmatchedKeys: [],
    ...overrides,
  };
}

const existingRows = [
  { videoId: 'a', title: 'Old A', views: '10' },
  { videoId: 'b', title: 'Old B', views: '' },
];
const existingSchema = cols('videoId', 'title', 'views');
const incomingRows = [
  { videoId: 'a', title: 'New A', views: '10', topic: 'news' },
  { videoId: 'b', title: 'Old B', views: '20', topic: '' },
  { videoId: 'c', title: 'New C', views: '5', topic: 'sport' },
];
const incomingSchema = cols('videoId', 'title', 'views', 'topic');

function merge(overrides: Partial<MergeOptions> = {}, rows: Array<Record<string, unknown>> = incomingRows) {
  return applyMerge({
    existingRows,
    incomingRows: rows,
    existingSchema,
    incomingSchema,
    joinColumn: 'videoId',
    mergeOptions: options(overrides),
  });
}

describe('groupDuplicateRows', () => {
  test('groups rows sharing a key, ignoring unique and empty keys', () => {
    const rows = [{ k: 'x' }, { k: 'y' }, { k: 'x' }, { k: '' }, { k: '' }, { k: null }];
    expect(groupDuplicateRows(rows, 'k')).toEqual([{ key: 'x', rowIndices: [0, 2], rows: [{ k: 'x' }, { k: 'x' }] }]);
  });

  test('treats numeric and string keys as the same key', () => {
    expect(groupDuplicateRows([{ k: 1 }, { k: '1' }], 'k')[0].rowIndices).toEqual([0, 1]);
  });

  test('returns nothing without a key column', () => {
    expect(groupDuplicateRows([{ k: 'x' }, { k: 'x' }], '')).toEqual([]);
  });
});

describe('applyDuplicateSelections', () => {
  const rows = [{ k: 'x', n: 1 }, { k: 'y', n: 2 }, { k: 'x', n: 3 }, { k: 'x', n: 4 }];
  const groups = groupDuplicateRows(rows, 'k');

  test('keeps the first row of each group by default', () => {
    expect(applyDuplicateSelections(rows, groups).map((row) => row.n)).toEqual([1, 2]);
  });

  test('keeps the selected original row index', () => {
    expect(applyDuplicateSelections(rows, groups, { x: 3 }).map((row) => row.n)).toEqual([2, 4]);
  });

  test('returns rows unchanged when there are no groups', () => {
    expect(applyDuplicateSelections(rows, [])).toBe(rows);
  });
});

describe('buildMergePreview', () => {
  const preview = buildMergePreview({
    existingRows,
    incomingRows,
    existingSchema,
    incomingSchema,
    joinColumn: 'videoId',
  });

  test('counts matched and unmatched incoming rows', () => {
    expect(preview.matchedCount).toBe(2);
    expect(preview.unmatchedIncomingCount).toBe(1);
  });

  test('maps identical column names and reports new incoming columns', () => {
    expect(preview.matchedColumns).toEqual([
      { existingColumn: 'videoId', incomingColumn: 'videoId' },
      { existingColumn: 'title', incomingColumn: 'title' },
      { existingColumn: 'views', incomingColumn: 'views' },
    ]);
    expect(preview.newColumns).toEqual(['topic']);
    expect(preview.unmatchedIncomingColumns).toEqual(['topic']);
  });

  test('only counts conflicts where both values are present and differ', () => {
    expect(preview.conflictColumns).toEqual([{ column: 'title', incomingColumn: 'title', count: 1 }]);
  });

  test('maps columns by normalized name and honours explicit mappings', () => {
    const result = buildMergePreview({
      existingRows: [{ video_id: 'a', Title: 'x' }],
      incomingRows: [{ VideoID: 'a', heading: 'y' }],
      existingSchema: cols('video_id', 'Title'),
      incomingSchema: cols('VideoID', 'heading'),
      joinColumn: 'video_id',
      incomingJoinColumn: 'VideoID',
      columnMapping: { Title: 'heading' },
    });
    expect(result.matchedCount).toBe(1);
    expect(result.matchedColumns).toEqual([
      { existingColumn: 'video_id', incomingColumn: 'VideoID' },
      { existingColumn: 'Title', incomingColumn: 'heading' },
    ]);
    expect(result.newColumns).toEqual([]);
    expect(result.conflictColumns).toEqual([{ column: 'Title', incomingColumn: 'heading', count: 1 }]);
  });

  test('incoming rows with an empty join key are unmatched', () => {
    const result = buildMergePreview({
      existingRows,
      incomingRows: [{ videoId: '' }, { videoId: null }],
      existingSchema,
      incomingSchema,
      joinColumn: 'videoId',
    });
    expect(result.matchedCount).toBe(0);
    expect(result.unmatchedIncomingCount).toBe(2);
  });

  test('reports duplicate groups on both sides', () => {
    const result = buildMergePreview({
      existingRows: [...existingRows, { videoId: 'a', title: 'dup' }],
      incomingRows: [...incomingRows, { videoId: 'c', title: 'dup' }],
      existingSchema,
      incomingSchema,
      joinColumn: 'videoId',
    });
    expect(result.duplicateGroupsExisting.map((group) => group.key)).toEqual(['a']);
    expect(result.duplicateGroupsIncoming.map((group) => group.key)).toEqual(['c']);
  });
});

describe('applyMerge', () => {
  test('rows without a join key are appended once, never matched to other key-less rows', () => {
    const result = applyMerge({
      existingRows: [{ videoId: '', title: 'E' }, { videoId: 'a', title: 'A' }],
      incomingRows: [{ videoId: '', title: 'I', extra: 'x' }],
      existingSchema: [{ column_name: 'videoId', column_type: 'VARCHAR' }, { column_name: 'title', column_type: 'VARCHAR' }],
      incomingSchema: [{ column_name: 'videoId', column_type: 'VARCHAR' }, { column_name: 'title', column_type: 'VARCHAR' }, { column_name: 'extra', column_type: 'VARCHAR' }],
      joinColumn: 'videoId',
      mergeOptions: options({ conflictStrategies: { title: 'use-new' } }),
    });
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({ videoId: '', title: 'E' });
    expect(result.rows.filter((row) => row.title === 'I')).toHaveLength(1);
  });

  test('add-update keeps existing values on conflict by default, fills blanks and adds new rows', () => {
    const { rows } = merge();
    expect(rows).toEqual([
      { videoId: 'a', title: 'Old A', views: '10', topic: 'news' },
      { videoId: 'b', title: 'Old B', views: '20' },
      { videoId: 'c', title: 'New C', views: '5', topic: 'sport' },
    ]);
  });

  test('use-new strategy overwrites conflicting values for that column only', () => {
    const { rows } = merge({ conflictStrategies: { title: 'use-new' } });
    expect(rows[0].title).toBe('New A');
    expect(rows[1].title).toBe('Old B');
  });

  test('review strategy applies per-row decisions and defaults to existing', () => {
    const accepted = merge({ conflictStrategies: { title: 'review' }, rowConflictDecisions: { title: { a: 'new' } } });
    expect(accepted.rows[0].title).toBe('New A');
    const undecided = merge({ conflictStrategies: { title: 'review' } });
    expect(undecided.rows[0].title).toBe('Old A');
  });

  test('empty incoming values never erase existing data', () => {
    const { rows } = merge({ conflictStrategies: { title: 'use-new' } }, [{ videoId: 'a', title: '', views: null, topic: '' }]);
    expect(rows[0]).toEqual({ videoId: 'a', title: 'Old A', views: '10' });
  });

  test('update-only updates matches but never appends unmatched rows', () => {
    const { rows } = merge({ mergeMode: 'update-only' });
    expect(rows.map((row) => row.videoId)).toEqual(['a', 'b']);
    expect(rows[1].views).toBe('20');
  });

  test('add-only appends unmatched rows but leaves existing rows untouched', () => {
    const { rows } = merge({ mergeMode: 'add-only' });
    expect(rows[0]).toEqual(existingRows[0]);
    expect(rows[1]).toEqual(existingRows[1]);
    expect(rows[2].videoId).toBe('c');
  });

  test('unmatched row mode none and custom limit which new rows are added', () => {
    const extra = [...incomingRows, { videoId: 'd', title: 'D' }];
    expect(merge({ unmatchedRowMode: 'none' }, extra).rows).toHaveLength(2);
    const custom = merge({ unmatchedRowMode: 'custom', selectedUnmatchedKeys: ['d'] }, extra).rows;
    expect(custom.map((row) => row.videoId)).toEqual(['a', 'b', 'd']);
  });

  test('does not mutate the existing rows', () => {
    const snapshot = JSON.parse(JSON.stringify(existingRows));
    merge({ conflictStrategies: { title: 'use-new' } });
    expect(existingRows).toEqual(snapshot);
  });

  test('result schema keeps existing columns and adds incoming-only columns', () => {
    const { schema } = merge();
    expect(schema.map((column) => column.column_name)).toEqual(['videoId', 'title', 'views', 'topic']);
  });

  test('joins on different column names via incomingJoinColumn', () => {
    const { rows } = applyMerge({
      existingRows: [{ videoId: 'a', title: '' }],
      incomingRows: [{ vid: 'a', title: 'Filled' }],
      existingSchema: cols('videoId', 'title'),
      incomingSchema: cols('vid', 'title'),
      joinColumn: 'videoId',
      incomingJoinColumn: 'vid',
      mergeOptions: options({ unmatchedRowMode: 'none' }),
    });
    expect(rows).toEqual([{ videoId: 'a', title: 'Filled' }]);
  });

  test('resolves duplicate rows on both sides before merging', () => {
    const { rows } = applyMerge({
      existingRows: [{ videoId: 'a', title: 'first' }, { videoId: 'a', title: 'second' }],
      incomingRows: [{ videoId: 'a', note: 'n1' }, { videoId: 'a', note: 'n2' }],
      existingSchema: cols('videoId', 'title'),
      incomingSchema: cols('videoId', 'note'),
      joinColumn: 'videoId',
      mergeOptions: options({ existingDuplicateSelections: { a: 1 }, incomingDuplicateSelections: { a: 1 } }),
    });
    expect(rows).toEqual([{ videoId: 'a', title: 'second', note: 'n2' }]);
  });

  test('copies mapped transcript and description columns into canonical fields', () => {
    const { rows } = applyMerge({
      existingRows: [{ videoId: 'a', transcript: 'old transcript' }],
      incomingRows: [
        { videoId: 'a', subs: 'new transcript', desc: 'about' },
        { videoId: 'z', subs: 'z transcript', desc: 'z about' },
      ],
      existingSchema: cols('videoId', 'transcript'),
      incomingSchema: cols('videoId', 'subs', 'desc'),
      joinColumn: 'videoId',
      mergeOptions: options({ specialMappings: { transcriptColumn: 'subs', descriptionColumn: 'desc' } }),
    });
    expect(rows[0].transcript).toBe('new transcript');
    expect(rows[0].videoDescription).toBe('about');
    expect(rows[1]).toMatchObject({ videoId: 'z', transcript: 'z transcript', videoDescription: 'z about', subs: 'z transcript' });
  });
});
