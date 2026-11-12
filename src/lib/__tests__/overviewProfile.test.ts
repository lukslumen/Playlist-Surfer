import { describe, expect, test } from 'vitest';
import type { DashboardTemplateVideoRecord } from '../dashboardTemplateTypes';
import {
  binStart,
  bucketize,
  buildOverviewProfile,
  buildUploadBins,
  chooseTimeUnit,
  languageName,
  normalizeLanguage,
  topShares,
} from '../overviewProfile';

function record(overrides: Partial<DashboardTemplateVideoRecord> = {}): DashboardTemplateVideoRecord {
  return {
    title: 'Video',
    description: '',
    channelTitle: 'Channel A',
    channelId: 'UCa',
    thumbnailUrl: '',
    transcript: '',
    tags: [],
    videoCategoryLabel: 'Education',
    topicCategories: [],
    durationSec: 1500,
    caption: '',
    defaultLanguage: 'en',
    defaultAudioLanguage: 'en-US',
    viewCount: 1000,
    commentCount: 10,
    likeCount: 40,
    publishedAt: '2024-03-15T12:00:00Z',
    ...overrides,
  };
}

const DAY = 24 * 60 * 60 * 1000;

describe('time bins', () => {
  test('picks a unit that keeps the number of bars readable', () => {
    expect(chooseTimeUnit(20 * DAY)).toBe('day');
    expect(chooseTimeUnit(300 * DAY)).toBe('week');
    expect(chooseTimeUnit(6 * 365 * DAY)).toBe('month');
    expect(chooseTimeUnit(20 * 365 * DAY)).toBe('quarter');
    expect(chooseTimeUnit(60 * 365 * DAY)).toBe('year');
  });

  test('weeks start on Monday and months and quarters on the 1st, in UTC', () => {
    const wednesday = Date.UTC(2024, 2, 13, 18);
    expect(new Date(binStart(wednesday, 'week')).toISOString()).toBe('2024-03-11T00:00:00.000Z');
    expect(new Date(binStart(wednesday, 'month')).toISOString()).toBe('2024-03-01T00:00:00.000Z');
    expect(new Date(binStart(Date.UTC(2024, 7, 20), 'quarter')).toISOString()).toBe('2024-07-01T00:00:00.000Z');
  });

  test('fills empty bins between the first and last upload, with exclusive ends', () => {
    const uploads = buildUploadBins([Date.UTC(2023, 0, 5), Date.UTC(2023, 0, 20), Date.UTC(2023, 3, 2), Date.UTC(2024, 0, 1)]);
    expect(uploads.unit).toBe('week');
    const months = buildUploadBins([Date.UTC(2020, 10, 3), Date.UTC(2023, 1, 1), Date.UTC(2026, 9, 23)]);
    expect(months.unit).toBe('month');
    expect(months.bins[0].label).toBe('Nov 2020');
    expect(months.bins.at(-1)?.label).toBe('Oct 2026');
    expect(months.bins).toHaveLength(72);
    expect(months.bins.reduce((total, bin) => total + bin.count, 0)).toBe(3);
    expect(months.bins[0].endTs).toBe(months.bins[1].startTs);
    expect(months.busiest?.count).toBe(1);
  });

  test('has no bins without dates', () => {
    expect(buildUploadBins([])).toEqual({ unit: 'month', bins: [], maxCount: 0, busiest: null });
  });
});

describe('buckets and shares', () => {
  const definitions = [
    { key: 'a', label: 'A', min: 0, max: 10 },
    { key: 'b', label: 'B', min: 10, max: 100 },
    { key: 'c', label: 'C', min: 100, max: 1000 },
    { key: 'd', label: 'D', min: 1000, max: null },
  ];

  test('counts into half-open ranges and trims empty buckets at the ends only', () => {
    const buckets = bucketize([10, 99, 5000], definitions);
    expect(buckets.map((bucket) => [bucket.key, bucket.count])).toEqual([['b', 2], ['c', 0], ['d', 1]]);
    expect(buckets[0].share).toBeCloseTo(2 / 3);
    expect(bucketize([], definitions)).toEqual([]);
  });

  test('keeps the top values, then Other, then unknown', () => {
    const shares = topShares(['x', 'x', 'y', 'z', null], 2, 'Not set');
    expect(shares.map((entry) => [entry.label, entry.count, entry.filterValue])).toEqual([
      ['x', 2, 'x'],
      ['y', 1, 'y'],
      ['Other (1)', 1, undefined],
      ['Not set', 1, undefined],
    ]);
  });

  test('normalizes languages to base codes and names them', () => {
    expect(normalizeLanguage('en-US')).toBe('en');
    expect(normalizeLanguage('zxx')).toBe('unknown');
    expect(normalizeLanguage('')).toBe('unknown');
    expect(languageName('nl')).toBe('Dutch');
  });
});

describe('buildOverviewProfile', () => {
  test('summarizes a single-channel dataset', () => {
    const profile = buildOverviewProfile([
      record({ viewCount: 100, publishedAt: '2020-11-03T00:00:00Z' }),
      record({ viewCount: 1000, durationSec: 3000 }),
      record({ viewCount: 10_000, durationSec: 4000, publishedAt: '2026-10-23T00:00:00Z' }),
    ]);
    expect(profile.videos).toBe(3);
    expect(profile.channels).toBe(1);
    expect(profile.singleChannelName).toBe('Channel A');
    expect(profile.totalViews).toBe(11_100);
    expect(profile.medianViews).toBe(1000);
    expect(profile.medianDurationSec).toBe(3000);
    expect(profile.medianEngagementPerThousand).toBe(50);
    expect(profile.uploads.unit).toBe('month');
    expect(profile.lengths.map((bucket) => [bucket.label, bucket.count])).toEqual([['20–60 min', 2], ['Over 1 hour', 1]]);
    expect(profile.categories[0]).toMatchObject({ label: 'Education', filterValue: 'Education', share: 1 });
    expect(profile.languages[0]).toMatchObject({ label: 'English', filterValue: 'en' });
    expect(profile.languageSource).toBe('audio');
    expect(profile.summary).toEqual([
      '3 videos from one channel (Channel A), published between Nov 2020 and Oct 2026.',
      'Most are 20–60 min long (67%), and the typical video has 1K views.',
      'Mostly Education (100%) and in English (100%).',
    ]);
  });

  test('handles missing views, lengths, dates and audio languages', () => {
    const profile = buildOverviewProfile([
      record({ viewCount: null, durationSec: null, publishedAt: '', channelId: 'UCa', defaultAudioLanguage: '', defaultLanguage: 'de' }),
      record({ viewCount: null, durationSec: null, publishedAt: 'not a date', channelId: 'UCb', channelTitle: 'B', defaultAudioLanguage: '', defaultLanguage: '' }),
    ]);
    expect(profile.channels).toBe(2);
    expect(profile.singleChannelName).toBeNull();
    expect(profile.medianViews).toBeNull();
    expect(profile.viewsUnknownCount).toBe(2);
    expect(profile.lengthUnknownCount).toBe(2);
    expect(profile.uploads.bins).toEqual([]);
    expect(profile.firstPublishedTs).toBeNull();
    expect(profile.languageSource).toBe('declared');
    expect(profile.languages.map((entry) => entry.label)).toEqual(['German', 'Not set']);
    expect(profile.summary).toEqual(['2 videos from 2 channels.', 'Mostly Education (100%).']);
  });

  test('an empty scope says so', () => {
    expect(buildOverviewProfile([]).summary).toEqual(['This scope has no videos.']);
  });

  test('handles 100,000 videos without overflowing the stack', () => {
    const records = Array.from({ length: 100_000 }, (_, index) => record({ publishedAt: new Date(Date.UTC(2015, 0, 1) + index * 3_600_000).toISOString(), viewCount: index }));
    const profile = buildOverviewProfile(records);
    expect(profile.datedCount).toBe(100_000);
    expect(profile.uploads.bins.length).toBeGreaterThan(10);
  });
});
