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

  test('builds every tab profile and a write-up without NaN values', () => {
    expect(snapshot.profile?.summary).toEqual(['This scope has no videos.']);
    expect(snapshot.attention?.ranked).toEqual([]);
    expect(snapshot.vernacular?.terms.words).toEqual([]);
    expect(snapshot.time?.datedVideos).toBe(0);
    expect(snapshot.summaryText).not.toContain('NaN');
    expect(snapshot.detailedSummaryText).not.toContain('NaN');
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
    expect(snapshot.detailedSummaryText).toContain('total views: 4B');
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

describe('buildDashboardTemplateSnapshot text output', () => {
  const snapshot = build([
    video({ videoId: 'v1', videoTitle: 'Top hit', channelTitle: 'Alpha', viewCount: 75 }),
    video({ videoId: 'v2', videoTitle: 'Second', channelId: 'c2', channelTitle: 'Beta', viewCount: 25 }),
  ], { datasetLabel: 'Sample' });

  test('the summary opens with the dataset and the plain-language overview', () => {
    const lines = snapshot.summaryText.split('\n');
    expect(lines[0]).toBe('Dashboard snapshot for Sample (full dataset)');
    expect(lines[1]).toBe('2 videos from 2 channels, published in Mar 2025.');
  });

  test('the write-up has a section per tab with their key numbers', () => {
    const text = snapshot.detailedSummaryText;
    const sections = ['OVERVIEW', 'ATTENTION', 'VERNACULAR', 'TIME'].map((title) => text.indexOf(`\n${title}\n`) >= 0 ? text.indexOf(`\n${title}\n`) : text.indexOf(`${title}\n`));
    expect(sections.every((index) => index >= 0)).toBe(true);
    expect([...sections].sort((a, b) => a - b)).toEqual(sections);
    expect(text).toContain('videos by views: top 1% hold 75.0%');
    expect(text).toContain('  1. Top hit (Alpha): 75 views');
    expect(text).toContain('Tags (in 100% of videos):');
    expect(text).toContain('Busiest weekday (UTC): Saturday');
    expect(text).not.toContain('NaN');
  });

  test('hidden terms are applied and listed', () => {
    const hidden = build([video({ tags: '["guitar","chords"]' })], { vernacularExclusions: ['guitar'] });
    expect(hidden.vernacular?.terms.tags.map((term) => term.key)).toEqual(['chords']);
    expect(hidden.detailedSummaryText).toContain('hidden terms: guitar');
  });
});
