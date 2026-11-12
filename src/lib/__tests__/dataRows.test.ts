import { describe, expect, test } from 'vitest';
import type { ColumnSchema } from '../../types';
import {
  USER_TAGS_COLUMN,
  buildBatchCopyClipboardPayload,
  buildDisplayRows,
  buildDisplaySchema,
  buildGeneratedMetadataSchema,
  collectVideoIds,
  convertRowsToCsv,
  overlayGeneratedMetadataRows,
  partitionRowsByInclusion,
  resolveChannelId,
  resolveChannelName,
  resolvePublishedAt,
  resolveTranscript,
  resolveVideoDescription,
  resolveVideoId,
  resolveVideoTags,
  resolveVideoTitle,
  resolveViews,
  splitRowsByInclusion,
  valueIsEmpty,
  valuesMatch,
} from '../data';

describe('resolveVideoId', () => {
  test('checks the known id fields in priority order', () => {
    expect(resolveVideoId({ videoId: 'a', video_id: 'b', id: 'c' })).toBe('a');
    expect(resolveVideoId({ video_id: 'b', id: 'c' })).toBe('b');
    expect(resolveVideoId({ id: 'c' })).toBe('c');
    expect(resolveVideoId({ Video_ID: 'd' })).toBe('d');
    expect(resolveVideoId({ videoID: 'e' })).toBe('e');
  });

  test('stringifies numeric ids and returns null for missing rows or ids', () => {
    expect(resolveVideoId({ videoId: 42 })).toBe('42');
    expect(resolveVideoId(null)).toBeNull();
    expect(resolveVideoId({ videoId: '' })).toBeNull();
    expect(resolveVideoId({ title: 'no id' })).toBeNull();
  });
});

describe('resolveVideoTitle / resolveChannelName / resolveChannelId', () => {
  test('video title falls back through aliases to a placeholder', () => {
    expect(resolveVideoTitle({ videoTitle: 'A', title: 'B' })).toBe('A');
    expect(resolveVideoTitle({ video_title: 'C' })).toBe('C');
    expect(resolveVideoTitle({})).toBe('Untitled Video');
    expect(resolveVideoTitle(undefined)).toBe('Untitled Video');
  });

  test('channel name prefers channel_name, trims, and falls back to Unknown channel', () => {
    expect(resolveChannelName({ channel_name: '  Canon  ', channelTitle: 'Other' })).toBe('Canon');
    expect(resolveChannelName({ channelTitle: 'Ch' })).toBe('Ch');
    expect(resolveChannelName({ creator: 'Maker' })).toBe('Maker');
    expect(resolveChannelName({ channel_name: '   ' })).toBe('Unknown channel');
    expect(resolveChannelName(null)).toBe('Unknown channel');
  });

  test('channel id checks aliases including spaced headers and trims values', () => {
    expect(resolveChannelId({ channel_id: ' UC1 ' })).toBe('UC1');
    expect(resolveChannelId({ channelId: 'UC2' })).toBe('UC2');
    expect(resolveChannelId({ 'Channel ID': 'UC3' })).toBe('UC3');
    expect(resolveChannelId({ creatorId: 'UC4' })).toBe('UC4');
  });

  test('channel id falls back to the generic id field (legacy mode)', () => {
    expect(resolveChannelId({ id: 'legacy' })).toBe('legacy');
    expect(resolveChannelId({ channel_id: '', id: 'x' })).toBeNull();
    expect(resolveChannelId({ channel_id: '   ' })).toBeNull();
    expect(resolveChannelId({})).toBeNull();
  });
});

describe('other row resolvers', () => {
  test('published-at and views use their aliases with defaults', () => {
    expect(resolvePublishedAt({ published_at: '2024-01-01' })).toBe('2024-01-01');
    expect(resolvePublishedAt({ publishedAtSQL: '2024-02-02' })).toBe('2024-02-02');
    expect(resolvePublishedAt({})).toBeNull();
    expect(resolveViews({ view_count: 12 })).toBe(12);
    expect(resolveViews({})).toBe(0);
  });

  test('transcript override wins over row transcript and text', () => {
    expect(resolveTranscript({ transcript: 'row', text: 'alt' })).toBe('row');
    expect(resolveTranscript({ text: 'alt' })).toBe('alt');
    expect(resolveTranscript({ transcript: 'row' }, { transcriptOverride: 'override' } as any)).toBe('override');
    expect(resolveTranscript({})).toBe('');
  });

  test('video description resolves aliases and stringifies', () => {
    expect(resolveVideoDescription({ videoDescription: 'main', description: 'x' })).toBe('main');
    expect(resolveVideoDescription({ description: 5 })).toBe('5');
    expect(resolveVideoDescription({})).toBe('');
  });

  test('video tags parse arrays, JSON-like strings and delimited strings', () => {
    expect(resolveVideoTags({ tags: ['a', ' b ', ''] })).toEqual(['a', 'b']);
    expect(resolveVideoTags({ tags: '["x", "y"]' })).toEqual(['x', 'y']);
    expect(resolveVideoTags({ tags: "['x', 'y']" })).toEqual(['x', 'y']);
    expect(resolveVideoTags({ tags: 'a|b, c; d' })).toEqual(['a', 'b', 'c', 'd']);
    expect(resolveVideoTags({ tags: '[]' })).toEqual([]);
    expect(resolveVideoTags({})).toEqual([]);
  });
});

describe('valueIsEmpty / valuesMatch', () => {
  test('only null, undefined and empty string are empty', () => {
    expect([null, undefined, ''].every(valueIsEmpty)).toBe(true);
    expect([0, false, ' ', []].some(valueIsEmpty)).toBe(false);
  });

  test('compares scalars by trimmed string value', () => {
    expect(valuesMatch(1, '1')).toBe(true);
    expect(valuesMatch(' a ', 'a')).toBe(true);
    expect(valuesMatch(null, '')).toBe(true);
    expect(valuesMatch('a', 'b')).toBe(false);
  });

  test('compares a list against its serialized form', () => {
    expect(valuesMatch(['a', 'b'], 'a|b')).toBe(true);
    expect(valuesMatch(['a', 'b'], '["a","b"]')).toBe(true);
    expect(valuesMatch(['a', 'b'], ['b', 'a'])).toBe(false);
  });
});

describe('collectVideoIds', () => {
  test('dedupes ids in first-seen order and skips rows without one', () => {
    expect(collectVideoIds([{ videoId: 'b' }, { videoId: 'a' }, { title: 'x' }, { video_id: 'b' }])).toEqual(['b', 'a']);
  });
});

describe('splitRowsByInclusion / partitionRowsByInclusion', () => {
  const rows = [{ videoId: 'a' }, { videoId: 'b' }, { title: 'no id' }];
  const excluded = new Set(['b']);

  test('included view keeps non-excluded rows and rows without an id', () => {
    expect(splitRowsByInclusion(rows, excluded, 'included')).toEqual([{ videoId: 'a' }, { title: 'no id' }]);
  });

  test('excluded view shows only excluded rows', () => {
    expect(splitRowsByInclusion(rows, excluded, 'excluded')).toEqual([{ videoId: 'b' }]);
  });

  test('partition puts every row in exactly one bucket', () => {
    const { included, excluded: out } = partitionRowsByInclusion(rows, excluded);
    expect(included).toEqual([{ videoId: 'a' }, { title: 'no id' }]);
    expect(out).toEqual([{ videoId: 'b' }]);
    expect(included.length + out.length).toBe(rows.length);
  });
});

describe('buildBatchCopyClipboardPayload', () => {
  test('builds deduped video URLs joined by commas', () => {
    const payload = buildBatchCopyClipboardPayload([{ videoId: 'a' }, { videoId: 'a' }, { videoId: 'b' }], 'videoUrls');
    expect(payload).toEqual({
      mode: 'videoUrls',
      values: ['https://www.youtube.com/watch?v=a', 'https://www.youtube.com/watch?v=b'],
      text: 'https://www.youtube.com/watch?v=a,https://www.youtube.com/watch?v=b',
    });
  });

  test('channel modes do not fall back to the generic id field', () => {
    const rows = [{ id: 'videoish' }, { channelId: 'UC1' }];
    expect(buildBatchCopyClipboardPayload(rows, 'channelIds').values).toEqual(['UC1']);
    expect(buildBatchCopyClipboardPayload(rows, 'channelUrls').values).toEqual(['https://www.youtube.com/channel/UC1']);
  });

  test('returns an empty payload when nothing resolves', () => {
    expect(buildBatchCopyClipboardPayload([{ title: 'x' }], 'videoIds')).toEqual({ mode: 'videoIds', values: [], text: '' });
  });
});

describe('buildDisplaySchema / buildDisplayRows', () => {
  const schema: ColumnSchema[] = [{ column_name: 'videoId', column_type: 'VARCHAR' }];

  test('appends a user tags column only when some video has tags', () => {
    expect(buildDisplaySchema(schema, {})).toBe(schema);
    expect(buildDisplaySchema(schema, { a: [] })).toBe(schema);
    const result = buildDisplaySchema(schema, { a: ['t'] });
    expect(result.at(-1)).toMatchObject({ column_name: USER_TAGS_COLUMN, column_type: 'VARCHAR[]', display_column_name: 'User Tags' });
  });

  test('does not duplicate an existing user tags column', () => {
    const withTags = [...schema, { column_name: USER_TAGS_COLUMN, column_type: 'VARCHAR[]' }];
    expect(buildDisplaySchema(withTags, { a: ['t'] })).toBe(withTags);
  });

  test('adds user tags to matching rows and leaves others untouched', () => {
    const rows = [{ videoId: 'a' }, { videoId: 'b' }, { title: 'x' }];
    const result = buildDisplayRows(rows, { a: ['t1', 't2'], b: [] });
    expect(result[0]).toEqual({ videoId: 'a', user_tags: ['t1', 't2'] });
    expect(result[1]).toBe(rows[1]);
    expect(result[2]).toBe(rows[2]);
    expect(rows[0]).toEqual({ videoId: 'a' });
  });

  test('returns the base array when there are no user tags', () => {
    const rows = [{ videoId: 'a' }];
    expect(buildDisplayRows(rows, {})).toBe(rows);
  });
});

describe('overlayGeneratedMetadataRows / buildGeneratedMetadataSchema', () => {
  test('overlays generated fields onto rows by video id, overriding base values', () => {
    const rows = [{ videoId: 'a', topic: 'old' }, { videoId: 'b' }, { title: 'no id' }];
    const result = overlayGeneratedMetadataRows(rows, { a: { topic: 'new', score: 2 } });
    expect(result[0]).toEqual({ videoId: 'a', topic: 'new', score: 2 });
    expect(result[1]).toBe(rows[1]);
    expect(result[2]).toBe(rows[2]);
  });

  test('returns base rows unchanged without generated metadata', () => {
    const rows = [{ videoId: 'a' }];
    expect(overlayGeneratedMetadataRows(rows, {})).toBe(rows);
  });

  test('derives a schema with inferred types and title-cased display names', () => {
    expect(buildGeneratedMetadataSchema({ a: { main_topic: 'x', scoreValue: 1.5, count: 2, flag: true, labels: [] } })).toEqual([
      { column_name: 'main_topic', column_type: 'VARCHAR', source_column_name: 'main_topic', display_column_name: 'Main Topic' },
      { column_name: 'scoreValue', column_type: 'DOUBLE', source_column_name: 'scoreValue', display_column_name: 'Score Value' },
      { column_name: 'count', column_type: 'BIGINT', source_column_name: 'count', display_column_name: 'Count' },
      { column_name: 'flag', column_type: 'BOOLEAN', source_column_name: 'flag', display_column_name: 'Flag' },
      { column_name: 'labels', column_type: 'VARCHAR[]', source_column_name: 'labels', display_column_name: 'Labels' },
    ]);
    expect(buildGeneratedMetadataSchema({})).toEqual([]);
  });
});

describe('convertRowsToCsv', () => {
  test('quotes header names, so names with commas or quotes stay one column', () => {
    expect(convertRowsToCsv([{ 'a,b': 1, 'say "x"': 2 }], ['a,b', 'say "x"'])).toBe('"a,b","say ""x"""\n"1","2"');
  });

  test('writes a header line and quotes every value', () => {
    expect(convertRowsToCsv([{ a: 1, b: 'x' }], ['a', 'b'])).toBe('"a","b"\n"1","x"');
  });

  test('escapes embedded quotes by doubling them and keeps commas and newlines inside quotes', () => {
    const csv = convertRowsToCsv([{ text: 'He said "hi", then\nleft' }], ['text']);
    expect(csv).toBe('"text"\n"He said ""hi"", then\nleft"');
  });

  test('joins arrays with a pipe and writes empty strings for missing values', () => {
    expect(convertRowsToCsv([{ tags: ['a', 'b'], n: null }], ['tags', 'n', 'missing'])).toBe('"tags","n","missing"\n"a|b","",""');
  });

  test('keeps falsy but present values such as 0 and false', () => {
    expect(convertRowsToCsv([{ a: 0, b: false }], ['a', 'b'])).toBe('"a","b"\n"0","false"');
  });

  test('outputs only the header for no rows and follows column order', () => {
    expect(convertRowsToCsv([], ['b', 'a'])).toBe('"b","a"');
    expect(convertRowsToCsv([{ a: 1, b: 2 }], ['b', 'a'])).toBe('"b","a"\n"2","1"');
  });
});
