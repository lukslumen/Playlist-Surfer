import {
  ChannelLinkingState,
  ColumnLineageState,
  GeneratedMetadataState,
  InclusionView,
  LinkingState,
  RowLineageState,
  SourceRegistryState,
  SourceVisibilityState,
  SpecialMappings,
} from '../types';
import {
  partitionRowsByInclusion,
  resolveVideoId,
  sanitizeFileName,
  VIDEO_DESCRIPTION_COLUMN,
  TRANSCRIPT_COLUMN,
} from './data';
import { parseListString } from './filterCoordinator';

export const GENERATED_SOURCE_ID = 'generated:metadata';

export const LINKING_GENERATED_COLUMNS = [
  'linking_linked',
  'linking_url_count',
  'linking_domain_count',
  'linking_base_labels',
  'linking_recipe',
  'linking_top_domains',
  'linking_malformed_count',
  'linking_shortener_count',
  'linking_raw_links',
  'linking_raw_domains',
];

export const LINKING_FILTER_COLUMNS = new Set<string>([
  ...LINKING_GENERATED_COLUMNS,
]);

export function buildSourceId(prefix: string, label: string) {
  const slug = sanitizeFileName(label || 'source', 'source')
    .replace(/\.csv$/i, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${prefix}:${slug || 'source'}:${Date.now().toString(36)}`;
}

export function createEmptySourceRegistry(): SourceRegistryState {
  return {
    byId: {},
    orderedIds: [],
    primarySourceId: null,
  };
}

export function createEmptySourceVisibility(): SourceVisibilityState {
  return {
    hiddenSourceIds: [],
    hiddenColumnSourceIdsByScope: {
      videos: [],
      channels: [],
    },
  };
}

export function createEmptyRowLineage(): RowLineageState {
  return { byRowId: {} };
}

export function createEmptyColumnLineage(): ColumnLineageState {
  return { byColumn: {} };
}

export function createEmptyGeneratedMetadata(): GeneratedMetadataState {
  return { byVideoId: {} };
}

export function createEmptyLinkingState(): LinkingState {
  return {
    selectedSourceColumn: null,
    stale: false,
    staleReason: undefined,
    datasetFingerprint: undefined,
    sourceVisibilityFingerprint: undefined,
    overrideVersion: 0,
    sourceCandidateProfiles: [],
    parseCacheByKey: {},
    overridesByDomain: {},
    snapshot: null,
  };
}

export function createEmptyChannelLinkingState(): ChannelLinkingState {
  return {
    stale: false,
    staleReason: undefined,
    snapshot: null,
  };
}

export function resolveRowLineageKey(row: any, index: number) {
  return resolveVideoId(row) || `row:${index}`;
}

export function resolveChannelRowKey(row: any) {
  return String(row?.channel_key || row?.channel_id || row?.channel_name || '').trim();
}

export function joinUnique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function resolveRecoverableInclusionView(args: {
  preferred: InclusionView;
  includedRowCount: number;
  excludedRowCount: number;
}): InclusionView {
  const { preferred, includedRowCount, excludedRowCount } = args;
  if (preferred === 'included' && includedRowCount === 0 && excludedRowCount > 0) return 'excluded';
  if (preferred === 'excluded' && excludedRowCount === 0 && includedRowCount > 0) return 'included';
  return preferred;
}

export function computeSourceVisibilityInclusionCounts(args: {
  rows: any[];
  rowLineage: RowLineageState;
  sourceVisibility: SourceVisibilityState;
  excludedVideoIds: string[];
}) {
  const hiddenSourceIdSet = new Set(args.sourceVisibility.hiddenSourceIds || []);
  const sourceMaskedRows = hiddenSourceIdSet.size
    ? args.rows.filter((row, index) => {
      const rowId = resolveRowLineageKey(row, index);
      const lineage = args.rowLineage.byRowId[rowId];
      if (!lineage?.baseSourceId) return true;
      return !hiddenSourceIdSet.has(lineage.baseSourceId);
    })
    : args.rows;

  const partition = partitionRowsByInclusion(sourceMaskedRows, new Set(args.excludedVideoIds || []));
  return {
    includedRowCount: partition.included.length,
    excludedRowCount: partition.excluded.length,
  };
}

export function flattenGeneratedMetadataForOverlay(entry: GeneratedMetadataState['byVideoId'][string] | undefined) {
  if (!entry) return null;
  const linking = entry.linking;
  return {
    content_intent: entry.content_intent || 'other',
    linking_linked: linking?.linking_linked || 'no',
    linking_url_count: linking?.linking_url_count ?? 0,
    linking_domain_count: linking?.linking_domain_count ?? 0,
    linking_base_labels: linking?.linking_base_labels ?? [],
    linking_recipe: linking?.linking_recipe || 'none',
    linking_top_domains: linking?.linking_top_domains ?? [],
    linking_malformed_count: linking?.linking_malformed_count ?? 0,
    linking_shortener_count: linking?.linking_shortener_count ?? 0,
    linking_raw_links: linking?.linking_raw_links ?? [],
    linking_raw_domains: linking?.linking_raw_domains ?? [],
  };
}

export function normalizeJoinKey(value: unknown) {
  const text = String(value ?? '').trim();
  return text ? text.toLowerCase() : '';
}

export function ensureGeneratedColumnLineage(lineage: ColumnLineageState): ColumnLineageState {
  const next = { ...lineage.byColumn };
  if (!next.content_intent) {
    next.content_intent = { column: 'content_intent', sourceId: GENERATED_SOURCE_ID, generated: true, scope: 'videos' };
  }
  LINKING_GENERATED_COLUMNS.forEach((column) => {
    if (!next[column]) {
      next[column] = { column, sourceId: GENERATED_SOURCE_ID, generated: true, scope: 'videos' };
    }
  });
  const channelColumns = [
    'channel_linked_video_count',
    'channel_total_urls',
    'channel_unique_domains',
    'channel_top_domains',
    'channel_linking_recipe_mix',
    'channel_base_share_cross_platform',
    'channel_base_share_intra_platform',
    'channel_base_share_marketplace',
    'channel_base_share_crowdfunding',
    'channel_base_share_routing',
    'channel_base_share_other',
  ];
  channelColumns.forEach((column) => {
    if (!next[column]) {
      next[column] = { column, sourceId: GENERATED_SOURCE_ID, generated: true, scope: 'channels' };
    }
  });
  return { byColumn: next };
}

export function withSourceRegistryCounts(args: {
  sourceRegistry: SourceRegistryState;
  rowLineage: RowLineageState;
  defaultRowCount?: number;
}) {
  const counts = new Map<string, number>();
  Object.values(args.rowLineage.byRowId).forEach((entry) => {
    if (!entry.baseSourceId) return;
    counts.set(entry.baseSourceId, (counts.get(entry.baseSourceId) || 0) + 1);
  });
  const byId: SourceRegistryState['byId'] = {};
  Object.entries(args.sourceRegistry.byId).forEach(([sourceId, source]) => {
    byId[sourceId] = {
      ...source,
      rowCount: counts.has(sourceId)
        ? (counts.get(sourceId) || 0)
        : (source.kind === 'base' ? (args.defaultRowCount ?? source.rowCount) : source.rowCount),
    };
  });
  return {
    ...args.sourceRegistry,
    byId,
  };
}

export function buildDefaultProjectSourceState(args: {
  rows: any[];
  schema: Array<{ column_name: string; }>;
  fileName: string | null;
}) {
  const now = new Date().toISOString();
  const baseSourceId = buildSourceId('source/base', args.fileName || 'dataset');
  const sourceRegistry: SourceRegistryState = {
    byId: {
      [baseSourceId]: {
        id: baseSourceId,
        label: args.fileName || 'dataset.csv',
        kind: 'base',
        rowCount: args.rows.length,
        contributedColumns: args.schema.map((column) => column.column_name),
        createdAt: now,
      },
      [GENERATED_SOURCE_ID]: {
        id: GENERATED_SOURCE_ID,
        label: 'Generated metadata',
        kind: 'generated',
        rowCount: 0,
        contributedColumns: ['content_intent', ...LINKING_GENERATED_COLUMNS],
        createdAt: now,
      },
    },
    orderedIds: [baseSourceId, GENERATED_SOURCE_ID],
    primarySourceId: baseSourceId,
  };
  const rowLineage: RowLineageState = {
    byRowId: Object.fromEntries(
      args.rows.map((row, index) => {
        const rowId = resolveRowLineageKey(row, index);
        return [rowId, { rowId, baseSourceId, contributorSourceIds: [baseSourceId] }];
      })
    ),
  };
  const columnLineage: ColumnLineageState = ensureGeneratedColumnLineage({
    byColumn: Object.fromEntries(
      args.schema.map((column) => ([
        column.column_name,
        {
          column: column.column_name,
          sourceId: baseSourceId,
          generated: false,
          scope: 'videos',
        },
      ]))
    ),
  });
  return {
    sourceRegistry,
    sourceVisibility: createEmptySourceVisibility(),
    rowLineage,
    columnLineage,
  };
}

export function reconcileSourceVisibility(sourceVisibility: SourceVisibilityState, sourceRegistry: SourceRegistryState): SourceVisibilityState {
  const validIds = new Set(sourceRegistry.orderedIds);
  return {
    hiddenSourceIds: (sourceVisibility.hiddenSourceIds || []).filter((id) => validIds.has(id)),
    hiddenColumnSourceIdsByScope: {
      videos: (sourceVisibility.hiddenColumnSourceIdsByScope?.videos || []).filter((id) => validIds.has(id)),
      channels: (sourceVisibility.hiddenColumnSourceIdsByScope?.channels || []).filter((id) => validIds.has(id)),
    },
  };
}

export function applySupportMappings(
  rows: any[],
  mappings: Partial<SpecialMappings> = {},
  options: {
    previousMappings?: Partial<SpecialMappings>;
    sourceSchemaColumns?: Set<string>;
  } = {}) {
  const previousMappings = options.previousMappings || {};
  const sourceSchemaColumns = options.sourceSchemaColumns;
  return rows.map((row) => {
    const next = { ...row };
    if (mappings.transcriptColumn && mappings.transcriptColumn in row) {
      next[TRANSCRIPT_COLUMN] = row[mappings.transcriptColumn];
    } else if (previousMappings.transcriptColumn
      && previousMappings.transcriptColumn !== TRANSCRIPT_COLUMN
      && !sourceSchemaColumns?.has(TRANSCRIPT_COLUMN)) {
      delete next[TRANSCRIPT_COLUMN];
    }
    if (mappings.descriptionColumn && mappings.descriptionColumn in row) {
      next[VIDEO_DESCRIPTION_COLUMN] = row[mappings.descriptionColumn];
    } else if (previousMappings.descriptionColumn
      && previousMappings.descriptionColumn !== VIDEO_DESCRIPTION_COLUMN
      && !sourceSchemaColumns?.has(VIDEO_DESCRIPTION_COLUMN)) {
      delete next[VIDEO_DESCRIPTION_COLUMN];
    }
    if (mappings.tagColumn && mappings.tagColumn in row) {
      next.videoTags = parseListString(row[mappings.tagColumn]);
    } else if (previousMappings.tagColumn
      && previousMappings.tagColumn !== 'videoTags'
      && !sourceSchemaColumns?.has('videoTags')) {
      delete next.videoTags;
    }
    return next;
  });
}
