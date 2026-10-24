import { describe, expect, test } from 'vitest';
import type { ColumnSchema } from '../../types';
import {
  applyFriendlyColumnMappings,
  buildColumnDisplayNameMap,
  deriveSchemaFromRows,
  detectFriendlyImportSchema,
  detectImportKind,
  detectIncomingChannelCreatedAtColumn,
  detectIncomingChannelIdColumn,
  detectIncomingChannelTitleColumn,
  detectSpecialMappings,
  detectSuggestedMergeJoinColumns,
  getColumnDisplayName,
  getColumnHeaderTooltip,
  getDefaultGridColumnSizing,
  normalizeColumnName,
  resolveTagFilterColumn,
  stripDeletedColumnsFromRows,
  stripDeletedColumnsFromSchema,
} from '../data';

function cols(...names: string[]): ColumnSchema[] {
  return names.map((column_name) => ({ column_name, column_type: 'VARCHAR' }));
}

const videolistColumns = cols('position', 'channelId', 'channelTitle', 'videoId', 'videoTitle', 'durationSec', 'commentCount');
const channelsearchColumns = cols('position', 'id', 'title', 'publishedAt', 'subscriberCount', 'videoCount', 'topicDetails');

describe('normalizeColumnName', () => {
  test('lowercases and strips every non-alphanumeric character', () => {
    expect(normalizeColumnName('Video_ID')).toBe('videoid');
    expect(normalizeColumnName('channel id ')).toBe('channelid');
    expect(normalizeColumnName('Published-At (SQL)')).toBe('publishedatsql');
  });
});

describe('detectFriendlyImportSchema', () => {
  test('recognises a YouTube Data Tools video list by its headers alone', () => {
    expect(detectFriendlyImportSchema(videolistColumns)).toBe('youtube-data-tools-videolist');
  });

  test('recognises a YouTube Data Tools channel search by its headers alone', () => {
    expect(detectFriendlyImportSchema(channelsearchColumns)).toBe('youtube-data-tools-channelsearch');
  });

  test('a matching file name is enough even when headers are weak', () => {
    expect(detectFriendlyImportSchema(cols('foo', 'bar'), 'export_videolist_2024.csv')).toBe('youtube-data-tools-videolist');
    expect(detectFriendlyImportSchema(cols('foo'), 'ChannelSearch.tab')).toBe('youtube-data-tools-channelsearch');
  });

  test('returns null when fewer than four signature headers match and the file name is generic', () => {
    expect(detectFriendlyImportSchema(cols('videoId', 'channelId', 'videoTitle'), 'data.csv')).toBeNull();
    expect(detectFriendlyImportSchema(cols('a', 'b', 'c'))).toBeNull();
  });

  test('matches signature headers case- and punctuation-insensitively', () => {
    expect(detectFriendlyImportSchema(cols('video_id', 'Channel ID', 'video title', 'duration_sec'))).toBe('youtube-data-tools-videolist');
  });
});

describe('applyFriendlyColumnMappings', () => {
  test('without a detected schema only fills source_column_name', () => {
    const result = applyFriendlyColumnMappings(cols('foo', 'bar'));
    expect(result).toEqual([
      { column_name: 'foo', column_type: 'VARCHAR', source_column_name: 'foo' },
      { column_name: 'bar', column_type: 'VARCHAR', source_column_name: 'bar' },
    ]);
  });

  test('assigns friendly display names, semantic types and width hints for a video list', () => {
    const result = applyFriendlyColumnMappings(videolistColumns);
    const byName = Object.fromEntries(result.map((column) => [column.column_name, column]));
    expect(byName.videoId.display_column_name).toBe('Video ID');
    expect(byName.videoId.semantic_type).toBe('video-id');
    expect(byName.videoId.width_hint).toBe('medium');
    expect(byName.channelTitle.display_column_name).toBe('Channel Name');
    expect(byName.position.display_column_name).toBe('Search Ranking');
    expect(byName.position.width_hint).toBe('tiny');
    expect(byName.durationSec.display_column_name).toBe('Duration (Seconds)');
    expect(result.every((column) => column.detected_schema === 'youtube-data-tools-videolist')).toBe(true);
  });

  test('keeps unmapped columns under their raw name', () => {
    const result = applyFriendlyColumnMappings([...videolistColumns, { column_name: 'my_custom', column_type: 'VARCHAR' }]);
    expect(result.at(-1)?.display_column_name).toBe('my_custom');
    expect(result.at(-1)?.source_column_name).toBe('my_custom');
  });

  test('disambiguates duplicate display names with a numeric suffix', () => {
    const result = applyFriendlyColumnMappings(cols('videoId', 'channelId', 'videoTitle', 'durationSec', 'Video ID'));
    expect(result.map((column) => column.display_column_name)).toEqual([
      'Video ID',
      'Channel ID',
      'Video Title',
      'Duration (Seconds)',
      'Video ID (2)',
    ]);
  });

  test('existing semantic types and width hints win over schema hints', () => {
    const schema: ColumnSchema[] = [
      ...videolistColumns.filter((column) => column.column_name !== 'videoId'),
      { column_name: 'videoId', column_type: 'VARCHAR', semantic_type: 'custom', width_hint: 'xwide' },
    ];
    const videoId = applyFriendlyColumnMappings(schema).find((column) => column.column_name === 'videoId');
    expect(videoId?.semantic_type).toBe('custom');
    expect(videoId?.width_hint).toBe('xwide');
  });

  test('maps by source_column_name when the column was renamed', () => {
    const schema: ColumnSchema[] = [
      ...videolistColumns,
      { column_name: 'views_renamed', column_type: 'BIGINT', source_column_name: 'viewCount' },
    ];
    const renamed = applyFriendlyColumnMappings(schema).at(-1);
    expect(renamed?.display_column_name).toBe('Views');
    expect(renamed?.semantic_type).toBe('count');
  });
});

describe('getColumnDisplayName / buildColumnDisplayNameMap', () => {
  test('prefers an explicit display_column_name', () => {
    expect(getColumnDisplayName({ column_name: 'x', display_column_name: 'Pretty X' })).toBe('Pretty X');
  });

  test('gives canonical channel columns a friendly name even as plain strings', () => {
    expect(getColumnDisplayName('channel_name')).toBe('Channel Name');
    expect(getColumnDisplayName('channel_id')).toBe('Channel ID');
    expect(getColumnDisplayName('whatever')).toBe('whatever');
  });

  test('looks string column names up in the schema', () => {
    const schema: ColumnSchema[] = [{ column_name: 'vid', column_type: 'VARCHAR', display_column_name: 'Video' }];
    expect(getColumnDisplayName('vid', schema)).toBe('Video');
  });

  test('qualifies secondary channel-name and channel-id columns when canonical ones exist', () => {
    const schema: ColumnSchema[] = [
      { column_name: 'channel_name', column_type: 'VARCHAR' },
      { column_name: 'channel_id', column_type: 'VARCHAR' },
      { column_name: 'channelTitle', column_type: 'VARCHAR', semantic_type: 'channel-name' },
      { column_name: 'cid', column_type: 'VARCHAR', source_column_name: 'channelId', semantic_type: 'channel-id' },
    ];
    expect(buildColumnDisplayNameMap(schema)).toEqual({
      channel_name: 'Channel Name',
      channel_id: 'Channel ID',
      channelTitle: 'Channel Name (channelTitle)',
      cid: 'Channel ID (channelId)',
    });
  });

  test('does not qualify semantic channel columns without a canonical column', () => {
    const schema: ColumnSchema[] = [{ column_name: 'channelTitle', column_type: 'VARCHAR', semantic_type: 'channel-name' }];
    expect(buildColumnDisplayNameMap(schema)).toEqual({ channelTitle: 'channelTitle' });
  });
});

describe('getColumnHeaderTooltip', () => {
  test('returns only the raw name when it equals the display name', () => {
    expect(getColumnHeaderTooltip({ column_name: 'foo' })).toBe('foo');
  });

  test('lists display name, raw field and detected schema', () => {
    expect(getColumnHeaderTooltip({
      column_name: 'videoId',
      display_column_name: 'Video ID',
      detected_schema: 'youtube-data-tools-videolist',
    })).toBe('Video ID\nRaw field: videoId\nDetected schema: youtube-data-tools-videolist');
  });
});

describe('getDefaultGridColumnSizing', () => {
  test('ranks are tiny, durations small, descriptions extra wide', () => {
    expect(getDefaultGridColumnSizing({ column_name: 'position', column_type: 'BIGINT' }).initialWidth).toBe(82);
    expect(getDefaultGridColumnSizing({ column_name: 'durationSec', column_type: 'BIGINT' }).initialWidth).toBe(112);
    expect(getDefaultGridColumnSizing({ column_name: 'videoDescription', column_type: 'VARCHAR' })).toEqual({ initialWidth: 320, minWidth: 180, maxWidth: 760 });
  });

  test('numeric columns without other hints get a numeric width', () => {
    expect(getDefaultGridColumnSizing({ column_name: 'score', column_type: 'DOUBLE' }).initialWidth).toBe(118);
  });

  test('estimates width from header and sample length for generic text', () => {
    const sizing = getDefaultGridColumnSizing({ column_name: 'abc', column_type: 'VARCHAR' }, ['x']);
    expect(sizing.initialWidth).toBe(100);
    expect(sizing.maxWidth).toBe(220);
  });
});

describe('stripDeletedColumns*', () => {
  test('removes deleted keys from each row without mutating the input', () => {
    const rows = [{ a: 1, b: 2, c: 3 }];
    const result = stripDeletedColumnsFromRows(rows, ['b', 'c']);
    expect(result).toEqual([{ a: 1 }]);
    expect(rows[0]).toEqual({ a: 1, b: 2, c: 3 });
  });

  test('returns the same array instance when nothing is deleted', () => {
    const rows = [{ a: 1 }];
    const schema = cols('a');
    expect(stripDeletedColumnsFromRows(rows, [])).toBe(rows);
    expect(stripDeletedColumnsFromSchema(schema, [])).toBe(schema);
  });

  test('filters deleted columns out of the schema', () => {
    expect(stripDeletedColumnsFromSchema(cols('a', 'b', 'c'), ['b']).map((column) => column.column_name)).toEqual(['a', 'c']);
  });
});

describe('deriveSchemaFromRows', () => {
  test('infers column types from the first non-empty sample', () => {
    const rows = [
      { id: '', count: null, ratio: 1.5, flag: true, tags: ['a'] },
      { id: 'v1', count: 3 },
    ];
    expect(deriveSchemaFromRows(rows)).toEqual([
      { column_name: 'id', column_type: 'VARCHAR' },
      { column_name: 'count', column_type: 'BIGINT' },
      { column_name: 'ratio', column_type: 'DOUBLE' },
      { column_name: 'flag', column_type: 'BOOLEAN' },
      { column_name: 'tags', column_type: 'VARCHAR[]' },
    ]);
  });

  test('keeps previous schema entries first and unchanged', () => {
    const previous: ColumnSchema[] = [{ column_name: 'b', column_type: 'CUSTOM', display_column_name: 'B' }];
    const result = deriveSchemaFromRows([{ a: 1, b: 'x' }], previous);
    expect(result[0]).toBe(previous[0]);
    expect(result.map((column) => column.column_name)).toEqual(['b', 'a']);
  });

  test('columns with only empty values default to VARCHAR', () => {
    expect(deriveSchemaFromRows([{ x: null }, { x: '' }])).toEqual([{ column_name: 'x', column_type: 'VARCHAR' }]);
  });
});

describe('detectIncomingChannel*Column', () => {
  test('prefers explicit channel id and title columns', () => {
    const schema = cols('id', 'title', 'channelId', 'channelTitle');
    expect(detectIncomingChannelIdColumn(schema)).toBe('channelId');
    expect(detectIncomingChannelTitleColumn(schema)).toBe('channelTitle');
  });

  test('uses id/title for YouTube Data Tools channel exports', () => {
    expect(detectIncomingChannelIdColumn(channelsearchColumns)).toBe('id');
    expect(detectIncomingChannelTitleColumn(channelsearchColumns)).toBe('title');
  });

  test('does not treat a bare id/title as channel columns in other files', () => {
    expect(detectIncomingChannelIdColumn(cols('id', 'title'))).toBeNull();
    expect(detectIncomingChannelTitleColumn(cols('id', 'title'))).toBeNull();
  });

  test('falls back to fuzzy channel id/name columns', () => {
    expect(detectIncomingChannelIdColumn(cols('YT Channel Id'))).toBe('YT Channel Id');
    expect(detectIncomingChannelTitleColumn(cols('Creator Name'))).toBe('Creator Name');
  });

  test('detects the channel creation date column', () => {
    expect(detectIncomingChannelCreatedAtColumn(cols('publishedAt', 'channel_created_at'))).toBe('channel_created_at');
    expect(detectIncomingChannelCreatedAtColumn(cols('Channel Joined On'))).toBe('Channel Joined On');
    expect(detectIncomingChannelCreatedAtColumn(cols('foo'))).toBeNull();
  });
});

describe('detectImportKind', () => {
  test('a YouTube Data Tools channel search is channel metadata', () => {
    expect(detectImportKind(channelsearchColumns)).toBe('channelMetadata');
  });

  test('a video list is a video import', () => {
    expect(detectImportKind(videolistColumns)).toBe('video');
  });

  test('a channel file without video ids needs stats or a channel file name', () => {
    expect(detectImportKind(cols('channelId', 'channelTitle'))).toBe('video');
    expect(detectImportKind(cols('channelId', 'channelTitle'), 'my_channels.csv')).toBe('channelMetadata');
    expect(detectImportKind(cols('channelId', 'subscribers'))).toBe('channelMetadata');
  });

  test('files with a video id column stay video imports even with channel stats', () => {
    expect(detectImportKind(cols('videoId', 'channelId', 'subscriberCount'), 'channel.csv')).toBe('video');
  });
});

describe('detectSpecialMappings', () => {
  test('finds transcript, description, tags and the video id merge key', () => {
    expect(detectSpecialMappings(cols('Video_ID', 'Transcript', 'video_description', 'tags'))).toEqual({
      transcriptColumn: 'Transcript',
      descriptionColumn: 'video_description',
      tagColumn: 'tags',
      mergeKeyColumn: 'Video_ID',
    });
  });

  test('falls back to the first column as merge key and leaves others undefined', () => {
    expect(detectSpecialMappings(cols('foo', 'bar'))).toEqual({
      transcriptColumn: undefined,
      descriptionColumn: undefined,
      tagColumn: undefined,
      mergeKeyColumn: 'foo',
    });
  });
});

describe('resolveTagFilterColumn', () => {
  test('prefers known tag columns and never picks user tags', () => {
    expect(resolveTagFilterColumn(cols('Tags', 'videoTags'))).toBe('videoTags');
    expect(resolveTagFilterColumn(cols('user_tags', 'hashtag_list'))).toBe('hashtag_list');
    expect(resolveTagFilterColumn(cols('user_tags'))).toBeNull();
  });
});

describe('detectSuggestedMergeJoinColumns', () => {
  test('pairs video id aliases across schemas', () => {
    expect(detectSuggestedMergeJoinColumns(cols('title', 'videoId'), cols('video_id', 'x'))).toEqual({
      existingJoinColumn: 'videoId',
      incomingJoinColumn: 'video_id',
    });
  });

  test('falls back to normalized name equality, then to the first columns', () => {
    expect(detectSuggestedMergeJoinColumns(cols('Slug Key'), cols('slug_key'))).toEqual({
      existingJoinColumn: 'Slug Key',
      incomingJoinColumn: 'slug_key',
    });
    expect(detectSuggestedMergeJoinColumns(cols('a'), cols('b'))).toEqual({
      existingJoinColumn: 'a',
      incomingJoinColumn: 'b',
    });
    expect(detectSuggestedMergeJoinColumns([], [])).toEqual({ existingJoinColumn: '', incomingJoinColumn: '' });
  });
});
