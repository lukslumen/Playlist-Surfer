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
