import { describe, expect, test } from 'vitest';
import {
  applyThumbnailEntryFailed,
  applyThumbnailEntryLoaded,
  normalizeRestoredThumbnailCaches,
  resetFailedThumbnailEntries,
} from '../thumbnailCache';
import type { DashboardThumbnailCacheEntry, DashboardThumbnailCacheSnapshot } from '../../types';

const entry = (overrides: Partial<DashboardThumbnailCacheEntry> = {}): DashboardThumbnailCacheEntry => ({
  videoId: 'v1',
  dedupeKey: 'v1',
  title: 'Video',
  rank: 1,
  sourceUrl: 'https://img/maxres.jpg',
  activeUrl: 'https://img/maxres.jpg',
  candidateUrls: ['https://img/maxres.jpg', 'https://img/hq.jpg'],
  fallbackIndex: 0,
  activeCandidateIndex: 0,
  status: 'pending',
  ...overrides,
} as DashboardThumbnailCacheEntry);

describe('thumbnail entry transitions', () => {
  test('a failed candidate falls back to the next URL, then fails for good', () => {
    const first = applyThumbnailEntryFailed(entry(), 0, 'https://img/maxres.jpg');
    expect(first).toMatchObject({ status: 'pending', activeUrl: 'https://img/hq.jpg', activeCandidateIndex: 1 });
    const second = applyThumbnailEntryFailed(first, 1, 'https://img/hq.jpg');
    expect(second).toMatchObject({ status: 'failed', activeUrl: '', activeCandidateIndex: 1 });
    expect(applyThumbnailEntryFailed(second, 1)).toBe(second);
  });

  test('reports from a candidate that is no longer active are ignored', () => {
    const onSecond = entry({ activeCandidateIndex: 1, activeUrl: 'https://img/hq.jpg' });
    expect(applyThumbnailEntryFailed(onSecond, 0, 'https://img/maxres.jpg')).toBe(onSecond);
    expect(applyThumbnailEntryLoaded(onSecond, 0, 'https://img/maxres.jpg')).toBe(onSecond);
  });

  test('a loaded candidate is recorded once', () => {
    const loaded = applyThumbnailEntryLoaded(entry(), 0, 'https://img/maxres.jpg');
    expect(loaded).toMatchObject({ status: 'loaded', activeUrl: 'https://img/maxres.jpg' });
    expect(applyThumbnailEntryLoaded(loaded, 0, 'https://img/maxres.jpg')).toBe(loaded);
  });

  test('an entry without any URL fails immediately', () => {
    const none = entry({ sourceUrl: '', activeUrl: '', candidateUrls: [] });
    expect(applyThumbnailEntryFailed(none, 0)).toMatchObject({ status: 'failed', activeCandidateIndex: -1 });
  });

  test('retry resets failed entries to their first candidate', () => {
    const failed = entry({ status: 'failed', activeUrl: '', activeCandidateIndex: 1, fallbackIndex: 1 });
    const reset = resetFailedThumbnailEntries([failed, entry({ status: 'loaded' })])!;
    expect(reset[0]).toMatchObject({ status: 'pending', activeUrl: 'https://img/maxres.jpg', activeCandidateIndex: 0 });
    expect(reset[1].status).toBe('loaded');
    expect(resetFailedThumbnailEntries([entry({ status: 'loaded' })])).toBeNull();
  });
});

test('normalizeRestoredThumbnailCaches assigns session ids and versions', () => {
  const snapshot = { scopeKey: 'full', label: 'Full', entries: [entry({ activeCandidateIndex: undefined as unknown as number, fallbackIndex: 1 })] } as unknown as DashboardThumbnailCacheSnapshot;
  const { caches, maxSessionId } = normalizeRestoredThumbnailCaches({ full: snapshot }, { sessionStart: 10, datasetVersion: 3, filteredViewVersion: 4 });
  expect(caches.full.sessionId).toBe(11);
  expect(caches.full.datasetVersionAtCalculation).toBe(3);
  expect(caches.full.entries[0].activeCandidateIndex).toBe(1);
  expect(maxSessionId).toBe(11);
});
