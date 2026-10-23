import { describe, expect, test } from 'vitest';
import {
  addTagToChannels,
  appendChannelNotes,
  attachChannelLinking,
  attachChannelUserTags,
  isChannelMetadataSnapshotFresh,
  removeTagFromChannels,
  replaceChannelTags,
  scopeChannelRowsToVideos,
  setChannelNote,
  videoRowChannelKey,
} from '../channelMetadata';
import type { ChannelMetadataRow, ChannelMetadataSnapshot } from '../../types';

const channelRow = (id: string, name: string) => ({ channel_key: `id:${id}`, channel_id: id, channel_name: name } as unknown as ChannelMetadataRow);

describe('channel rows', () => {
  test('videoRowChannelKey prefers the channel id', () => {
    expect(videoRowChannelKey({ channelId: 'UC1', channelTitle: 'One' })).toBe('id:UC1');
    expect(videoRowChannelKey({ channelTitle: 'Only Name' })).toBe('name:only name');
  });

  test('scopeChannelRowsToVideos keeps cached rows for visible channels only', () => {
    const cached = [channelRow('UC1', 'One'), channelRow('UC2', 'Two')];
    const scoped = scopeChannelRowsToVideos(cached, [{ videoId: 'v', channelId: 'UC2', channelTitle: 'Two' }], null);
    expect(scoped.map((row) => row.channel_key)).toEqual(['id:UC2']);
    expect(scopeChannelRowsToVideos(cached, [], null)).toEqual([]);
  });

  test('channels missing from the snapshot get rows built from their videos', () => {
    const scoped = scopeChannelRowsToVideos([channelRow('UC1', 'One')], [
      { videoId: 'a', channelId: 'UC1', channelTitle: 'One' },
      { videoId: 'b', channelId: 'UC9', channelTitle: 'New' },
    ], null);
    expect(scoped.map((row) => row.channel_key)).toEqual(['id:UC1', 'id:UC9']);
  });

  test('tags and link aggregates are attached when present', () => {
    const rows = [channelRow('UC1', 'One')];
    expect(attachChannelUserTags(rows, {})).toBe(rows);
    expect(attachChannelUserTags(rows, { 'id:UC1': ['news'] })[0]).toMatchObject({ channel_key: 'id:UC1' });
    const linked = attachChannelLinking(rows, { stale: false, snapshot: { byChannelKey: { 'id:UC1': { linking_top_domains: ['x.com'] } } } } as never);
    expect(linked[0]).toMatchObject({ linking_top_domains: ['x.com'] });
    expect(attachChannelLinking(rows, { stale: true, snapshot: { byChannelKey: { 'id:UC1': {} } } } as never)).toBe(rows);
  });

  test('snapshot freshness uses the cache key when the snapshot has one', () => {
    const snapshot = { cacheKeyAtCalculation: 'k1', datasetVersionAtCalculation: 1, inclusionViewAtCalculation: 'included' } as ChannelMetadataSnapshot;
    expect(isChannelMetadataSnapshotFresh(snapshot, { cacheKey: 'k1', datasetVersion: 9, inclusionView: 'excluded' })).toBe(true);
    expect(isChannelMetadataSnapshotFresh(snapshot, { cacheKey: 'k2', datasetVersion: 1, inclusionView: 'included' })).toBe(false);
    const legacy = { datasetVersionAtCalculation: 1, inclusionViewAtCalculation: 'included' } as ChannelMetadataSnapshot;
    expect(isChannelMetadataSnapshotFresh(legacy, { cacheKey: 'x', datasetVersion: 1, inclusionView: 'included' })).toBe(true);
    expect(isChannelMetadataSnapshotFresh(null, { cacheKey: 'x', datasetVersion: 1, inclusionView: 'included' })).toBe(false);
  });
});

describe('channel notes and tags', () => {
  test('notes are set, cleared, and appended as blocks', () => {
    const notes = setChannelNote({}, 'id:UC1', 'first');
    expect(notes).toEqual({ 'id:UC1': 'first' });
    expect(setChannelNote(notes, 'id:UC1', 'first')).toBe(notes);
    expect(setChannelNote(notes, 'id:UC1', '   ')).toEqual({});
    expect(appendChannelNotes(notes, ['id:UC1', 'id:UC2'], 'batch')['id:UC2']).toContain('batch');
  });

  test('tags are deduplicated, added and removed per channel', () => {
    const tags = replaceChannelTags({}, 'id:UC1', ['a', 'a', ' b ']);
    expect(tags).toEqual({ 'id:UC1': ['a', 'b'] });
    expect(replaceChannelTags(tags, 'id:UC1', ['a', 'b'])).toBe(tags);
    const added = addTagToChannels(tags, ['id:UC1', 'id:UC2'], 'c');
    expect(added).toEqual({ 'id:UC1': ['a', 'b', 'c'], 'id:UC2': ['c'] });
    expect(removeTagFromChannels(added, ['id:UC2'], 'c')).toEqual({ 'id:UC1': ['a', 'b', 'c'] });
  });
});
