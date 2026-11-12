import { describe, expect, test } from 'vitest';
import {
  aggregateChannelLinkingFromVideoRows,
  applyLinkingDomainOverride,
  buildChannelLinkingSnapshot,
  buildLinkingDashboardModel,
  buildLinkingStageA,
  buildLinkingStageAAsync,
  buildLinkingStageB,
  buildLinkingStageBAsync,
  detectLinkingColumnCandidates,
  normalizeLinkingDomainKey,
  profileLinkingColumnCandidates,
  revertLinkingDomainOverride,
} from '../linkingDashboard';
import type { LinkingDomainOverride } from '../../types';

const UPDATED_AT = '2026-01-01T00:00:00.000Z';

function video(id: string, description: string, overrides: Record<string, unknown> = {}) {
  return {
    videoId: id,
    videoTitle: `Video ${id}`,
    channelId: 'c1',
    channelTitle: 'Alpha',
    viewCount: 100,
    videoCategoryLabel: 'Education',
    videoDescription: description,
    ...overrides,
  };
}

function mentionsFor(description: string) {
  const stageA = buildLinkingStageA([video('v1', description)], { linkColumn: 'videoDescription' });
  return stageA.parsedRows[0]?.mentions ?? [];
}

function domainsFor(description: string) {
  return mentionsFor(description).map((mention) => mention.domain);
}

function stageBFor(rows: any[], column = 'videoDescription', overridesByDomain?: Record<string, LinkingDomainOverride>) {
  const stageA = buildLinkingStageA(rows, { linkColumn: column });
  return buildLinkingStageB(stageA, { sourceColumn: column, overridesByDomain });
}

describe('normalizeLinkingDomainKey', () => {
  test('lowercases, trims and strips a leading www.', () => {
    expect(normalizeLinkingDomainKey('  WWW.Patreon.com ')).toBe('patreon.com');
  });

  test('collapses platform subdomains onto the platform root', () => {
    expect(normalizeLinkingDomainKey('m.youtube.com')).toBe('youtube.com');
    expect(normalizeLinkingDomainKey('music.youtube.com')).toBe('youtube.com');
    expect(normalizeLinkingDomainKey('l.instagram.com')).toBe('instagram.com');
    expect(normalizeLinkingDomainKey('vm.tiktok.com')).toBe('tiktok.com');
    expect(normalizeLinkingDomainKey('old.reddit.com')).toBe('reddit.com');
  });

  test('leaves unrelated subdomains untouched and tolerates empty input', () => {
    expect(normalizeLinkingDomainKey('shop.example.com')).toBe('shop.example.com');
    expect(normalizeLinkingDomainKey('')).toBe('');
  });
});

describe('applyLinkingDomainOverride', () => {
  test('stores a normalised override with bucket, note and timestamp', () => {
    const result = applyLinkingDomainOverride({
      overridesByDomain: {},
      domain: 'WWW.Example.com',
      baseBucket: 'marketplace',
      note: '  merch store  ',
      updatedAt: UPDATED_AT,
    });
    expect(result.domain).toBe('example.com');
    expect(result.previous).toBeUndefined();
    expect(result.next).toEqual({ domain: 'example.com', baseBucket: 'marketplace', note: 'merch store', updatedAt: UPDATED_AT });
    expect(result.overridesByDomain['example.com']).toEqual(result.next);
  });

  test('does not mutate the input override map', () => {
    const input: Record<string, LinkingDomainOverride> = {};
    applyLinkingDomainOverride({ overridesByDomain: input, domain: 'example.com', baseBucket: 'routing', updatedAt: UPDATED_AT });
    expect(input).toEqual({});
  });

  test('keeps the previous bucket when only the note changes', () => {
    const existing = { 'example.com': { domain: 'example.com', baseBucket: 'crowdfunding' as const, updatedAt: UPDATED_AT } };
    const result = applyLinkingDomainOverride({ overridesByDomain: existing, domain: 'example.com', note: 'tip jar', updatedAt: UPDATED_AT });
    expect(result.previous).toEqual(existing['example.com']);
    expect(result.next).toMatchObject({ baseBucket: 'crowdfunding', note: 'tip jar' });
  });

  test('keeps the previous note when only the bucket changes', () => {
    const existing = { 'example.com': { domain: 'example.com', note: 'keep me', updatedAt: UPDATED_AT } };
    const result = applyLinkingDomainOverride({ overridesByDomain: existing, domain: 'example.com', baseBucket: 'routing', updatedAt: UPDATED_AT });
    expect(result.next).toMatchObject({ baseBucket: 'routing', note: 'keep me' });
  });

  test('removes the override when neither bucket nor note remain', () => {
    const existing = { 'example.com': { domain: 'example.com', note: 'old', updatedAt: UPDATED_AT } };
    const result = applyLinkingDomainOverride({ overridesByDomain: existing, domain: 'example.com', note: '   ', updatedAt: UPDATED_AT });
    expect(result.next).toBeUndefined();
    expect(result.overridesByDomain).toEqual({});
    expect(result.previous).toEqual(existing['example.com']);
  });

  test('stamps a current ISO timestamp when none is supplied', () => {
    const result = applyLinkingDomainOverride({ overridesByDomain: {}, domain: 'example.com', baseBucket: 'other' });
    expect(Number.isNaN(Date.parse(result.next!.updatedAt))).toBe(false);
  });
});

describe('revertLinkingDomainOverride', () => {
  test('removes the override for the normalised domain and returns it as previous', () => {
    const existing = {
      'example.com': { domain: 'example.com', baseBucket: 'routing' as const, updatedAt: UPDATED_AT },
      'other.com': { domain: 'other.com', baseBucket: 'marketplace' as const, updatedAt: UPDATED_AT },
    };
    const result = revertLinkingDomainOverride({ overridesByDomain: existing, domain: 'WWW.EXAMPLE.COM' });
    expect(result.domain).toBe('example.com');
    expect(result.previous).toEqual(existing['example.com']);
    expect(result.next).toBeUndefined();
    expect(Object.keys(result.overridesByDomain)).toEqual(['other.com']);
    expect(Object.keys(existing)).toHaveLength(2);
  });

  test('is a no-op for domains without an override', () => {
    const result = revertLinkingDomainOverride({ overridesByDomain: {}, domain: 'missing.com' });
    expect(result.previous).toBeUndefined();
    expect(result.overridesByDomain).toEqual({});
  });
});

describe('URL extraction from free-text descriptions', () => {
  test('extracts http(s) and www. URLs and strips trailing punctuation', () => {
    const mentions = mentionsFor('Follow https://instagram.com/alpha). Also www.patreon.com/alpha!');
    expect(mentions.map((mention) => mention.rawUrl)).toEqual(['https://instagram.com/alpha', 'www.patreon.com/alpha']);
    expect(mentions.map((mention) => mention.domain)).toEqual(['instagram.com', 'patreon.com']);
  });

  test('extracts bare domains with known TLDs and prefixes them with https', () => {
    const mentions = mentionsFor('Shop at etsy.com/shop/alpha for prints');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].rawUrl).toBe('https://etsy.com/shop/alpha');
    expect(mentions[0].normalizedUrl).toBe('https://etsy.com/shop/alpha');
  });

  test('ignores bare domains that appear inside promo-code context', () => {
    expect(domainsFor('use code gear.shop for a discount')).toEqual([]);
  });

  test('normalises hostnames, lowercases the URL and keeps query strings', () => {
    const [mention] = mentionsFor('Watch https://M.YouTube.com/Watch?v=ABC');
    expect(mention.domain).toBe('youtube.com');
    expect(mention.normalizedUrl).toBe('https://youtube.com/watch?v=abc');
  });

  test('deduplicates identical URLs within a row', () => {
    expect(domainsFor('https://linktr.ee/a and again https://linktr.ee/a')).toEqual(['linktr.ee']);
  });

  test('emits no parsed row for descriptions without links', () => {
    const stageA = buildLinkingStageA([video('v1', 'Just a plain description.'), video('v2', '')], { linkColumn: 'videoDescription' });
    expect(stageA.parsedRows).toEqual([]);
    expect(stageA.totalRows).toBe(2);
  });

  test('marks unparsable http URLs as malformed with an unknown domain', () => {
    const [mention] = mentionsFor('broken http://[bad link');
    expect(mention.malformed).toBe(true);
    expect(mention.domain).toBe('unknown');
    expect(mention.baseBucket).toBe('other');
    expect(mention.reason).toBe('Malformed or unparsable URL fallback.');
  });
});

describe('URL extraction from structured link columns', () => {
  test('parses JSON arrays of URLs', () => {
    const stageA = buildLinkingStageA([{ videoId: 'v1', links: '["https://patreon.com/a","https://ko-fi.com/a"]' }], { linkColumn: 'links' });
    expect(stageA.parsedRows[0].mentions.map((mention) => mention.domain)).toEqual(['patreon.com', 'ko-fi.com']);
  });

  test('parses delimiter-separated URL lists', () => {
    const stageA = buildLinkingStageA([{ videoId: 'v1', urls: 'https://x.com/a; https://tiktok.com/@a | https://discord.gg/abc' }], { linkColumn: 'urls' });
    expect(stageA.parsedRows[0].mentions.map((mention) => mention.domain).sort()).toEqual(['discord.gg', 'tiktok.com', 'x.com']);
  });

  test('rejects promo-code-like tokens in structured columns', () => {
    const stageA = buildLinkingStageA([{ videoId: 'v1', urls: 'SAVE10, https://amazon.com/dp/1' }], { linkColumn: 'urls' });
    expect(stageA.parsedRows[0].mentions.map((mention) => mention.rawUrl)).toEqual(['https://amazon.com/dp/1']);
  });

  test('falls back to a synthetic row id and unknown category when ids are missing', () => {
    const stageA = buildLinkingStageA([{ channelTitle: 'Alpha', urls: 'https://x.com/a' }], { linkColumn: 'urls' });
    expect(stageA.parsedRows[0]).toMatchObject({ rowId: 'Alpha-0', videoId: null, category: 'unknown' });
  });

  test('produces stable fingerprints for the same rows and column', () => {
    const rows = [{ videoId: 'v1', urls: 'https://x.com/a' }];
    const first = buildLinkingStageA(rows, { linkColumn: 'urls' });
    const second = buildLinkingStageA(rows, { linkColumn: 'urls' });
    expect(first.datasetFingerprint).toBe(second.datasetFingerprint);
    expect(first.datasetFingerprint.startsWith('1:')).toBe(true);
    expect(first.stageAFingerprint).toBe(`${first.datasetFingerprint}:urls:1`);
    expect(buildLinkingStageA(rows, { linkColumn: 'other' }).datasetFingerprint).not.toBe(first.datasetFingerprint);
  });
});

describe('domain bucket classification', () => {
  test.each([
    ['https://youtube.com/@a', 'intra-platform'],
    ['https://youtu.be/abc', 'intra-platform'],
    ['https://instagram.com/a', 'cross-platform'],
    ['https://t.me/a', 'cross-platform'],
    ['https://patreon.com/a', 'crowdfunding'],
    ['https://buymeacoffee.com/a', 'crowdfunding'],
    ['https://amazon.co.uk/dp/1', 'marketplace'],
    ['https://amzn.to/abc', 'marketplace'],
    ['https://linktr.ee/a', 'routing'],
    ['https://beacons.ai/a', 'routing'],
    ['https://bit.ly/abc', 'routing'],
    ['https://example.com/a', 'other'],
  ])('classifies %s as %s', (url, bucket) => {
    expect(mentionsFor(url)[0].baseBucket).toBe(bucket);
  });

  test('flags URL shorteners and explains fallback classifications', () => {
    const mentions = mentionsFor('https://bit.ly/abc https://example.com/a');
    expect(mentions[0]).toMatchObject({ shortener: true, reason: 'Matched known URL shortener rule.' });
    expect(mentions[1]).toMatchObject({ shortener: false, reason: 'Fallback classification (unmapped domain).' });
  });
});

describe('buildLinkingStageB dashboard model', () => {
  test('returns an empty model with zero shares for empty input', () => {
    const { model, domainAudit, generatedMetadataByVideoId } = stageBFor([]);
    expect(model.hasLinkedRows).toBe(false);
    expect(model.summary).toEqual({
      linkedRows: 0, totalUrls: 0, uniqueDomains: 0, avgUrlsPerRow: 0, avgDomainsPerRow: 0, shortenerShare: 0, malformedShare: 0,
    });
    expect(model.baseEcology.every((metric) => metric.share === 0)).toBe(true);
    expect(model.recipes).toEqual([]);
    expect(model.matrixRows).toEqual([]);
    expect(domainAudit).toEqual([]);
    expect(generatedMetadataByVideoId).toEqual({});
  });

  test('summarises linked rows, URL counts, shortener and malformed shares', () => {
    const { model } = stageBFor([
      video('v1', 'https://instagram.com/a https://bit.ly/x'),
      video('v2', 'https://instagram.com/a http://[bad'),
      video('v3', 'nothing here'),
    ]);
    expect(model.summary.linkedRows).toBe(2);
    expect(model.summary.totalUrls).toBe(4);
    expect(model.summary.uniqueDomains).toBe(2);
    expect(model.summary.avgUrlsPerRow).toBe(2);
    expect(model.summary.avgDomainsPerRow).toBe(2);
    expect(model.summary.shortenerShare).toBe(0.25);
    expect(model.summary.malformedShare).toBe(0.25);
    expect(model.sourceColumn).toBe('videoDescription');
  });

  test('base ecology shares sum to one across buckets', () => {
    const { model } = stageBFor([video('v1', 'https://instagram.com/a https://patreon.com/a https://linktr.ee/a https://example.com/a')]);
    const shares = Object.fromEntries(model.baseEcology.map((metric) => [metric.key, metric.share]));
    expect(shares).toEqual({
      'cross-platform': 0.25, 'intra-platform': 0, marketplace: 0, crowdfunding: 0.25, routing: 0.25, other: 0.25,
    });
  });

  test('ranks top domains by mentions with per-row intensity', () => {
    const { model } = stageBFor([
      video('v1', 'https://patreon.com/a https://patreon.com/b https://x.com/a'),
      video('v2', 'https://patreon.com/c'),
    ]);
    expect(model.topDomains[0]).toEqual({ rank: 1, domain: 'patreon.com', mentions: 3, rows: 2, intensity: 1.5, ecology: 'crowdfunding' });
    expect(model.topDomains[1]).toMatchObject({ rank: 2, domain: 'x.com', mentions: 1, rows: 1 });
  });

  test('builds a category matrix with the share of linked rows using each strategy', () => {
    const { model } = stageBFor([
      video('v1', 'https://instagram.com/a', { videoCategoryLabel: 'Gaming' }),
      video('v2', 'https://patreon.com/a', { videoCategoryLabel: 'Gaming' }),
      video('v3', 'https://linktr.ee/a', { videoCategoryLabel: 'Music' }),
    ]);
    expect(model.matrixRows.map((row) => [row.label, row.linkedRows])).toEqual([['Gaming', 2], ['Music', 1]]);
    const gaming = Object.fromEntries(model.matrixRows[0].cells.map((cell) => [cell.column, cell.share]));
    expect(gaming).toMatchObject({ 'cross-platform': 0.5, crowdfunding: 0.5, routing: 0 });
  });

  test.each([
    ['https://instagram.com/a https://youtube.com/@a', 'social-only'],
    ['https://instagram.com/a https://patreon.com/a https://linktr.ee/a', 'creator stack'],
    ['https://amazon.com/a https://etsy.com/a https://gumroad.com/a', 'commerce cluster'],
    ['https://linktr.ee/a https://youtube.com/@a', 'hub-first'],
    ['https://patreon.com/a', 'mixed routing'],
  ])('classifies "%s" into the %s recipe', (description, recipe) => {
    const { generatedMetadataByVideoId, rowAudit } = stageBFor([video('v1', description)]);
    expect(generatedMetadataByVideoId.v1.linking_recipe).toBe(recipe);
    expect(rowAudit[0].recipe).toBe(recipe);
  });

  test('aggregates recipe cards with share, average domains and signature domains', () => {
    const { model } = stageBFor([
      video('v1', 'https://instagram.com/a https://youtube.com/@a'),
      video('v2', 'https://instagram.com/b'),
      video('v3', 'https://patreon.com/a'),
    ]);
    const social = model.recipes.find((card) => card.recipe === 'social-only');
    expect(social).toMatchObject({ share: 2 / 3, avgDomains: 1.5, signatureDomains: 'instagram.com, youtube.com' });
    expect(model.recipes[0].recipe).toBe('social-only');
  });

  test('generates per-video linking metadata', () => {
    const { generatedMetadataByVideoId } = stageBFor([video('v1', 'https://bit.ly/x https://instagram.com/a https://instagram.com/b')]);
    expect(generatedMetadataByVideoId.v1).toMatchObject({
      linking_linked: 'yes',
      linking_url_count: 3,
      linking_domain_count: 2,
      linking_shortener_count: 1,
      linking_malformed_count: 0,
      linking_raw_domains: ['bit.ly', 'instagram.com'],
    });
    expect(generatedMetadataByVideoId.v1.linking_base_labels.sort()).toEqual(['cross-platform', 'routing']);
  });

  test('applies manual domain overrides to buckets, reasons and audits', () => {
    const overrides = {
      'example.com': { domain: 'example.com', baseBucket: 'marketplace' as const, note: 'merch', updatedAt: UPDATED_AT },
    };
    const { model, mentionAudit, domainAudit } = stageBFor([video('v1', 'https://www.example.com/a')], 'videoDescription', overrides);
    expect(mentionAudit[0]).toMatchObject({ baseBucket: 'marketplace', autoAssigned: false, reason: 'Manual override: merch' });
    expect(domainAudit[0]).toMatchObject({
      domain: 'example.com',
      autoBaseBucket: 'other',
      currentBaseBucket: 'marketplace',
      overridden: true,
      unmapped: true,
      classificationSource: 'manual',
      overrideNote: 'merch',
      updatedAt: UPDATED_AT,
      autoReason: 'Fallback classification (unmapped domain).',
    });
    expect(model.topDomains[0].ecology).toBe('marketplace');
  });

  test('keeps the auto bucket when an override carries only a note', () => {
    const overrides = { 'patreon.com': { domain: 'patreon.com', note: 'checked', updatedAt: UPDATED_AT } };
    const { domainAudit } = stageBFor([video('v1', 'https://patreon.com/a')], 'videoDescription', overrides);
    expect(domainAudit[0]).toMatchObject({ currentBaseBucket: 'crowdfunding', overridden: true, currentReason: 'Manual override: checked' });
  });

  test('excludes the unknown domain from the domain audit and top domains', () => {
    const { model, domainAudit } = stageBFor([video('v1', 'http://[bad https://x.com/a')]);
    expect(domainAudit.map((entry) => entry.domain)).toEqual(['x.com']);
    expect(model.topDomains.map((entry) => entry.domain)).toEqual(['x.com']);
  });

  test('buildLinkingDashboardModel equals running stage A then stage B', () => {
    const rows = [video('v1', 'https://instagram.com/a https://patreon.com/a'), video('v2', 'https://linktr.ee/a')];
    expect(buildLinkingDashboardModel(rows, { linkColumn: 'videoDescription' })).toEqual(stageBFor(rows).model);
  });
});

describe('async linking stages', () => {
  test('produce the same results as the synchronous stages and report progress', async () => {
    const rows = [video('v1', 'https://instagram.com/a'), video('v2', 'https://patreon.com/a'), video('v3', 'none')];
    const progress: number[] = [];
    const stageA = await buildLinkingStageAAsync(rows, { linkColumn: 'videoDescription' }, (update) => progress.push(update.completed));
    expect(stageA).toEqual(buildLinkingStageA(rows, { linkColumn: 'videoDescription' }));
    expect(progress).toEqual([3]);
    const stageB = await buildLinkingStageBAsync(stageA, { sourceColumn: 'videoDescription' });
    expect(stageB).toEqual(buildLinkingStageB(stageA, { sourceColumn: 'videoDescription' }));
  });
});

describe('detectLinkingColumnCandidates', () => {
  test('returns no candidates for empty input', () => {
    expect(detectLinkingColumnCandidates([])).toEqual([]);
  });

  test('ranks URL-named columns above free-text columns', () => {
    const candidates = detectLinkingColumnCandidates([
      { videoId: 'v1', outbound_urls: 'https://x.com/a', videoDescription: 'see https://x.com/a', viewCount: 5 },
    ]);
    expect(candidates[0].column).toBe('outbound_urls');
    expect(candidates.map((candidate) => candidate.column)).toContain('videoDescription');
    expect(candidates.map((candidate) => candidate.column)).not.toContain('viewCount');
  });

  test('falls back to listing available columns with score 1 when nothing looks link-like', () => {
    const candidates = detectLinkingColumnCandidates([{ videoId: 'v1', viewCount: 5 }]);
    expect(candidates).toEqual([
      { column: 'videoId', score: 1, reason: 'available column' },
      { column: 'viewCount', score: 1, reason: 'available column' },
    ]);
  });
});

describe('aggregateChannelLinkingFromVideoRows', () => {
  const rows = [
    video('v1', 'https://instagram.com/a https://patreon.com/a', { channelId: 'c1' }),
    video('v2', 'https://instagram.com/b', { channelId: 'c1' }),
    video('v3', 'https://linktr.ee/a', { channelId: undefined, channelTitle: 'Beta' }),
    video('v4', 'no links', { channelId: 'c1' }),
  ];
  const { generatedMetadataByVideoId } = stageBFor(rows);
  const aggregate = aggregateChannelLinkingFromVideoRows({ videoRows: rows, generatedMetadataByVideoId });

  test('keys channels by id, falling back to the lowercased channel name', () => {
    expect(Object.keys(aggregate).sort()).toEqual(['id:c1', 'name:beta']);
  });

  test('sums linked videos, URLs and unique domains per channel', () => {
    expect(aggregate['id:c1']).toMatchObject({
      channel_linked_video_count: 2,
      channel_total_urls: 3,
      channel_unique_domains: 2,
      channel_top_domains: 'instagram.com | patreon.com',
      channel_linking_recipe_mix: 'mixed routing:1 | social-only:1',
    });
  });

  test('computes base-bucket shares that sum to one per channel', () => {
    const c1 = aggregate['id:c1'];
    expect(c1.channel_base_share_cross_platform).toBeCloseTo(2 / 3);
    expect(c1.channel_base_share_crowdfunding).toBeCloseTo(1 / 3);
    const shareKeys = Object.keys(c1).filter((key) => key.startsWith('channel_base_share_'));
    expect(shareKeys.reduce((acc, key) => acc + Number(c1[key]), 0)).toBeCloseTo(1);
    expect(aggregate['name:beta'].channel_base_share_routing).toBe(1);
  });

  test('returns an empty object when no rows have generated metadata', () => {
    expect(aggregateChannelLinkingFromVideoRows({ videoRows: rows, generatedMetadataByVideoId: {} })).toEqual({});
    expect(aggregateChannelLinkingFromVideoRows({ videoRows: [], generatedMetadataByVideoId })).toEqual({});
  });

  test('buildChannelLinkingSnapshot wraps the aggregate with a row/metadata fingerprint', () => {
    const snapshot = buildChannelLinkingSnapshot({ rows, generatedMetadataByVideoId });
    expect(snapshot.rowUniverseCount).toBe(4);
    expect(snapshot.datasetFingerprint).toBe('4:3');
    expect(snapshot.byChannelKey).toEqual(aggregate);
    expect(Number.isNaN(Date.parse(snapshot.generatedAt))).toBe(false);
  });
});

describe('profileLinkingColumnCandidates', () => {
  test("ranks descriptions above the videos' own watch links and thumbnails", () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      videoUrl: `https://www.youtube.com/watch?v=video${index}`,
      thumbnail_maxres: `https://i.ytimg.com/vi/video${index}/maxresdefault.jpg`,
      videoDescription: `Follow us https://instagram.com/natgeo and https://www.patreon.com/show${index}`,
    }));
    const ranked = profileLinkingColumnCandidates(rows).map((candidate) => candidate.column);
    expect(ranked[0]).toBe('videoDescription');
    expect(profileLinkingColumnCandidates(rows).find((candidate) => candidate.column === 'videoUrl')?.reason).toContain("videos' own YouTube addresses");
  });
});
