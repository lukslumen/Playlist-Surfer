import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildDatasetDashboardStats } from '../datasetDashboard';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function video(overrides: Record<string, unknown> = {}) {
  return {
    videoId: 'v1',
    videoTitle: 'Learning guitar chords',
    channelId: 'c1',
    channelTitle: 'Alpha',
    viewCount: 100,
    likeCount: 10,
    commentCount: 5,
    publishedAt: '2025-12-01T00:00:00.000Z',
    duration: 'PT4M',
    tags: '["guitar","music"]',
    videoCategoryLabel: 'Music',
    defaultLanguage: 'en-US',
    videoDescription: 'Guitar chords lesson https://instagram.com/alpha',
    ...overrides,
  };
}

describe('buildDatasetDashboardStats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('returns null attention measures and empty bins for an empty dataset', () => {
    const stats = buildDatasetDashboardStats([]);
    expect(stats.videoCount).toBe(0);
    expect(stats.uniqueChannelCount).toBe(0);
    expect(stats.uploadSpanDays).toBe(0);
    expect(stats.attention.medianViews).toBeNull();
    expect(stats.attention.top10ViewShare).toBeNull();
    expect(stats.attention.giniViews).toBeNull();
    expect(stats.attention.hhiViews).toBeNull();
    expect(stats.channelMix.hhiViews).toBeNull();
    expect(stats.channelMix.dominance).toBe('low');
    expect(stats.time.uploadBins).toEqual([]);
    expect(stats.time.oldestUpload).toBeNull();
    expect(stats.time.uploadsPerDay).toBeNull();
    expect(stats.time.uploadsPerYear).toBe(0);
    expect(stats.coverage.descriptionsPresentPct).toBe(0);
    expect(stats.composition.keywordTokens).toEqual([]);
  });

  test('flags unavailable dislike and subscriber data when the columns are absent', () => {
    const stats = buildDatasetDashboardStats([video()]);
    expect(stats.warnings).toContain('Dislikes unavailable');
    expect(stats.warnings).toContain('Subscriber data not present');
  });

  test('omits dislike and subscriber warnings when those columns exist', () => {
    const stats = buildDatasetDashboardStats([video({ dislikeCount: 1, subscriberCount: 1000 })]);
    expect(stats.warnings).not.toContain('Dislikes unavailable');
    expect(stats.warnings).not.toContain('Subscriber data not present');
  });

  test('flags ranked search samples, incomplete tags and missing transcripts', () => {
    const stats = buildDatasetDashboardStats([
      video({ position: 1, transcript: 'hello there' }),
      video({ videoId: 'v2', position: 2, tags: '', transcript: '' }),
    ]);
    expect(stats.warnings).toContain('Search/ranked sample');
    expect(stats.warnings).toContain('Tags incomplete');
    expect(stats.warnings).toContain('Transcripts missing');
    expect(stats.coverage.transcriptsPresentPct).toBe(0.5);
    expect(stats.coverage.tagsPresentPct).toBe(0.5);
  });

  test('flags rare captions when fewer than 20% of rows have captions', () => {
    const rows = Array.from({ length: 10 }, (_, index) => video({ videoId: `v${index}`, caption: index === 0 ? 'true' : 'false' }));
    const stats = buildDatasetDashboardStats(rows);
    expect(stats.coverage.captionsAvailablePct).toBeCloseTo(0.1);
    expect(stats.warnings).toContain('Captions rare');
  });

  test('computes median and interpolated quantiles of views', () => {
    const stats = buildDatasetDashboardStats([10, 20, 30, 40].map((views, index) => video({ videoId: `v${index}`, viewCount: views })));
    expect(stats.attention.medianViews).toBe(25);
    expect(stats.attention.p75Views).toBeCloseTo(32.5);
    expect(stats.attention.p90Views).toBeCloseTo(37);
  });

  test('parses comma-formatted numeric strings as view counts', () => {
    const stats = buildDatasetDashboardStats([video({ viewCount: '1,234' })]);
    expect(stats.attention.medianViews).toBe(1234);
  });

  test('computes top-k view shares from the sorted view distribution', () => {
    const stats = buildDatasetDashboardStats([100, 50, 30, 20].map((views, index) => video({ videoId: `v${index}`, viewCount: views })));
    expect(stats.attention.top1ViewShare).toBeCloseTo(0.5);
    expect(stats.attention.top10ViewShare).toBeCloseTo(0.5);
    expect(stats.attention.top5ViewShare).toBeCloseTo(1);
    expect(stats.attention.top50ViewShare).toBeCloseTo(1);
  });

  test('computes a Herfindahl index from per-video view shares', () => {
    const stats = buildDatasetDashboardStats([100, 50, 30, 20].map((views, index) => video({ videoId: `v${index}`, viewCount: views })));
    expect(stats.attention.hhiViews).toBeCloseTo(0.25 + 0.0625 + 0.0225 + 0.01);
  });

  test('reports a Gini of zero for perfectly equal views', () => {
    const stats = buildDatasetDashboardStats([5, 5, 5, 5].map((views, index) => video({ videoId: `v${index}`, viewCount: views })));
    expect(stats.attention.giniViews).toBe(0);
  });

  test('reports a high Gini when one video holds all views', () => {
    const stats = buildDatasetDashboardStats([0, 0, 0, 100].map((views, index) => video({ videoId: `v${index}`, viewCount: views })));
    expect(stats.attention.giniViews).toBe(0.75);
  });

  test('returns null concentration measures when every video has zero views', () => {
    const stats = buildDatasetDashboardStats([video({ viewCount: 0 }), video({ videoId: 'v2', viewCount: 0 })]);
    expect(stats.attention.top1ViewShare).toBeNull();
    expect(stats.attention.giniViews).toBeNull();
    expect(stats.attention.hhiViews).toBeNull();
    expect(stats.channelMix.topChannelsByViews).toEqual([]);
    expect(stats.channelMix.hhiViews).toBeNull();
  });

  test('handles very large view counts without losing precision in shares', () => {
    const stats = buildDatasetDashboardStats([
      video({ viewCount: 9_000_000_000_000 }),
      video({ videoId: 'v2', viewCount: 1_000_000_000_000 }),
    ]);
    expect(stats.attention.top1ViewShare).toBeCloseTo(0.9);
    expect(stats.attention.medianViews).toBe(5_000_000_000_000);
  });

  test('ranks channels by row count and by views and classifies dominance', () => {
    const stats = buildDatasetDashboardStats([
      video({ videoId: 'v1', channelTitle: 'Alpha', viewCount: 900 }),
      video({ videoId: 'v2', channelTitle: 'Beta', viewCount: 50 }),
      video({ videoId: 'v3', channelTitle: 'Beta', viewCount: 50 }),
    ]);
    expect(stats.uniqueChannelCount).toBe(2);
    expect(stats.channelMix.topChannelsByRows[0]).toMatchObject({ label: 'Beta', count: 2 });
    expect(stats.channelMix.topChannelsByRows[0].share).toBeCloseTo(2 / 3);
    expect(stats.channelMix.topChannelsByViews[0]).toMatchObject({ label: 'Alpha', value: 900 });
    expect(stats.channelMix.topChannelsByViews[0].share).toBeCloseTo(0.9);
    expect(stats.channelMix.dominance).toBe('high');
    expect(stats.channelMix.top5ViewsShare).toBeCloseTo(1);
    expect(stats.channelMix.hhiViews).toBeCloseTo(0.81 + 0.01);
  });

  test('classifies moderate channel dominance between 25% and 50%', () => {
    const stats = buildDatasetDashboardStats(['A', 'B', 'C'].map((channel, index) => video({ videoId: `v${index}`, channelTitle: channel, viewCount: 100 })));
    expect(stats.channelMix.dominance).toBe('moderate');
  });

  test('counts categories and normalises language codes to their base subtag', () => {
    const stats = buildDatasetDashboardStats([
      video({ videoId: 'v1', videoCategoryLabel: 'Music', defaultLanguage: 'en-US' }),
      video({ videoId: 'v2', videoCategoryLabel: 'Music', defaultLanguage: 'EN_gb' }),
      video({ videoId: 'v3', videoCategoryLabel: 'Education', defaultLanguage: 'de' }),
      video({ videoId: 'v4', videoCategoryLabel: '', defaultLanguage: '' }),
    ]);
    expect(stats.categoryCount).toBe(2);
    expect(stats.composition.topCategories[0]).toMatchObject({ label: 'Music', count: 2, share: 0.5 });
    expect(stats.languageCount).toBe(2);
    expect(stats.composition.topLanguages.map((item) => item.label)).toEqual(['en', 'de']);
    expect(stats.composition.longTailCategoryShare).toBeCloseTo(0.25);
  });

  test('ranks categories by aggregated views', () => {
    const stats = buildDatasetDashboardStats([
      video({ videoId: 'v1', videoCategoryLabel: 'Music', viewCount: 10 }),
      video({ videoId: 'v2', videoCategoryLabel: 'Music', viewCount: 10 }),
      video({ videoId: 'v3', videoCategoryLabel: 'Gaming', viewCount: 80 }),
    ]);
    expect(stats.composition.topCategoriesByViews[0]).toMatchObject({ label: 'Gaming', value: 80, share: 0.8 });
  });

  test('extracts keywords by document frequency, dropping stopwords, short tokens and URLs', () => {
    const stats = buildDatasetDashboardStats([
      video({ videoId: 'v1', videoTitle: 'The guitar guitar lesson', videoDescription: 'see https://example.com/guitarpage' }),
      video({ videoId: 'v2', videoTitle: 'Guitar for you', videoDescription: '' }),
    ]);
    const labels = stats.composition.keywordTokens.map((item) => item.label);
    expect(stats.composition.keywordTokens[0]).toMatchObject({ label: 'guitar', count: 2, share: 1 });
    expect(labels).toContain('lesson');
    expect(labels).not.toContain('the');
    expect(labels).not.toContain('you');
    expect(labels.some((label) => label.includes('example'))).toBe(false);
  });

  test('derives the upload span, oldest and newest uploads', () => {
    const stats = buildDatasetDashboardStats([
      video({ videoId: 'v1', publishedAt: '2025-01-01T00:00:00.000Z' }),
      video({ videoId: 'v2', publishedAt: '2025-01-11T00:00:00.000Z' }),
    ]);
    expect(stats.uploadSpanDays).toBe(10);
    expect(stats.time.oldestUpload).toBe('2025-01-01T00:00:00.000Z');
    expect(stats.time.newestUpload).toBe('2025-01-11T00:00:00.000Z');
    expect(stats.time.uploadsPerDay).toBeCloseTo(0.2);
  });

  test('collapses identical upload dates into a single histogram bin', () => {
    const stats = buildDatasetDashboardStats([video({ videoId: 'v1' }), video({ videoId: 'v2' })]);
    expect(stats.time.uploadBins).toEqual([{ label: '2025-12-01', count: 2 }]);
    expect(stats.uploadSpanDays).toBe(0);
    expect(stats.time.uploadsPerYear).toBe(2);
  });

  test('spreads distinct upload dates over 4 to 10 bins that sum to the dated row count', () => {
    const rows = Array.from({ length: 30 }, (_, index) => video({
      videoId: `v${index}`,
      publishedAt: new Date(Date.UTC(2024, 0, 1 + index * 7)).toISOString(),
    }));
    const stats = buildDatasetDashboardStats(rows);
    const bins = stats.time.uploadBins;
    expect(bins.length).toBeGreaterThanOrEqual(4);
    expect(bins.length).toBeLessThanOrEqual(10);
    expect(bins.reduce((total, bin) => total + bin.count, 0)).toBe(30);
    expect(bins[0].label).toBe('2024-01-01');
  });

  test('accepts unix-second timestamps as publish dates', () => {
    const stats = buildDatasetDashboardStats([video({ publishedAt: 1735689600 })]);
    expect(stats.time.oldestUpload).toBe('2025-01-01T00:00:00.000Z');
  });

  test('sorts upload ages into recency and age buckets relative to now', () => {
    const stats = buildDatasetDashboardStats([
      video({ videoId: 'v1', publishedAt: '2025-12-20T00:00:00.000Z' }),
      video({ videoId: 'v2', publishedAt: '2025-11-01T00:00:00.000Z' }),
      video({ videoId: 'v3', publishedAt: '2025-06-01T00:00:00.000Z' }),
      video({ videoId: 'v4', publishedAt: '2020-01-01T00:00:00.000Z' }),
    ]);
    expect(stats.time.recencyBuckets.map((bucket) => bucket.count)).toEqual([1, 1, 1, 1]);
    expect(stats.time.ageBuckets.map((bucket) => [bucket.label, bucket.count])).toEqual([
      ['<90d', 2], ['<1y', 1], ['1-2y', 0], ['2-4y', 0], ['4y+', 1],
    ]);
  });

  test('computes median views per day from the upload age', () => {
    const stats = buildDatasetDashboardStats([video({ viewCount: 310, publishedAt: '2025-12-01T00:00:00.000Z' })]);
    expect(stats.time.medianAgeDays).toBe(31);
    expect(stats.attention.medianViewsPerDay).toBeCloseTo(10);
  });

  test('treats missing views and comments as zero and ignores unparseable dates', () => {
    const stats = buildDatasetDashboardStats([{ videoId: 'x', videoTitle: 'Bare row', publishedAt: 'not a date' }]);
    expect(stats.videoCount).toBe(1);
    expect(stats.totalVideoComments).toBe(0);
    expect(stats.attention.medianViews).toBe(0);
    expect(stats.time.oldestUpload).toBeNull();
    expect(stats.uniqueChannelCount).toBe(0);
  });

  test('sums video-level comments and their top-10% share', () => {
    const stats = buildDatasetDashboardStats([80, 10, 10].map((comments, index) => video({ videoId: `v${index}`, commentCount: comments })));
    expect(stats.totalVideoComments).toBe(100);
    expect(stats.comments.medianCommentsPerVideo).toBe(10);
    expect(stats.comments.top10CommentShare).toBeCloseTo(0.8);
  });

  test('computes metadata coverage for descriptions, tags and thumbnails', () => {
    const stats = buildDatasetDashboardStats([
      video({ videoId: 'v1', thumbnail: 'https://i.ytimg.com/a.jpg' }),
      video({ videoId: 'v2', videoDescription: '   ', tags: [], thumbnail: '' }),
    ]);
    expect(stats.coverage.descriptionsPresentPct).toBe(0.5);
    expect(stats.coverage.tagsPresentPct).toBe(0.5);
    expect(stats.coverage.thumbnailsPresentPct).toBe(0.5);
    expect(stats.dataQuality.descriptionCoveragePct).toBe(0.5);
  });
});
