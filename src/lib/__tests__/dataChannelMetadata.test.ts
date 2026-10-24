import { describe, expect, test } from 'vitest';
import type { ColumnSchema } from '../../types';
import {
  buildChannelLookupKey,
  buildChannelMetadataRows,
  buildImportedChannelMetadataState,
  mergeChannelMetadataRows,
  normalizeChannelTitle,
} from '../data';

function cols(...names: string[]): ColumnSchema[] {
  return names.map((column_name) => ({ column_name, column_type: 'VARCHAR' }));
}

const videoRows = [
  { videoId: 'v1', channelId: 'UC1', channelTitle: 'Alpha', viewCount: '100', likeCount: '1,000', publishedAt: '2024-01-10T00:00:00Z' },
  { videoId: 'v2', channelId: 'UC1', channelTitle: 'Alpha', viewCount: 50, publishedAt: '2023-05-01T00:00:00Z' },
  { videoId: 'v3', channelTitle: 'Beta', viewCount: 500, commentCount: 7 },
];

describe('normalizeChannelTitle / buildChannelLookupKey', () => {
  test('normalizes case and whitespace for name keys', () => {
    expect(normalizeChannelTitle('  The   Channel ')).toBe('the channel');
    expect(buildChannelLookupKey('  The Channel', 'normalizedChannelTitle')).toBe('name:the channel');
  });

  test('builds trimmed id keys and returns null for blanks', () => {
    expect(buildChannelLookupKey(' UC1 ', 'channelId')).toBe('id:UC1');
    expect(buildChannelLookupKey('', 'channelId')).toBeNull();
    expect(buildChannelLookupKey(null, 'normalizedChannelTitle')).toBeNull();
  });
});

describe('buildChannelMetadataRows', () => {
  const rows = buildChannelMetadataRows(videoRows);

  test('aggregates videos per channel id, falling back to name keys', () => {
    expect(rows.map((row) => row.channel_key)).toEqual(['id:UC1', 'name:beta']);
    expect(rows[0]).toMatchObject({ channel_name: 'Alpha', channel_id: 'UC1', video_count_in_dataset: 2, total_views_in_dataset: 150 });
  });

  test('sums likes with thousands separators and keeps null when no row has a value', () => {
    expect(rows[0].total_likes_in_dataset).toBe(1000);
    expect(rows[0].total_comments_in_dataset).toBeNull();
    expect(rows[1].total_comments_in_dataset).toBe(7);
    expect(rows[1].total_likes_in_dataset).toBeNull();
  });

  test('tracks the earliest and latest publish date per channel', () => {
    expect(rows[0].earliest_publish_date).toBe('2023-05-01T00:00:00.000Z');
    expect(rows[0].latest_publish_date).toBe('2024-01-10T00:00:00.000Z');
    expect(rows[1].earliest_publish_date).toBeNull();
  });

  test('sorts by video count, then views, then name', () => {
    const sorted = buildChannelMetadataRows([
      { channelTitle: 'Zed', viewCount: 10 },
      { channelTitle: 'Amy', viewCount: 10 },
      { channelTitle: 'Big', viewCount: 99 },
    ]);
    expect(sorted.map((row) => row.channel_name)).toEqual(['Big', 'Amy', 'Zed']);
  });

  test('adds title/channelTitle/id aliases only when imported metadata is merged in', () => {
    expect(rows[0]).not.toHaveProperty('title');
    const withImport = buildChannelMetadataRows(videoRows, { byKey: { 'id:UC1': { channel_country: 'DE' } }, columns: [], imports: [] });
    expect(withImport[0]).toMatchObject({ title: 'Alpha', channelTitle: 'Alpha', id: 'UC1', channelId: 'UC1', channel_country: 'DE' });
    expect(withImport[1]).toMatchObject({ title: 'Beta', channelTitle: 'Beta', channel_id: null });
  });
});

describe('mergeChannelMetadataRows', () => {
  test('returns rows unchanged without imported data', () => {
    const rows = buildChannelMetadataRows(videoRows);
    expect(mergeChannelMetadataRows(rows, null)).toBe(rows);
    expect(mergeChannelMetadataRows(rows, { byKey: {}, columns: [], imports: [] })).toBe(rows);
  });

  test('fills missing fields from imported data by id or name without overwriting present values', () => {
    const merged = mergeChannelMetadataRows(
      [{ channel_key: 'id:UC1', channel_name: 'Alpha', channel_id: 'UC1', video_count_in_dataset: 2 } as any],
      {
        byKey: {
          'id:UC1': { channel_subscriber_count: '5000', video_count_in_dataset: 999 },
          'name:alpha': { channel_country: 'DE' },
        },
        columns: [],
        imports: [],
      },
    );
    expect(merged[0]).toMatchObject({
      channel_subscriber_count: '5000',
      channel_country: 'DE',
      video_count_in_dataset: 2,
    });
  });
});

describe('buildImportedChannelMetadataState', () => {
  const incomingSchema = cols('channelId', 'channelTitle', 'subscriberCount', 'videoCount', 'country', 'thumbnail', 'publishedAt');
  const incomingRows = [
    { channelId: 'UC1', channelTitle: '', subscriberCount: '5000', videoCount: '12', country: 'DE', thumbnail: '//yt3.example.com/a.jpg', publishedAt: '2010-01-01' },
    { channelId: 'UC404', channelTitle: 'Stranger', subscriberCount: '1' },
  ];

  test('stores normalized rows for known channels and skips unknown ones', () => {
    const result = buildImportedChannelMetadataState({
      existingVideoRows: videoRows,
      incomingRows,
      incomingSchema,
      relationshipType: 'channelId',
      sourceFileName: 'channels.csv',
    });
    expect(result.updatedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.relationshipColumn).toBe('channelId');
    expect(Object.keys(result.state.byKey)).toEqual(['id:UC1']);
    expect(result.state.byKey['id:UC1']).toMatchObject({
      channel_name: 'Alpha',
      channel_id: 'UC1',
      channelTitle: 'Alpha',
      channel_subscriber_count: '5000',
      channel_video_count: '12',
      channel_country: 'DE',
      channel_created_at: '2010-01-01',
      channel_thumbnail_url: 'https://yt3.example.com/a.jpg',
    });
    expect(result.state.imports).toHaveLength(1);
    expect(result.state.imports[0]).toMatchObject({ sourceFileName: 'channels.csv', incomingRowCount: 2, updatedCount: 1, skippedCount: 1 });
    expect(result.state.columns).toEqual(expect.arrayContaining(['channelId', 'channel_subscriber_count', 'channel_thumbnail_url']));
  });

  test('can match by normalized channel title', () => {
    const result = buildImportedChannelMetadataState({
      existingVideoRows: videoRows,
      incomingRows: [{ channelTitle: '  BETA ', subscriberCount: '3' }],
      incomingSchema: cols('channelTitle', 'subscriberCount'),
      relationshipType: 'normalizedChannelTitle',
      sourceFileName: 'names.csv',
    });
    expect(result.updatedCount).toBe(1);
    expect(result.state.byKey['name:beta']).toMatchObject({ channel_name: 'BETA', channel_subscriber_count: '3' });
  });

  test('accumulates on top of previous state and audit history', () => {
    const first = buildImportedChannelMetadataState({
      existingVideoRows: videoRows,
      incomingRows: [{ channelId: 'UC1', country: 'DE' }],
      incomingSchema: cols('channelId', 'country'),
      relationshipType: 'channelId',
      sourceFileName: 'a.csv',
    });
    const second = buildImportedChannelMetadataState({
      existingVideoRows: videoRows,
      incomingRows: [{ channelId: 'UC1', subscriberCount: '9' }],
      incomingSchema: cols('channelId', 'subscriberCount'),
      relationshipType: 'channelId',
      sourceFileName: 'b.csv',
      previousState: first.state,
    });
    expect(second.state.byKey['id:UC1']).toMatchObject({ country: 'DE', channel_subscriber_count: '9' });
    expect(second.state.imports.map((entry) => entry.sourceFileName)).toEqual(['a.csv', 'b.csv']);
  });

  test('throws when the file has no relationship column', () => {
    expect(() => buildImportedChannelMetadataState({
      existingVideoRows: videoRows,
      incomingRows: [{ foo: 1 }],
      incomingSchema: cols('foo'),
      relationshipType: 'channelId',
      sourceFileName: 'x.csv',
    })).toThrow(/relationship column/);
  });

  test('imported state merges into channel rows end to end', () => {
    const { state } = buildImportedChannelMetadataState({
      existingVideoRows: videoRows,
      incomingRows,
      incomingSchema,
      relationshipType: 'channelId',
      sourceFileName: 'channels.csv',
    });
    const rows = buildChannelMetadataRows(videoRows, state);
    expect(rows[0]).toMatchObject({ channel_id: 'UC1', channel_subscriber_count: '5000', video_count_in_dataset: 2 });
    expect(rows[1].channel_subscriber_count).toBeUndefined();
  });
});
