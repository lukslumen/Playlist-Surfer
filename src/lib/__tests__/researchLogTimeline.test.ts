import { describe, expect, test } from 'vitest';
import type { ResearchHistoryEvent } from '../../types';
import { describeEvent, diaryToNotes, groupByDay, netTimeline, rawTimeline } from '../researchLogTimeline';

let clock = Date.UTC(2026, 10, 12, 9);
function event(type: ResearchHistoryEvent['type'], extra: Partial<ResearchHistoryEvent> = {}): ResearchHistoryEvent {
  clock += 60_000;
  return { id: `e${clock}`, type, createdAt: new Date(clock).toISOString(), summary: `${type} summary`, ...extra };
}

describe('netTimeline', () => {
  test('exclusions and restores cancel out per video', () => {
    const events = [
      event('videos_excluded', { affectedIds: ['a', 'b', 'c', 'd'], meta: { selectionMode: 'filtered_bulk', filterSummary: 'duration under 1 min' } }),
      event('videos_restored', { affectedIds: ['a'] }),
      event('videos_excluded', { affectedIds: ['x', 'y'], meta: { selectionMode: 'manual' } }),
      event('videos_restored', { affectedIds: ['x', 'y'] }),
    ];
    const entries = netTimeline(events);
    expect(entries.map((entry) => entry.title)).toEqual(['Excluded 3 videos matching: duration under 1 min']);
    expect(entries[0].videoIds).toEqual(['b', 'c', 'd']);
    expect(entries[0].mergedSteps).toBe(2);
  });

  test('restoring videos excluded before the log began is kept', () => {
    expect(netTimeline([event('videos_restored', { affectedIds: ['old'] })]).map((entry) => entry.title)).toEqual(['Restored 1 video to the corpus']);
  });

  test('undone events disappear; raw view keeps them marked', () => {
    const events = [event('videos_excluded', { affectedIds: ['a'], reverted: true, meta: { selectionMode: 'manual' } })];
    expect(netTimeline(events)).toEqual([]);
    expect(rawTimeline(events)[0].title).toBe('Excluded 1 video by hand (undone)');
  });

  test('a saved view created and then deleted leaves nothing; a kept one shows its filters', () => {
    const entries = netTimeline([
      event('saved_view_created', { meta: { viewId: 'v1', viewName: 'Draft' } }),
      event('saved_view_deleted', { meta: { viewId: 'v1', viewName: 'Draft' } }),
      event('saved_view_created', { meta: { viewId: 'v2', viewName: 'Cartels', filterSummary: 'tags: cartel', videoCount: 18 } }),
    ]);
    expect(entries.map((entry) => entry.title)).toEqual(['Saved view “Cartels”: tags: cartel (18 videos)']);
  });

  test('columns deleted then restored, and overrides reverted to automatic, leave nothing', () => {
    expect(netTimeline([
      event('column_deleted', { meta: { column: 'tags' } }),
      event('column_restored', { meta: { column: 'tags' } }),
      event('linking_bucket_override_created', { meta: { domain: 'a.com', newBaseBucket: 'marketplace' } }),
      event('linking_bucket_override_reverted', { meta: { domain: 'a.com' } }),
    ])).toEqual([]);
  });

  test('repeated generations collapse to the latest, counting the steps', () => {
    const entries = netTimeline([
      event('linking_summary_generated', { meta: { sourceColumn: 'videoUrl' } }),
      event('linking_summary_refreshed', { meta: { sourceColumn: 'videoDescription' } }),
      event('linking_bucket_override_created', { meta: { domain: 'b.com', newBaseBucket: 'routing' } }),
      event('linking_bucket_override_changed', { meta: { domain: 'b.com', newBaseBucket: 'other' } }),
    ]);
    expect(entries.map((entry) => entry.title)).toEqual(['Generated the link summary from “videoDescription”', 'Moved b.com to the “other” bucket']);
    expect(entries.map((entry) => entry.mergedSteps)).toEqual([2, 2]);
  });

  test('source visibility toggled back and forth leaves nothing', () => {
    expect(netTimeline([
      event('source_visibility_toggled', { meta: { sourceId: 's1' } }),
      event('source_visibility_toggled', { meta: { sourceId: 's1' } }),
    ])).toEqual([]);
  });

  test('notes are never lost: carried to the surviving entry, or kept on their own', () => {
    const entries = netTimeline([
      event('linking_summary_generated', { meta: { sourceColumn: 'a' }, note: 'first try' }),
      event('linking_summary_refreshed', { meta: { sourceColumn: 'b' } }),
      event('videos_excluded', { affectedIds: ['x'], meta: { selectionMode: 'manual' }, note: 'off topic' }),
      event('videos_restored', { affectedIds: ['x'] }),
      event('note', { note: 'Comparing Shorts next.' }),
    ]);
    expect(entries.map((entry) => [entry.category, entry.note])).toEqual([
      ['analysis', 'first try'],
      ['note', 'off topic'],
      ['note', 'Comparing Shorts next.'],
    ]);
  });
});

test('describeEvent falls back to the stored summary without a trailing period', () => {
  expect(describeEvent(event('import_replace_completed', { summary: 'Imported 61 rows from a.csv.' }))).toBe('Imported 61 rows from a.csv');
});

test('groupByDay labels today and yesterday, newest first', () => {
  const now = new Date(2026, 10, 12, 18);
  const at = (day: number, hour: number) => ({ id: `${day}-${hour}`, category: 'note' as const, createdAt: new Date(2026, 10, day, hour).toISOString(), title: '', details: [], videoIds: [], eventIds: [], mergedSteps: 1 });
  const groups = groupByDay([at(12, 9), at(11, 9), at(12, 14), at(3, 9)], now);
  expect(groups.map((group) => group.label)).toEqual(['Today', 'Yesterday', 'Tue, Nov 3, 2026']);
  expect(groups[0].entries.map((entry) => entry.id)).toEqual(['12-14', '12-9']);
});

test('diaryToNotes turns dated headings into entries and keeps undated text', () => {
  const notes = diaryToNotes('# Research Diary\n\n## November 10, 2026\nStarted the corpus.\n\n## Ideas\nCompare Shorts.', '2026-11-12T00:00:00.000Z');
  expect(notes).toEqual([
    { createdAt: new Date(Date.parse('November 10, 2026') + 12 * 3600_000).toISOString(), note: 'Started the corpus.' },
    { createdAt: '2026-11-12T00:00:00.000Z', note: 'Ideas\nCompare Shorts.' },
  ]);
});

import { coveredSeconds, mergeRanges, playbackRange } from '../watchCoverage';

describe('watch coverage', () => {
  test('replayed parts count once', () => {
    expect(mergeRanges([[10, 20], [0, 5], [15, 30], [30.2, 31]])).toEqual([[0, 5], [10, 31]]);
    expect(coveredSeconds([[0, 60], [30, 90], [0, 60]])).toBe(90);
    expect(coveredSeconds(undefined)).toBe(0);
  });

  test('a seek during playback only counts the time actually played', () => {
    expect(playbackRange(10, 40, 30)).toEqual([10, 40]);
    expect(playbackRange(10, 600, 20)).toEqual([10, 30]);
    expect(playbackRange(40, 10, 5)).toBeNull();
  });
});

describe('hidden vernacular terms', () => {
  test('several edits show as one net change', () => {
    const entries = netTimeline([
      event('vernacular_terms_changed', { meta: { previousTerms: '', hiddenTerms: 'lol' } }),
      event('vernacular_terms_changed', { meta: { previousTerms: 'lol', hiddenTerms: 'lol\nsubscribe' } }),
      event('vernacular_terms_changed', { meta: { previousTerms: 'lol\nsubscribe', hiddenTerms: 'subscribe' } }),
    ]);
    expect(entries.map((entry) => entry.title)).toEqual(['Vernacular analysis: hid subscribe']);
    expect(entries[0].mergedSteps).toBe(3);
  });

  test('edits that end where they started leave nothing', () => {
    expect(netTimeline([
      event('vernacular_terms_changed', { meta: { previousTerms: 'a', hiddenTerms: 'a\nb' } }),
      event('vernacular_terms_changed', { meta: { previousTerms: 'a\nb', hiddenTerms: 'a' } }),
    ])).toEqual([]);
  });
});
