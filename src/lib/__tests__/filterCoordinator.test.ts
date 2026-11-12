import { describe, expect, test } from 'vitest';
import { buildTagValuesForColumn, buildUnifiedFilterState } from '../filterCoordinator';
import type { ColumnSchema } from '../../types';

const schema: ColumnSchema[] = [
  { column_name: 'videoId', column_type: 'VARCHAR' },
  { column_name: 'tags', column_type: 'VARCHAR' },
  { column_name: 'topicCategories', column_type: 'VARCHAR' },
];

const rows = [
  { videoId: 'a', tags: 'crime,drugs', topicCategories: 'Society' },
  { videoId: 'b', tags: 'crime,money', topicCategories: 'Lifestyle' },
  { videoId: 'c', tags: 'travel', topicCategories: 'Society' },
];

const base = { rows, schema, listLikeColumns: new Set<string>() };

describe('buildUnifiedFilterState', () => {
  test('returns all rows without filters and applies tag filters', () => {
    expect(buildUnifiedFilterState({ ...base, filterModel: {} }).filteredRows).toBe(rows);
    const filtered = buildUnifiedFilterState({
      ...base,
      filterModel: { tags: { filterKind: 'tag', values: ['crime'], matchMode: 'any' } },
    }).filteredRows;
    expect(filtered.map((row) => row.videoId)).toEqual(['a', 'b']);
  });
});

describe('buildTagValuesForColumn', () => {
  test('lists sorted distinct values of a tag column', () => {
    expect(buildTagValuesForColumn({ ...base, filterModel: {}, column: 'tags' }))
      .toEqual(['crime', 'drugs', 'money', 'travel']);
  });

  test("ignores the column's own filter but applies the others", () => {
    const filterModel = {
      tags: { filterKind: 'tag', values: ['travel'], matchMode: 'any' },
      topicCategories: { filterKind: 'tag', values: ['Society'], matchMode: 'any' },
    };
    // Own filter (travel) ignored, so 'drugs' from row a stays; topic filter removes row b ('money').
    expect(buildTagValuesForColumn({ ...base, filterModel, column: 'tags' })).toEqual(['crime', 'drugs', 'travel']);
  });

  test('returns nothing for unknown or non-tag columns', () => {
    expect(buildTagValuesForColumn({ ...base, filterModel: {}, column: 'missing' })).toEqual([]);
    expect(buildTagValuesForColumn({ ...base, filterModel: {}, column: 'videoId' })).toEqual([]);
  });
});

describe('between ranges', () => {
  const rangeSchema: ColumnSchema[] = [
    { column_name: 'videoId', column_type: 'VARCHAR' },
    { column_name: 'publishedAt', column_type: 'VARCHAR' },
    { column_name: 'viewCount', column_type: 'BIGINT' },
    { column_name: 'duration', column_type: 'VARCHAR' },
  ];
  const rangeRows = [
    { videoId: 'a', publishedAt: '2024-02-29T23:00:00Z', viewCount: 999, duration: 'PT59S' },
    { videoId: 'b', publishedAt: '2024-03-01T00:00:00Z', viewCount: 1000, duration: 'PT1M' },
    { videoId: 'c', publishedAt: '2024-03-31T23:59:59Z', viewCount: 9999, duration: 'PT4M59S' },
    { videoId: 'd', publishedAt: '2024-04-01T00:00:00Z', viewCount: 10000, duration: 'PT5M' },
  ];
  const filter = (column: string, filterKind: string, value: string) => buildUnifiedFilterState({
    rows: rangeRows,
    schema: rangeSchema,
    listLikeColumns: new Set<string>(),
    filterModel: { [column]: { filterKind, operator: 'between', value } },
  }).filteredRows.map((row) => row.videoId);

  test('dates accept readable bounds, including the start and excluding the end', () => {
    expect(filter('publishedAt', 'date', '2024-03-01..2024-04-01')).toEqual(['b', 'c']);
  });

  test('timestamps in milliseconds still work', () => {
    expect(filter('publishedAt', 'date', `${Date.UTC(2024, 2, 1)}..${Date.UTC(2024, 3, 1)}`)).toEqual(['b', 'c']);
  });

  test('numbers and durations use their own parsing', () => {
    expect(filter('viewCount', 'number', '1000..10000')).toEqual(['b', 'c']);
    expect(filter('duration', 'duration', '60..300')).toEqual(['b', 'c']);
    expect(filter('duration', 'duration', '1:00..5:00')).toEqual(['b', 'c']);
  });

  test('a malformed range matches nothing', () => {
    expect(filter('viewCount', 'number', '1000..')).toEqual([]);
  });
});
