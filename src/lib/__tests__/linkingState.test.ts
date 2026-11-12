import { describe, expect, test } from 'vitest';
import {
  LINKING_DATASET_CHANGED,
  linkingParseCacheKey,
  markStaleForDataset,
  nextChannelLinkingState,
  writeLinkingIntoGeneratedMetadata,
} from '../linkingState';
import type { ChannelLinkingState } from '../../types';

describe('markStaleForDataset', () => {
  const fresh: ChannelLinkingState = { stale: false, snapshot: { generatedAt: 'x', datasetFingerprint: 'fp1', rowUniverseCount: 1, byChannelKey: {} } };

  test('leaves the state alone while the dataset is unchanged or there is no snapshot', () => {
    expect(markStaleForDataset(fresh, 'fp1', LINKING_DATASET_CHANGED)).toBe(fresh);
    const empty: ChannelLinkingState = { stale: false, snapshot: null };
    expect(markStaleForDataset(empty, 'fp2', LINKING_DATASET_CHANGED)).toBe(empty);
  });

  test('marks stale once when the dataset changed', () => {
    const stale = markStaleForDataset(fresh, 'fp2', LINKING_DATASET_CHANGED);
    expect(stale).toMatchObject({ stale: true, staleReason: LINKING_DATASET_CHANGED });
    expect(markStaleForDataset(stale, 'fp3', LINKING_DATASET_CHANGED)).toBe(stale);
    expect(markStaleForDataset({ ...fresh, stale: true, staleReason: 'other' }, 'fp2', LINKING_DATASET_CHANGED).staleReason).toBe(LINKING_DATASET_CHANGED);
  });
});

test('writeLinkingIntoGeneratedMetadata keeps content intent and replaces linking', () => {
  const next = writeLinkingIntoGeneratedMetadata(
    { byVideoId: { a: { content_intent: 'news' }, b: { content_intent: 'other' } } },
    ['a', 'c'],
    { a: { linking_raw_domains: ['x.com'] } as never },
    { c: 'tutorial / explainer' },
  );
  expect(next.byVideoId.a).toMatchObject({ content_intent: 'news', linking: { linking_raw_domains: ['x.com'] } });
  expect(next.byVideoId.c.content_intent).toBe('tutorial / explainer');
  expect(next.byVideoId.b.content_intent).toBe('other');
});

describe('nextChannelLinkingState', () => {
  const current: ChannelLinkingState = { stale: false, snapshot: null };

  test('marks stale when there is no channel table yet', () => {
    expect(nextChannelLinkingState({ current, hasChannelMetadata: false, videoRows: [], linkingByVideoId: {}, datasetFingerprint: 'fp', staleReason: 'why' }))
      .toEqual({ stale: true, staleReason: 'why', snapshot: null });
  });

  test('rebuilds aggregates stamped with the dataset fingerprint the stale check uses', () => {
    const next = nextChannelLinkingState({ current, hasChannelMetadata: true, videoRows: [], linkingByVideoId: {}, datasetFingerprint: 'fp-real', staleReason: 'why' });
    expect(next.stale).toBe(false);
    expect(next.snapshot?.datasetFingerprint).toBe('fp-real');
    expect(markStaleForDataset(next, 'fp-real', 'x')).toBe(next);
  });
});

test('linkingParseCacheKey combines dataset and column', () => {
  expect(linkingParseCacheKey('fp', 'description')).toBe('fp::description');
});
