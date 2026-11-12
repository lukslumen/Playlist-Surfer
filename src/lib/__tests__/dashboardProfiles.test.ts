import { describe, expect, test } from 'vitest';
import type { DashboardTemplateVideoRecord } from '../dashboardTemplateTypes';
import { buildAttentionProfile, concentrationCurve, gini, MIN_VIEWS_FOR_ENGAGEMENT } from '../attentionProfile';
import { compareShares, formatRatio, logLikelihood } from '../compareShares';
import { rowsToCsv, slugify } from '../exportImage';
import { buildStopwordSet, stopwordsFor } from '../stopwords';
import { buildTimeProfile, choosePeriodUnit } from '../timeProfile';
import { buildCooccurrence, buildVernacularProfile, extractHashtags, phrases, tokenize, toGexf, topicLabel } from '../vernacularProfile';

function record(overrides: Partial<DashboardTemplateVideoRecord> = {}): DashboardTemplateVideoRecord {
  return {
    title: 'A video',
    description: '',
    channelTitle: 'Channel A',
    channelId: 'UCa',
    thumbnailUrl: '',
    transcript: '',
    tags: [],
    videoCategoryLabel: '',
    topicCategories: [],
    durationSec: 600,
    caption: '',
    defaultLanguage: '',
    defaultAudioLanguage: 'en',
    viewCount: 10_000,
    commentCount: 10,
    likeCount: 90,
    publishedAt: '2024-03-04T15:30:00Z',
    videoId: undefined,
    ...overrides,
  };
}

describe('compareShares', () => {
  test('log-likelihood is zero for equal shares and grows with the difference', () => {
    expect(logLikelihood(10, 100, 10, 100)).toBeCloseTo(0);
    expect(logLikelihood(30, 100, 10, 100)).toBeGreaterThan(logLikelihood(15, 100, 10, 100));
  });

  test('sorts real differences first and marks noise', () => {
    const rows = compareShares(
      [{ key: 'cartel', label: '#cartel', count: 38 }, { key: 'mexico', label: '#mexico', count: 2 }, { key: 'same', label: 'same', count: 20 }],
      100,
      [{ key: 'cartel', label: '#cartel', count: 120 }, { key: 'travel', label: '#travel', count: 140 }, { key: 'same', label: 'same', count: 200 }, { key: 'mexico', label: '#mexico', count: 10 }],
      1000,
    );
    expect(rows[0].key).toBe('cartel');
    expect(rows[0].ratio).toBeGreaterThan(3);
    expect(rows.find((row) => row.key === 'travel')).toMatchObject({ countA: 0, isNoise: false });
    expect(rows.find((row) => row.key === 'travel')!.ratio).toBeLessThan(0.1);
    expect(rows.find((row) => row.key === 'same')).toMatchObject({ isNoise: true });
    expect(rows.at(-1)!.isNoise).toBe(true);
  });

  test('formats ratios readably', () => {
    expect(formatRatio(3.14)).toBe('3.1×');
    expect(formatRatio(12.6)).toBe('13×');
    expect(formatRatio(0.25)).toBe('0.25×');
    expect(formatRatio(1)).toBe('1×');
  });
});

describe('attention', () => {
  test('gini is 0 for equal values and near 1 when one item has everything', () => {
    expect(gini([5, 5, 5, 5])).toBeCloseTo(0);
    expect(gini([0, 0, 0, 0, 0, 0, 0, 0, 0, 100])).toBeCloseTo(0.9);
  });

  test('concentration reports top shares and a curve from (0,0) to (1,1)', () => {
    const curve = concentrationCurve([100, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
    expect(curve.top10).toBeCloseTo(100 / 190);
    expect(curve.points[0]).toEqual([0, 0]);
    expect(curve.points.at(-1)).toEqual([1, 1]);
    expect(concentrationCurve([]).points).toEqual([[0, 0]]);
  });

  test('engagement needs enough views, and the channel norm needs enough videos', () => {
    const profile = buildAttentionProfile([
      record({ videoId: 'a', viewCount: 100_000, likeCount: 900, commentCount: 100 }),
      record({ videoId: 'b', viewCount: 10_000 }),
      record({ videoId: 'c', viewCount: 10_000 }),
      record({ videoId: 'd', viewCount: MIN_VIEWS_FOR_ENGAGEMENT - 1 }),
      record({ videoId: 'e', channelId: 'UCb', channelTitle: 'B', viewCount: 5000 }),
    ]);
    const byId = Object.fromEntries(profile.ranked.map((video) => [video.videoId, video]));
    expect(byId.a.engagement).toBe(10);
    expect(byId.d.engagement).toBeNull();
    expect(byId.a.vsChannel).toBe(10);
    expect(byId.e.vsChannel).toBeNull();
    expect(profile.breakoutCount).toBe(1);
    expect(profile.channelsWithNorm).toBe(1);
    expect(profile.curves.channels.views.count).toBe(2);
  });
});

describe('vernacular', () => {
  test('tokenizes across scripts and drops numbers and single letters', () => {
    expect(tokenize("Inside the World's Cocaine Trade 2024 — Ça va? Straße x")).toEqual(['inside', 'the', "world's", 'cocaine', 'trade', 'ça', 'va', 'straße']);
    expect(extractHashtags('Watch #NatGeo and #trafficked_series #2024')).toEqual(['#NatGeo', '#trafficked_series']);
    expect(topicLabel('https://en.wikipedia.org/wiki/Television_program')).toBe('Television program');
  });

  test('phrases never start or end with a stopword', () => {
    const stop = stopwordsFor('en');
    expect(phrases(['inside', 'the', 'drug', 'trade'], stop)).toEqual(['drug trade', 'inside the drug']);
  });

  test('stopwords cover English, languages over 5% and the exclusions', () => {
    const { words, languages } = buildStopwordSet([{ code: 'de', share: 0.3 }, { code: 'nl', share: 0.01 }], ['NatGeo', '#mariana']);
    expect(languages).toEqual(['en', 'de']);
    expect(words.has('und')).toBe(true);
    expect(words.has('het')).toBe(false);
    expect(words.has('natgeo')).toBe(true);
    expect(words.has('mariana')).toBe(true);
  });

  test('counts each term once per video, keeps the common spelling and applies exclusions everywhere', () => {
    const profile = buildVernacularProfile([
      record({ title: 'Cartel cartel money', tags: ['Nat Geo', 'Cartel'], description: '#NatGeo #cartel', topicCategories: ['https://en.wikipedia.org/wiki/Society'] }),
      record({ title: 'The cartel story', tags: ['nat geo'], description: '#natgeo', viewCount: 30_000 }),
      record({ title: 'Travel', tags: [] }),
    ], { exclusions: ['natgeo'] });
    expect(profile.terms.words.find((term) => term.key === 'cartel')).toMatchObject({ videos: 2, share: 2 / 3 });
    expect(profile.terms.words.find((term) => term.key === 'cartel')!.viewShare).toBeCloseTo(40_000 / 50_000);
    expect(profile.terms.words.some((term) => term.key === 'the')).toBe(false);
    expect(profile.terms.tags.find((term) => term.key === 'nat geo')).toMatchObject({ videos: 2 });
    expect(profile.terms.hashtags.map((term) => term.key)).toEqual(['#cartel']);
    expect(profile.terms.topics[0]).toMatchObject({ label: 'Society', raw: 'https://en.wikipedia.org/wiki/Society' });
    expect(profile.coverage.tags).toBe(2);
    expect(profile.exclusions).toEqual(['natgeo']);
  });

  test('builds a weighted co-occurrence network and exports it as GEXF', () => {
    const network = buildCooccurrence([
      record({ tags: ['drugs', 'cartel'], description: '#mexico' }),
      record({ tags: ['drugs', 'cartel'] }),
      record({ tags: ['travel'] }),
    ]);
    expect(network.nodes.map((node) => node.id)).toEqual(['cartel', 'drugs', '#mexico', 'travel']);
    expect(network.edges[0]).toEqual({ source: 'cartel', target: 'drugs', weight: 2 });
    const gexf = toGexf(network, 'test & <check>');
    expect(gexf).toContain('<edge id="0" source="cartel" target="drugs" weight="2"/>');
    expect(gexf).toContain('test &amp; &lt;check&gt;');
    expect(gexf).toContain('<attvalue for="kind" value="hashtag"/>');
  });
});

describe('time', () => {
  test('chooses coarser periods for longer spans', () => {
    const year = 365.25 * 86_400_000;
    expect(choosePeriodUnit(0.5 * year)).toBe('month');
    expect(choosePeriodUnit(2 * year)).toBe('quarter');
    expect(choosePeriodUnit(6 * year)).toBe('year');
  });

  test('builds the UTC and local rhythm, periods, channel lanes and terms over time', () => {
    const profile = buildTimeProfile([
      record({ publishedAt: '2021-03-01T15:30:00Z', tags: ['cartel'] }),
      record({ publishedAt: '2023-06-05T15:10:00Z', tags: ['cartel'], channelId: 'UCb', channelTitle: 'B' }),
      record({ publishedAt: '2026-01-05T01:00:00Z', tags: ['travel'] }),
      record({ publishedAt: 'not a date' }),
    ], { timeZone: 'Europe/Amsterdam' });
    expect(profile.datedVideos).toBe(3);
    expect(profile.rhythm.utc[0][15]).toBe(2);
    expect(profile.rhythm.local[0][16]).toBe(1);
    expect(profile.rhythm.local[0][17]).toBe(1);
    expect(profile.periodUnit).toBe('year');
    expect(profile.periods.map((period) => period.label)).toEqual(['2021', '2022', '2023', '2024', '2025', '2026']);
    expect(profile.channels[0]).toMatchObject({ label: 'Channel A', videos: 2, counts: [1, 0, 0, 0, 0, 1] });
    expect(profile.terms.tags[0]).toMatchObject({ label: 'cartel', shares: [1, 0, 1, 0, 0, 0] });
  });
});

test('CSV quoting and file slugs', () => {
  expect(rowsToCsv(['term', 'note'], [['a, b', 'say "hi"'], [1, null]])).toBe('"term","note"\n"a, b","say ""hi"""\n"1",""');
  expect(slugify('Concentration of views — full dataset')).toBe('concentration-of-views-full-dataset');
});
