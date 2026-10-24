import { describe, expect, test } from 'vitest';
import { buildDashboardTemplateSnapshot, inferIntentFromText } from '../dashboardTemplate';

function video(overrides: Record<string, unknown> = {}) {
  return {
    videoId: 'v1',
    videoTitle: 'Guitar chords tutorial',
    channelId: 'c1',
    channelTitle: 'Alpha',
    viewCount: 100,
    likeCount: 10,
    commentCount: 5,
    publishedAt: '2025-03-01T12:00:00.000Z',
    durationSec: 240,
    tags: '["guitar","chords"]',
    videoCategoryLabel: 'Music',
    topicCategories: '["https://en.wikipedia.org/wiki/Music"]',
    defaultLanguage: 'en-US',
    defaultAudioLanguage: 'en',
    videoDescription: 'Guitar chords lesson. Follow https://instagram.com/alpha',
    thumbnail: 'https://i.ytimg.com/vi/v1/hqdefault.jpg',
    ...overrides,
  };
}

function build(rows: any[], extra: Record<string, unknown> = {}) {
  return buildDashboardTemplateSnapshot({ rows, scope: 'full', ...extra });
}

function column(snapshot: ReturnType<typeof build>, key: string) {
  const found = snapshot.columns.find((item) => item.key === key);
  if (!found) throw new Error(`missing column ${key}`);
  return found;
}

describe('inferIntentFromText', () => {
  test('classifies common YouTube intents in priority order', () => {
    expect(inferIntentFromText('How to tune a guitar')).toBe('tutorial / explainer');
    expect(inferIntentFromText('iPhone vs Pixel')).toBe('review / comparison');
    expect(inferIntentFromText('Breaking news tonight')).toBe('news / update');
    expect(inferIntentFromText('My reaction to the trailer')).toBe('opinion / reaction');
    expect(inferIntentFromText('Podcast episode 12')).toBe('interview / talk');
  });

  test('falls back to other for empty or unmatched text', () => {
    expect(inferIntentFromText('')).toBe('other');
    expect(inferIntentFromText('sunset timelapse')).toBe('other');
  });
});

describe('buildDashboardTemplateSnapshot labels', () => {
  test('defaults the dataset label and derives the scope label from the scope', () => {
    expect(build([]).datasetLabel).toBe('Untitled dataset');
    expect(build([]).scopeLabel).toBe('full dataset');
    expect(buildDashboardTemplateSnapshot({ rows: [], scope: 'filtered' }).scopeLabel).toBe('filtered subset');
    expect(build([], { datasetLabel: '  Music sample  ', scopeLabel: 'custom' })).toMatchObject({
      datasetLabel: 'Music sample',
      scopeLabel: 'custom',
    });
  });
});

describe('buildDashboardTemplateSnapshot on empty input', () => {
  const snapshot = build([]);

  test('marks every attention column unavailable with missing fields', () => {
    expect(snapshot.columns.map((item) => item.available)).toEqual([false, false, false]);
    expect(column(snapshot, 'video').missingFields).toEqual(['title', 'viewCount']);
    expect(column(snapshot, 'channel').missingFields).toEqual(['channelTitle', 'viewCount']);
    expect(column(snapshot, 'engagement').missingFields).toEqual(['title', 'commentCount']);
  });

  test('reports zero totals, null timestamps and a poor status', () => {
    expect(snapshot.overview).toMatchObject({
      totalRows: 0,
      totalVideos: 0,
      uniqueChannels: 0,
      totalViews: 0,
      newestPublishTs: null,
      oldestPublishTs: null,
      medianPublishTs: null,
      overallStatus: 'poor',
    });
    expect(snapshot.validVideoRows).toBe(0);
  });

  test('returns an empty timeline with n/a labels', () => {
    expect(snapshot.provenance.timeSeries).toEqual([]);
    expect(snapshot.provenance.overview.upload.firstLabel).toBe('n/a');
    expect(snapshot.provenance.minTs).toBeNull();
    expect(snapshot.provenance.languageRows).toEqual([]);
  });

  test('renders summary text with n/a rankings and no NaN values', () => {
    expect(snapshot.summaryText).toContain('Rows: 0');
    expect(snapshot.summaryText).toContain('Top video: n/a');
    expect(snapshot.summaryText).toContain('Top channel: n/a');
    expect(snapshot.summaryText).not.toContain('NaN');
    expect(snapshot.detailedSummaryText).not.toContain('NaN');
    expect(snapshot.detailedSummaryText).toContain('Video: unavailable');
  });

  test('reports zeroed shorts estimate and content overview', () => {
    expect(snapshot.content.shortsEstimate).toMatchObject({ shortCount: 0, longCount: 0, shortShare: 0, longShare: 0 });
    expect(snapshot.content.overview.avgTagsPerTaggedVideo).toBe(0);
    expect(snapshot.content.categories).toEqual([]);
  });
});

describe('buildDashboardTemplateSnapshot overview metrics', () => {
  test('totals views, comments and likes and counts unique channels and ids', () => {
    const snapshot = build([
      video({ videoId: 'v1', channelTitle: 'Alpha', viewCount: 100, commentCount: 5, likeCount: 10 }),
      video({ videoId: 'v2', channelTitle: 'Beta', viewCount: '2,500', commentCount: 15, likeCount: 30 }),
    ]);
    expect(snapshot.overview).toMatchObject({
      totalRows: 2,
      totalVideos: 2,
      uniqueVideoIds: 2,
      uniqueChannels: 2,
      totalViews: 2600,
      totalComments: 20,
      totalLikes: 40,
    });
  });

  test('handles very large view counts in totals and compact summary text', () => {
    const snapshot = build([video({ viewCount: 3_200_000_000 }), video({ videoId: 'v2', viewCount: 800_000_000 })]);
    expect(snapshot.overview.totalViews).toBe(4_000_000_000);
    expect(snapshot.summaryText).toContain('Total views: 4b');
  });

  test('detects duplicate video ids and exact duplicate rows separately', () => {
    const snapshot = build([
      video({ videoId: 'v1' }),
      video({ videoId: 'v1' }),
      video({ videoId: 'v1', viewCount: 999 }),
      video({ videoId: 'v2' }),
    ]);
    expect(snapshot.overview.duplicateCount).toBe(2);
    expect(snapshot.overview.duplicateRate).toBe(0.5);
    expect(snapshot.overview.exactDuplicateRowCount).toBe(1);
    expect(snapshot.overview.exactDuplicateRowRate).toBe(0.25);
    expect(snapshot.overview.overallStatus).toBe('poor');
    expect(snapshot.overview.caveats.some((caveat) => caveat.text.includes('Duplicate video rate is 50%'))).toBe(true);
  });

  test('uses a title/channel/date proxy key for duplicate detection when video ids are missing', () => {
    const snapshot = build([
      video({ videoId: undefined, videoTitle: 'Same Title' }),
      video({ videoId: undefined, videoTitle: 'same title ' }),
      video({ videoId: undefined, videoTitle: 'Other' }),
    ]);
    expect(snapshot.overview.uniqueVideoIds).toBe(0);
    expect(snapshot.overview.totalVideos).toBe(3);
    expect(snapshot.overview.duplicateCount).toBe(1);
  });

  test('counts malformed publish dates and missing dates in caveats', () => {
    const snapshot = build([
      video({ videoId: 'v1', publishedAt: 'not-a-date' }),
      video({ videoId: 'v2', publishedAt: '' }),
      video({ videoId: 'v3' }),
      video({ videoId: 'v4' }),
    ]);
    expect(snapshot.overview.malformedDateCount).toBe(1);
    expect(snapshot.overview.validPublishCount).toBe(2);
    const texts = snapshot.overview.caveats.map((caveat) => caveat.text);
    expect(texts).toContain('25% of rows are missing publish date.');
    expect(texts).toContain('25% of rows have malformed publish dates.');
  });

  test('computes zero-rates against rows that report the metric', () => {
    const snapshot = build([
      video({ videoId: 'v1', commentCount: 0, likeCount: 0 }),
      video({ videoId: 'v2', commentCount: 4, likeCount: undefined }),
    ]);
    expect(snapshot.overview.zeroCommentRate).toBe(0.5);
    expect(snapshot.overview.zeroLikeRate).toBe(1);
    expect(snapshot.overview.zeroViewRate).toBe(0);
  });

  test('builds coverage metrics for thumbnails, descriptions, tags, captions and transcripts', () => {
    const snapshot = build([
      video({ videoId: 'v1', caption: 'true', transcript: 'hello world' }),
      video({ videoId: 'v2', caption: 'false', thumbnail: '', videoDescription: '', tags: '' }),
    ]);
    const byKey = Object.fromEntries(snapshot.overview.coverage.map((metric) => [metric.key, metric]));
    expect(byKey.thumbnails).toMatchObject({ presentCount: 1, missingCount: 1, presentShare: 0.5 });
    expect(byKey.descriptions.presentCount).toBe(1);
    expect(byKey.tags.presentCount).toBe(1);
    expect(byKey.captions.presentCount).toBe(1);
    expect(byKey.transcripts.presentCount).toBe(1);
  });

  test('counts transcript overrides from annotations as transcript coverage', () => {
    const snapshot = build([video({ videoId: 'v1' })], {
      annotations: { v1: { transcriptOverride: 'override text' } },
    });
    const transcripts = snapshot.overview.coverage.find((metric) => metric.key === 'transcripts');
    expect(transcripts?.presentCount).toBe(1);
  });

  test('rates a clean multi-channel dataset as good', () => {
    const rows = Array.from({ length: 20 }, (_, index) => video({ videoId: `v${index}`, channelTitle: `Channel ${index % 5}` }));
    const snapshot = build(rows);
    expect(snapshot.overview.overallStatus).toBe('good');
    expect(snapshot.overview.oneVideoChannelCount).toBe(0);
    expect(snapshot.overview.caveats).toEqual([{ severity: 'low', text: 'No major structural quality flags detected.' }]);
  });

  test('flags datasets where most channels appear only once', () => {
    const rows = Array.from({ length: 10 }, (_, index) => video({ videoId: `v${index}`, channelTitle: `Channel ${index}` }));
    const snapshot = build(rows);
    expect(snapshot.overview.oneVideoChannelShare).toBe(1);
    expect(snapshot.overview.overallStatus).toBe('limited');
    expect(snapshot.overview.caveats.some((caveat) => caveat.severity === 'high' && caveat.text.includes('100% of channels appear once'))).toBe(true);
  });
});

describe('buildDashboardTemplateSnapshot attention columns', () => {
  test('ranks videos by views with shares of the total', () => {
    const snapshot = build([
      video({ videoId: 'a', videoTitle: 'Small', viewCount: 10 }),
      video({ videoId: 'b', videoTitle: 'Big', viewCount: 70 }),
      video({ videoId: 'c', videoTitle: 'Mid', viewCount: 20 }),
    ]);
    const videos = column(snapshot, 'video');
    expect(videos.available).toBe(true);
    expect(videos.ranking.map((item) => [item.rank, item.label, item.rawValue])).toEqual([
      [1, 'Big', 70], [2, 'Mid', 20], [3, 'Small', 10],
    ]);
    expect(videos.ranking[0].share).toBeCloseTo(0.7);
    expect(videos.ranking[0].videoId).toBe('b');
    expect(videos.headlineShare).toBeCloseTo(0.7);
  });

  test('limits rankings to the top five entries', () => {
    const rows = Array.from({ length: 8 }, (_, index) => video({ videoId: `v${index}`, viewCount: index + 1 }));
    expect(column(build(rows), 'video').ranking).toHaveLength(5);
  });

  test('computes box statistics, Gini and the p90/median ratio for views', () => {
    const rows = [10, 20, 30, 40, 50].map((views, index) => video({ videoId: `v${index}`, viewCount: views }));
    const stats = column(build(rows), 'video').boxStats;
    expect(stats).toMatchObject({ min: 10, q1: 20, median: 30, q3: 40, max: 50, sampleSize: 5 });
    expect(stats.p10).toBeCloseTo(14);
    expect(stats.p90).toBeCloseTo(46);
    expect(stats.ratioP90ToMedian).toBeCloseTo(46 / 30);
    expect(stats.gini).toBeCloseTo(4 / 15);
  });

  test('reports a Gini of zero and full headline share for a single video', () => {
    const videos = column(build([video({ viewCount: 500 })]), 'video');
    expect(videos.boxStats.gini).toBe(0);
    expect(videos.headlineShare).toBe(1);
    expect(videos.boxStats.median).toBe(500);
  });

  test('keeps shares at zero and omits the ratio when every video has zero views', () => {
    const videos = column(build([video({ viewCount: 0 }), video({ videoId: 'v2', viewCount: 0 })]), 'video');
    expect(videos.headlineShare).toBe(0);
    expect(videos.ranking.every((item) => item.share === 0)).toBe(true);
    expect(videos.concentration.every((segment) => segment.share === 0)).toBe(true);
    expect(videos.boxStats.ratioP90ToMedian).toBeUndefined();
    expect(videos.boxStats.gini).toBe(0);
  });

  test('partitions views into top1 / top10 / top10% / rest segments for large video sets', () => {
    const rows = Array.from({ length: 200 }, (_, index) => video({ videoId: `v${index}`, viewCount: 200 - index }));
    const segments = column(build(rows), 'video').concentration;
    expect(segments.map((segment) => segment.key)).toEqual(['top1', 'nextBucket', 'restTop10', 'rest90']);
    const total = segments.reduce((acc, segment) => acc + segment.share, 0);
    expect(total).toBeCloseTo(1);
    expect(segments[0].rawValue).toBe(200);
  });

  test('aggregates channel views by channel id and partitions channel segments', () => {
    const rows = [
      video({ videoId: 'v1', channelId: 'c1', channelTitle: 'Alpha', viewCount: 60 }),
      video({ videoId: 'v2', channelId: 'c1', channelTitle: 'Alpha renamed', viewCount: 20 }),
      video({ videoId: 'v3', channelId: 'c2', channelTitle: 'Beta', viewCount: 20 }),
    ];
    const channels = column(build(rows), 'channel');
    expect(channels.ranking).toHaveLength(2);
    expect(channels.ranking[0]).toMatchObject({ label: 'Alpha', rawValue: 80, channelId: 'c1' });
    expect(channels.ranking[0].share).toBeCloseTo(0.8);
    expect(channels.headlineShare).toBeCloseTo(1);
    expect(channels.concentration.reduce((acc, segment) => acc + segment.share, 0)).toBeCloseTo(1);
    expect(channels.boxStats.sampleSize).toBe(2);
  });

  test('marks the engagement column unavailable when no row reports comments', () => {
    const engagement = column(build([video({ commentCount: undefined })]), 'engagement');
    expect(engagement.available).toBe(false);
    expect(engagement.title).toBe('Comments');
  });

  test('adds like statistics to the engagement column', () => {
    const rows = [
      video({ videoId: 'v1', commentCount: 90, likeCount: 300 }),
      video({ videoId: 'v2', commentCount: 10, likeCount: 100 }),
    ];
    const engagement = column(build(rows), 'engagement');
    expect(engagement.headlineShare).toBeCloseTo(0.9);
    expect(engagement.boxStats.medianLikes).toBe(200);
    expect(engagement.boxStats.likesTop10Share).toBeCloseTo(0.75);
  });

  test('counts rows with a title and view count as valid video rows', () => {
    expect(build([video(), video({ videoId: 'v2' })]).validVideoRows).toBe(2);
  });
});

describe('buildDashboardTemplateSnapshot content insights', () => {
  test('counts categories and topics, substituting unknown when absent', () => {
    const snapshot = build([
      video({ videoId: 'v1', videoCategoryLabel: 'Music' }),
      video({ videoId: 'v2', videoCategoryLabel: 'Music', topicCategories: '' }),
      video({ videoId: 'v3', videoCategoryLabel: '', topicCategories: 'Gaming|Music' }),
    ]);
    expect(snapshot.content.categories).toEqual([
      { label: 'Music', count: 2, share: 2 / 3 },
      { label: 'unknown', count: 1, share: 1 / 3 },
    ]);
    const topicLabels = snapshot.content.topics.map((item) => item.label);
    expect(topicLabels).toContain('unknown');
    expect(topicLabels).toContain('Gaming');
    expect(snapshot.content.overview.withCategory).toBe(2);
    expect(snapshot.content.overview.withTopics).toBe(2);
  });

  test('buckets durations from seconds and ISO 8601 strings', () => {
    const snapshot = build([
      video({ videoId: 'v1', durationSec: 30 }),
      video({ videoId: 'v2', durationSec: undefined, duration: 'PT4M13S' }),
      video({ videoId: 'v3', durationSec: undefined, duration: 'PT10M' }),
      video({ videoId: 'v4', durationSec: undefined, duration: 'PT20M' }),
      video({ videoId: 'v5', durationSec: undefined, duration: 'PT1H2M' }),
      video({ videoId: 'v6', durationSec: undefined, duration: 'garbage' }),
      video({ videoId: 'v7', durationSec: 0 }),
    ]);
    const counts = Object.fromEntries(snapshot.content.durations.map((item) => [item.label, item.count]));
    expect(counts).toEqual({ '<1m': 1, '1-5m': 1, '5-15m': 1, '15-30m': 1, '30m+': 1, unknown: 2 });
  });

  test('averages tags over tagged videos only', () => {
    const snapshot = build([
      video({ videoId: 'v1', tags: '["a","b","c"]' }),
      video({ videoId: 'v2', tags: '["a"]' }),
      video({ videoId: 'v3', tags: '' }),
    ]);
    expect(snapshot.content.overview.withTags).toBe(2);
    expect(snapshot.content.overview.avgTagsPerTaggedVideo).toBe(2);
  });

  test('counts intent cues from title and description', () => {
    const snapshot = build([
      video({ videoId: 'v1', videoTitle: 'How to play', videoDescription: '' }),
      video({ videoId: 'v2', videoTitle: 'Live set', videoDescription: 'podcast style' }),
      video({ videoId: 'v3', videoTitle: 'Sunset', videoDescription: '' }),
    ]);
    const labels = snapshot.content.intent.map((item) => item.label).sort();
    expect(labels).toEqual(['interview / talk', 'other', 'tutorial / explainer']);
  });

  test('estimates shorts from hashtags, tags and short durations', () => {
    const snapshot = build([
      video({ videoId: 'v1', videoTitle: 'Quick tip #shorts', durationSec: 600, tags: '' }),
      video({ videoId: 'v2', videoTitle: 'Clip', videoDescription: '', durationSec: 45, tags: '["shorts"]' }),
      video({ videoId: 'v3', videoTitle: 'Long form essay', videoDescription: '', durationSec: 1800, tags: '' }),
      video({ videoId: 'v4', videoTitle: 'Tiny', videoDescription: '', durationSec: 30, tags: '' }),
    ]);
    const shorts = snapshot.content.shortsEstimate;
    expect(shorts.shortCount).toBe(2);
    expect(shorts.longCount).toBe(2);
    expect(shorts.shortShare).toBe(0.5);
    expect(shorts.hashtagSignalHits).toBe(1);
    expect(shorts.tagSignalHits).toBe(1);
    expect(shorts.durationSignalHits).toBe(2);
    expect(shorts.scoreThreshold).toBe(3);
  });

  test('extracts title keywords by document frequency without stopwords or URLs', () => {
    const snapshot = build([
      video({ videoId: 'v1', videoTitle: 'Guitar guitar lesson for the win' }),
      video({ videoId: 'v2', videoTitle: 'Guitar https://example.com/secretword' }),
    ]);
    const keywords = snapshot.content.keywords.titleKeywords;
    expect(keywords[0]).toEqual({ label: 'guitar', count: 2, share: 1 });
    const labels = keywords.map((item) => item.label);
    expect(labels).toContain('lesson');
    expect(labels).not.toContain('the');
    expect(labels).not.toContain('for');
    expect(labels).not.toContain('secretword');
  });

  test('extracts tag keywords from joined tag lists', () => {
    const snapshot = build([video({ videoId: 'v1', tags: '["piano","jazz"]' }), video({ videoId: 'v2', tags: '["jazz"]' })]);
    expect(snapshot.content.keywords.tagKeywords[0]).toEqual({ label: 'jazz', count: 2, share: 1 });
  });
});

describe('buildDashboardTemplateSnapshot provenance', () => {
  test('uses daily bins with gap filling for short upload ranges', () => {
    const snapshot = build([
      video({ videoId: 'v1', publishedAt: '2025-03-01T10:00:00.000Z' }),
      video({ videoId: 'v2', publishedAt: '2025-03-01T20:00:00.000Z' }),
      video({ videoId: 'v3', publishedAt: '2025-03-04T09:00:00.000Z' }),
    ]);
    const upload = snapshot.provenance.overview.upload;
    expect(upload.binning).toBe('daily');
    expect(upload.rangeDays).toBe(4);
    expect(upload.totalBins).toBe(4);
    expect(upload.maxBinCount).toBe(2);
    expect(upload.validDateCount).toBe(3);
    expect(upload.validDateShare).toBe(1);
    expect(upload.firstLabel).toBe('Mar 01, 2025');
    expect(snapshot.provenance.timeSeries.map((point) => point.count)).toEqual([2, 0, 0, 1]);
    expect(snapshot.provenance.timeSeries[0].label).toBe('Mar 01');
    expect(snapshot.provenance.timeSeries[0].isPeak).toBe(true);
  });

  test('switches to Monday-aligned weekly bins for ranges longer than 160 days', () => {
    const snapshot = build([
      video({ videoId: 'v1', publishedAt: '2024-01-03T00:00:00.000Z' }),
      video({ videoId: 'v2', publishedAt: '2024-12-31T00:00:00.000Z' }),
    ]);
    const upload = snapshot.provenance.overview.upload;
    expect(upload.binning).toBe('weekly');
    const series = snapshot.provenance.timeSeries;
    expect(new Date(series[0].startTs).toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(series[0].label.startsWith('wk ')).toBe(true);
    expect(series.reduce((acc, point) => acc + point.count, 0)).toBe(2);
    expect(series[1].startTs - series[0].startTs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test('computes a trailing moving average over the timeline', () => {
    const snapshot = build([
      video({ videoId: 'v1', publishedAt: '2025-03-01T00:00:00.000Z' }),
      video({ videoId: 'v2', publishedAt: '2025-03-01T01:00:00.000Z' }),
      video({ videoId: 'v3', publishedAt: '2025-03-02T00:00:00.000Z' }),
    ]);
    expect(snapshot.provenance.timeSeries.map((point) => point.movingAvg)).toEqual([2, 1.5]);
  });

  test('accepts numeric epoch-second publish timestamps', () => {
    const snapshot = build([video({ publishedAt: '1735689600' })]);
    expect(snapshot.provenance.minTs).toBe(Date.UTC(2025, 0, 1));
  });

  test('summarises declared and audio languages with an unknown bucket', () => {
    const snapshot = build([
      video({ videoId: 'v1', defaultLanguage: 'en-US', defaultAudioLanguage: 'en' }),
      video({ videoId: 'v2', defaultLanguage: 'de_DE', defaultAudioLanguage: 'zxx' }),
      video({ videoId: 'v3', defaultLanguage: '', defaultAudioLanguage: 'english' }),
    ]);
    const rows = Object.fromEntries(snapshot.provenance.languageRows.map((row) => [row.label, row]));
    expect(rows.EN).toMatchObject({ declaredCount: 1, audioCount: 1 });
    expect(rows.DE).toMatchObject({ declaredCount: 1, audioCount: 0 });
    expect(rows.unknown).toMatchObject({ declaredCount: 1, audioCount: 2 });
    expect(rows.unknown.audioShare).toBeCloseTo(2 / 3);
  });

  test('derives a channel-age timeline once per channel from imported channel metadata', () => {
    const snapshot = build([
      video({ videoId: 'v1', channelId: 'c1' }),
      video({ videoId: 'v2', channelId: 'c1' }),
      video({ videoId: 'v3', channelId: 'c2', channel_created_at: '2015-06-01T00:00:00.000Z' }),
    ], {
      importedChannelMetadata: { byKey: { 'id:c1': { publishedAt: '2010-01-01T00:00:00.000Z' } } },
    });
    const age = snapshot.provenance.overview.channelAge;
    expect(age.validDateCount).toBe(2);
    expect(age.binning).toBe('weekly');
    expect(snapshot.provenance.channelAgeMinTs).toBe(Date.UTC(2010, 0, 1));
    expect(snapshot.provenance.channelAgeMaxTs).toBe(Date.UTC(2015, 5, 1));
  });
});

describe('buildDashboardTemplateSnapshot text output', () => {
  const snapshot = build([
    video({ videoId: 'v1', videoTitle: 'Top hit', channelTitle: 'Alpha', viewCount: 75 }),
    video({ videoId: 'v2', videoTitle: 'Second', channelId: 'c2', channelTitle: 'Beta', viewCount: 25 }),
  ], { datasetLabel: 'Sample' });

  test('includes headline numbers and the top video and channel in the summary', () => {
    expect(snapshot.summaryText.split('\n')[0]).toBe('Dashboard snapshot for Sample (full dataset)');
    expect(snapshot.summaryText).toContain('Rows: 2');
    expect(snapshot.summaryText).toContain('Unique channels: 2');
    expect(snapshot.summaryText).toContain('Total views: 100');
    expect(snapshot.summaryText).toContain('Top video: Top hit (75.0%)');
    expect(snapshot.summaryText).toContain('Top channel: Alpha (75.0%)');
  });

  test('structures the detailed write-up into overview, attention and content sections', () => {
    const text = snapshot.detailedSummaryText;
    const overviewAt = text.indexOf('SECTION 1 — OVERVIEW');
    const attentionAt = text.indexOf('SECTION 2 — ATTENTION');
    const contentAt = text.indexOf('SECTION 3 — CONTENT');
    expect(overviewAt).toBeGreaterThan(0);
    expect(attentionAt).toBeGreaterThan(overviewAt);
    expect(contentAt).toBeGreaterThan(attentionAt);
    expect(text).toContain('  Total rows: 2');
    expect(text).toContain('Top ranking: 1. Top hit (75.0%) | 2. Second (25.0%)');
    expect(text).toContain('Estimated shorts share:');
    expect(text).not.toContain('NaN');
  });
});
