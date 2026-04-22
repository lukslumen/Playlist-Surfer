import { createProjectManifest } from '../data';
import type {
  ChannelLinkingState,
  ColumnLineageState,
  GeneratedMetadataState,
  LinkingState,
  RowLineageState,
  SourceRegistryState,
  SourceVisibilityState,
} from '../../types';

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const sourceRegistry: SourceRegistryState = {
  byId: {
    'source:base:test': {
      id: 'source:base:test',
      label: 'videos.csv',
      kind: 'base',
      rowCount: 2,
      contributedColumns: ['videoId', 'title'],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  },
  orderedIds: ['source:base:test'],
  primarySourceId: 'source:base:test',
};

const sourceVisibility: SourceVisibilityState = {
  hiddenSourceIds: [],
  hiddenColumnSourceIdsByScope: {
    videos: [],
    channels: [],
  },
};

const rowLineage: RowLineageState = {
  byRowId: {
    v1: { rowId: 'v1', baseSourceId: 'source:base:test', contributorSourceIds: ['source:base:test'] },
    v2: { rowId: 'v2', baseSourceId: 'source:base:test', contributorSourceIds: ['source:base:test'] },
  },
};

const columnLineage: ColumnLineageState = {
  byColumn: {
    videoId: { column: 'videoId', sourceId: 'source:base:test', generated: false, scope: 'videos' },
    content_intent: { column: 'content_intent', sourceId: 'generated:metadata', generated: true, scope: 'videos' },
  },
};

const generatedMetadata: GeneratedMetadataState = {
  byVideoId: {
    v1: { content_intent: 'educational' },
    v2: { content_intent: 'other' },
  },
};

const linkingState: LinkingState = {
  selectedSourceColumn: 'extracted_urls',
  stale: false,
  overrideVersion: 1,
  sourceCandidateProfiles: [],
  parseCacheByKey: {},
  overridesByDomain: {},
  snapshot: null,
};

const channelLinkingState: ChannelLinkingState = {
  stale: true,
  staleReason: 'refresh required',
  snapshot: null,
};

const manifest = createProjectManifest({
  fileName: 'videos.csv',
  projectName: 'test-project',
  schema: [
    { column_name: 'videoId', column_type: 'VARCHAR' },
    { column_name: 'title', column_type: 'VARCHAR' },
  ],
  sourceSchema: [
    { column_name: 'videoId', column_type: 'VARCHAR' },
    { column_name: 'title', column_type: 'VARCHAR' },
  ],
  visibleColumns: ['videoId', 'title'],
  channelVisibleColumns: [],
  savedViews: [],
  activeViewId: null,
  annotations: {},
  projectNotes: '',
  theme: 'warm-light',
  isRightPanelCollapsed: true,
  sourceRegistry,
  sourceVisibility,
  rowLineage,
  columnLineage,
  generatedMetadata,
  linkingState,
  channelLinkingState,
});

assert(manifest.version === 10, 'Manifest must export version 10');
assert(manifest.sourceRegistry?.orderedIds.length === 1, 'Manifest should include source registry');
assert(Boolean(manifest.columnLineage?.byColumn.content_intent), 'Manifest should include column lineage');
assert(manifest.generatedMetadata?.byVideoId.v1.content_intent === 'educational', 'Manifest should persist generated metadata');
assert(manifest.linkingState?.selectedSourceColumn === 'extracted_urls', 'Manifest should persist linking state');
assert(manifest.channelLinkingState?.stale === true, 'Manifest should persist channel linking state');

const hydrated = JSON.parse(JSON.stringify(manifest));
assert(hydrated.version === 10, 'Round-trip manifest should preserve version');
assert(hydrated.generatedMetadata.byVideoId.v2.content_intent === 'other', 'Round-trip should preserve generated metadata');

console.log('manifestV10.test.ts: ok');
