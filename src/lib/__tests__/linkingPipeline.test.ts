import {
  aggregateChannelLinkingFromVideoRows,
  buildLinkingStageA,
  buildLinkingStageB,
  profileLinkingColumnCandidates,
} from '../linkingDashboard';
import { inferIntentFromText } from '../dashboardTemplate';

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const rows = [
  {
    videoId: 'v1',
    channelId: 'c1',
    channelTitle: 'Alpha',
    videoCategoryLabel: 'Education',
    extracted_urls: '["https://instagram.com/acct", "https://linktr.ee/acct"]',
    title: 'New tutorial',
    description: 'How to learn fast. Subscribe and share.',
  },
  {
    videoId: 'v2',
    channelId: 'c1',
    channelTitle: 'Alpha',
    videoCategoryLabel: 'Education',
    extracted_urls: 'https://patreon.com/acct, https://youtube.com/@acct',
    title: 'Community update',
    description: 'join our community and support the channel',
  },
  {
    videoId: 'v3',
    channelId: 'c2',
    channelTitle: 'Beta',
    videoCategoryLabel: 'Gaming',
    extracted_urls: '',
    title: 'Random notes',
    description: 'plain update',
  },
  {
    videoId: 'v4',
    channelId: 'c3',
    channelTitle: 'Gamma',
    videoCategoryLabel: 'Education',
    extracted_urls: 'https://instagram.com/gamma, https://youtube.com/@gamma',
    title: 'Find me on social',
    description: 'follow on instagram and youtube',
  },
];

const candidates = profileLinkingColumnCandidates(rows);
assert(candidates.length > 0, 'Expected linking source candidates');
assert(candidates[0].column === 'extracted_urls', 'Expected extracted_urls to be top linking source candidate');

const stageA = buildLinkingStageA(rows, { linkColumn: 'extracted_urls' });
assert(stageA.sourceColumn === 'extracted_urls', 'Stage A should preserve source column');
assert(stageA.parsedRows.length >= 2, 'Stage A should emit parsed rows for URL-bearing records');

const stageB = buildLinkingStageB(stageA, { sourceColumn: 'extracted_urls' });
assert(stageB.model.summary.linkedRows >= 2, 'Expected at least two linked rows');
assert(stageB.model.summary.totalUrls >= 4, 'Expected URL parsing to detect merged links');
assert(stageB.domainAudit.some((entry) => entry.domain === 'instagram.com'), 'Expected instagram.com in domain audit');
assert(stageB.generatedMetadataByVideoId.v1.linking_linked === 'yes', 'Expected linking metadata for v1');
assert(!('linking_practical_labels' in stageB.generatedMetadataByVideoId.v1), 'Expected practical labels to be removed from generated metadata');
assert(stageB.generatedMetadataByVideoId.v4.linking_recipe === 'social-only', 'Expected cross/intra-only row to classify as social-only');

const stageBWithOverride = buildLinkingStageB(stageA, {
  sourceColumn: 'extracted_urls',
  overridesByDomain: {
    'instagram.com': {
      domain: 'instagram.com',
      baseBucket: 'marketplace',
      updatedAt: new Date().toISOString(),
    },
  },
});
const instagramAudit = stageBWithOverride.domainAudit.find((entry) => entry.domain === 'instagram.com');
assert(instagramAudit?.baseBucket === 'marketplace', 'Expected override to re-bucket instagram.com');
const instagramDomainRow = stageBWithOverride.model.topDomains.find((entry) => entry.domain === 'instagram.com');
assert(instagramDomainRow?.ecology === 'marketplace', 'Expected top-domain ecology to follow current base bucket');

const channelAgg = aggregateChannelLinkingFromVideoRows({
  videoRows: rows,
  generatedMetadataByVideoId: stageB.generatedMetadataByVideoId,
});
assert(channelAgg['id:c1'] != null, 'Expected channel-level aggregate for channel c1');
assert(Number(channelAgg['id:c1'].channel_total_urls || 0) > 0, 'Expected channel URL totals to be populated');

assert(inferIntentFromText('how to build this quickly') === 'tutorial / explainer', 'Expected tutorial intent');
assert(inferIntentFromText('miscellaneous reflections only') === 'other', 'Expected fallback intent = other');

console.log('linkingPipeline.test.ts: ok');
