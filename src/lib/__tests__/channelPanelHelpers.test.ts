import { describe, expect, test } from 'vitest';
import {
  bucketForKey,
  buildChannelMonogram,
  dedupeMetadataKeys,
  fieldLabel,
  formatMetadataDisplay,
  orderKeysByPriority,
  parseArrayLikeValue,
  resolveChannelDescription,
} from '../channelFieldFormatting';
import { resolveChannelThumbnailCandidates } from '../channelThumbnails';

describe('channel field formatting', () => {
  test('labels unknown keys from snake_case', () => {
    expect(fieldLabel('top_linked_domains')).toBe('Top Linked Domains');
  });

  test('parses list-like values only where they are lists', () => {
    expect(parseArrayLikeValue('tags', '["a","b"]')).toEqual(['a', 'b']);
    expect(parseArrayLikeValue('anything', 'a | b')).toEqual(['a', 'b']);
    expect(parseArrayLikeValue('tags', 'a, b')).toEqual(['a', 'b']);
    expect(parseArrayLikeValue('title', 'Hello, world')).toEqual([]);
  });

  test('formats numbers, lists and empty values for display', () => {
    expect(formatMetadataDisplay('view_count', '1234567')).toBe((1234567).toLocaleString());
    expect(formatMetadataDisplay('keywords', 'x|y')).toEqual(['x', 'y']);
    expect(formatMetadataDisplay('title', '')).toBe('N/A');
  });

  test('orders priority keys first, the rest alphabetically by label', () => {
    expect(orderKeysByPriority(['zeta', 'alpha', 'first'], ['first'])).toEqual(['first', 'alpha', 'zeta']);
  });

  test('drops fields that repeat the same label and value', () => {
    expect(dedupeMetadataKeys(['title', 'Title'], { title: 'X', Title: 'X' })).toEqual(['title']);
  });

  test('buckets keys into panel sections', () => {
    expect(bucketForKey('subscriber_count')).toBe('performance');
    expect(bucketForKey('linking_top_domain_x')).toBe('linking');
    expect(bucketForKey('mystery_field')).toBe('imported');
  });

  test('monogram and description fallbacks', () => {
    expect(buildChannelMonogram('National Geographic')).toBe('NG');
    expect(buildChannelMonogram('')).toBe('CH');
    expect(resolveChannelDescription({ about: 'About text' })).toBe('About text');
  });
});

test('channel thumbnails are collected from nested fields, normalised and deduplicated', () => {
  const urls = resolveChannelThumbnailCandidates([
    { snippet: { thumbnails: { default: { url: '//yt3.ggpht.com/a.jpg' }, high: { url: 'https://yt3.ggpht.com/b.jpg' } } } },
    { snippet: { thumbnails: { default: { url: 'https://yt3.ggpht.com/b.jpg' } } } },
  ]);
  expect(urls).toContain('https://yt3.ggpht.com/a.jpg');
  expect(urls).toContain('https://yt3.ggpht.com/b.jpg');
  expect(new Set(urls).size).toBe(urls.length);
  expect(resolveChannelThumbnailCandidates(null)).toEqual([]);
});
