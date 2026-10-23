import type {
  ColumnLineageState,
  ColumnSchema,
  ImportOptions,
  ResearchHistoryEventType,
  RowLineageState,
  SourceRegistryState,
  SourceVisibilityState,
  SpecialMappings,
} from '../types';
import { applyMerge, deriveSchemaFromRows, resolveVideoId } from './data';
import { profileLinkingColumnCandidates } from './linkingDashboard';
import type { HydrateProjectArgs } from './projectHydration';
import { extractAnnotationsFromRows } from './projectNotes';
import {
  applySupportMappings,
  buildDefaultProjectSourceState,
  buildSourceId,
  createEmptyChannelLinkingState,
  createEmptyGeneratedMetadata,
  createEmptyLinkingState,
  ensureGeneratedColumnLineage,
  GENERATED_SOURCE_ID,
  joinUnique,
  LINKING_GENERATED_COLUMNS,
  normalizeJoinKey,
  reconcileSourceVisibility,
  resolveRowLineageKey,
  withSourceRegistryCounts,
} from './projectSourceState';

/**
 * Pure planning for CSV imports: given the current project and the incoming file, work out the
 * next project state and the research-log entries. App applies the result; the long-task overlay is
 * updated between steps through `progress`.
 */
export const IMPORT_STEP_COUNT = 5;

export type ImportProgress = (detail: string, completed: number, options?: { indeterminate?: boolean }) => Promise<void>;

export interface ImportHistoryEntry {
  type: ResearchHistoryEventType;
  summary: string;
  details?: string;
}

export interface ImportPlan {
  project: HydrateProjectArgs;
  history: ImportHistoryEntry[];
}

export function importProgressTitle(options: ImportOptions, hasRows: boolean) {
  if (options.importKind === 'channelMetadata') return 'Merging channel metadata';
  return options.mode === 'replace' || !hasRows ? 'Importing CSV' : 'Merging CSV';
}

function describeSpecialMappings(mappings: Partial<SpecialMappings>) {
  return `Transcript: ${mappings.transcriptColumn || 'unmapped'}; Description: ${mappings.descriptionColumn || 'unmapped'}; Tags: ${mappings.tagColumn || 'unmapped'}.`;
}

const hasSpecialMappings = (mappings: Partial<SpecialMappings>) => Boolean(mappings.transcriptColumn || mappings.descriptionColumn || mappings.tagColumn);

/** Registry entry for a file that enriches the project (merged rows or channel metadata). */
export function addEnrichmentSource(registry: SourceRegistryState, args: { fileName: string; rowCount: number; columns: string[]; now: string }): SourceRegistryState {
  const sourceId = buildSourceId('source/enrichment', args.fileName);
  return {
    ...registry,
    byId: {
      ...registry.byId,
      [sourceId]: {
        id: sourceId,
        label: args.fileName,
        kind: 'enrichment',
        rowCount: args.rowCount,
        contributedColumns: args.columns,
        createdAt: args.now,
      },
    },
    orderedIds: joinUnique([...registry.orderedIds, sourceId]),
  };
}

/** Replace the project with the incoming CSV. Project-level notes carry over; everything else resets. */
export async function planReplaceImport(args: {
  incomingRows: any[];
  incomingSchema: ColumnSchema[];
  fileName: string;
  options: ImportOptions;
  specialMappings: Partial<SpecialMappings>;
  carryOver: Pick<HydrateProjectArgs, 'projectOverview' | 'projectNotes' | 'researchLogSectionComments'>;
  isFirstDataset: boolean;
  progress: ImportProgress;
}): Promise<ImportPlan> {
  await args.progress('Applying mapped support fields', 2, { indeterminate: true });
  const rows = applySupportMappings(args.incomingRows, args.specialMappings);
  await args.progress('Deriving column schema', 3, { indeterminate: true });
  const schema = deriveSchemaFromRows(rows, args.incomingSchema);
  await args.progress('Rebuilding project state', 4);

  const history: ImportHistoryEntry[] = [{
    type: 'import_replace_completed',
    summary: `Imported ${rows.length.toLocaleString()} rows by replacing the current project with ${args.fileName}.`,
  }];
  if (hasSpecialMappings(args.specialMappings)) {
    history.push({
      type: 'special_mapping_updated',
      summary: 'Special field mappings updated during import.',
      details: describeSpecialMappings(args.specialMappings),
    });
  }

  return {
    project: {
      rows,
      schema,
      fileName: args.fileName,
      visible: args.options.selectedColumns,
      annotations: extractAnnotationsFromRows(rows, {}),
      notesByVideoId: {},
      channelNotesById: {},
      channelTagsById: {},
      savedViews: [],
      activeViewId: null,
      ...args.carryOver,
      researchHistory: [],
      watchHistoryByVideoId: {},
      specialMappings: args.specialMappings,
      excludedVideoIds: [],
      excludedVideoMetaById: {},
      inclusionView: 'included',
      savedViewDashboardSnapshots: {},
      savedViewsVersion: 0,
      channelMetadataSnapshot: null,
      importedChannelMetadata: null,
      viewScope: 'videos',
      autoExpandPanel: args.isFirstDataset,
      generatedMetadata: createEmptyGeneratedMetadata(),
      linkingState: {
        ...createEmptyLinkingState(),
        sourceCandidateProfiles: profileLinkingColumnCandidates(rows),
      },
      channelLinkingState: createEmptyChannelLinkingState(),
    },
    history,
  };
}

export interface ProjectSourceState {
  sourceRegistry: SourceRegistryState;
  rowLineage: RowLineageState;
  columnLineage: ColumnLineageState;
  sourceVisibility: SourceVisibilityState;
}

/**
 * Row and column lineage after merging an incoming file: existing rows keep their base source and
 * gain the incoming file as a contributor when it matched on the join key; new rows belong to it.
 */
export function buildMergedSourceState(args: {
  existingRows: any[];
  existingSourceState: ProjectSourceState;
  mergedRows: any[];
  mergedSchema: ColumnSchema[];
  incomingRows: any[];
  incomingSchema: ColumnSchema[];
  incomingFileName: string;
  joinColumn: string;
  incomingJoinColumn: string;
  now: string;
}): ProjectSourceState {
  const base = args.existingSourceState;
  const incomingSourceId = buildSourceId('source/enrichment', args.incomingFileName);
  const existingByJoin = new Map<string, RowLineageState['byRowId'][string]>();
  const existingByVideoId = new Map<string, RowLineageState['byRowId'][string]>();
  args.existingRows.forEach((row, index) => {
    const lineageEntry = base.rowLineage.byRowId[resolveRowLineageKey(row, index)];
    if (!lineageEntry) return;
    const joinKey = normalizeJoinKey(row?.[args.joinColumn]);
    if (joinKey) existingByJoin.set(joinKey, lineageEntry);
    const videoId = resolveVideoId(row);
    if (videoId) existingByVideoId.set(videoId, lineageEntry);
  });
  const incomingJoinKeys = new Set(
    args.incomingRows.map((row) => normalizeJoinKey(row?.[args.incomingJoinColumn])).filter(Boolean),
  );

  const byRowId: RowLineageState['byRowId'] = {};
  args.mergedRows.forEach((row, index) => {
    const rowId = resolveRowLineageKey(row, index);
    const joinKey = normalizeJoinKey(row?.[args.joinColumn]);
    const videoId = resolveVideoId(row);
    const existing = (joinKey && existingByJoin.get(joinKey)) || (videoId ? existingByVideoId.get(videoId) : undefined);
    byRowId[rowId] = existing
      ? {
          rowId,
          baseSourceId: existing.baseSourceId,
          contributorSourceIds: joinUnique([
            ...(existing.contributorSourceIds || []),
            ...(joinKey && incomingJoinKeys.has(joinKey) ? [incomingSourceId] : []),
          ]),
        }
      : { rowId, baseSourceId: incomingSourceId, contributorSourceIds: [incomingSourceId] };
  });
  const rowLineage: RowLineageState = { byRowId };

  const sourceRegistry = withSourceRegistryCounts({
    sourceRegistry: {
      byId: {
        ...base.sourceRegistry.byId,
        [incomingSourceId]: {
          id: incomingSourceId,
          label: args.incomingFileName,
          kind: 'enrichment',
          rowCount: args.incomingRows.length,
          contributedColumns: args.incomingSchema.map((column) => column.column_name),
          createdAt: args.now,
        },
        [GENERATED_SOURCE_ID]: base.sourceRegistry.byId[GENERATED_SOURCE_ID] || {
          id: GENERATED_SOURCE_ID,
          label: 'Generated metadata',
          kind: 'generated',
          rowCount: 0,
          contributedColumns: ['content_intent', ...LINKING_GENERATED_COLUMNS],
          createdAt: args.now,
        },
      },
      orderedIds: joinUnique([...base.sourceRegistry.orderedIds, incomingSourceId, GENERATED_SOURCE_ID]),
      primarySourceId: base.sourceRegistry.primarySourceId || incomingSourceId,
    },
    rowLineage,
    defaultRowCount: args.mergedRows.length,
  });

  const columnLineage = ensureGeneratedColumnLineage({
    byColumn: Object.fromEntries(args.mergedSchema.map((column) => {
      const previous = base.columnLineage.byColumn[column.column_name];
      if (previous) return [column.column_name, previous];
      return [column.column_name, { column: column.column_name, sourceId: incomingSourceId, generated: false, scope: 'videos' }];
    })),
  });

  return {
    sourceRegistry,
    rowLineage,
    columnLineage,
    sourceVisibility: reconcileSourceVisibility(base.sourceVisibility, sourceRegistry),
  };
}

/** The current project, as far as a merge needs to keep it. */
export type MergeBaseProject = Required<Pick<HydrateProjectArgs,
  | 'videoColumnWidths' | 'channelColumnWidths' | 'annotations' | 'notesByVideoId' | 'channelNotesById' | 'channelTagsById'
  | 'savedViews' | 'activeViewId' | 'projectOverview' | 'projectNotes' | 'researchLogSectionComments' | 'researchHistory'
  | 'watchHistoryByVideoId' | 'specialMappings' | 'deletedColumns' | 'excludedVideoIds' | 'excludedVideoMetaById'
  | 'inclusionView' | 'savedViewDashboardSnapshots' | 'savedViewsVersion' | 'importedChannelMetadata' | 'viewScope'
  | 'sourceRegistry' | 'sourceVisibility' | 'rowLineage' | 'columnLineage' | 'generatedMetadata' | 'linkingState'
  | 'channelLinkingState'>> & {
  rows: any[];
  schema: ColumnSchema[];
  fileName: string | null;
};

/** Merge the incoming CSV into the current project, keeping curation and recording lineage. */
export async function planMergeImport(args: {
  current: MergeBaseProject;
  incomingRows: any[];
  incomingSchema: ColumnSchema[];
  incomingFileName: string;
  options: ImportOptions;
  progress: ImportProgress;
}): Promise<ImportPlan> {
  const { current, options } = args;
  await args.progress('Applying merge rules and resolving conflicts', 2, { indeterminate: true });
  const merge = applyMerge({
    existingRows: current.rows,
    incomingRows: args.incomingRows,
    existingSchema: current.schema,
    incomingSchema: args.incomingSchema,
    joinColumn: options.joinColumn,
    incomingJoinColumn: options.incomingJoinColumn,
    mergeOptions: options.mergeOptions!,
  });

  await args.progress('Updating row lineage and source metadata', 3, { indeterminate: true });
  const existingSourceState: ProjectSourceState = current.sourceRegistry.orderedIds.length
    ? {
        sourceRegistry: current.sourceRegistry,
        rowLineage: current.rowLineage,
        columnLineage: current.columnLineage,
        sourceVisibility: current.sourceVisibility,
      }
    : buildDefaultProjectSourceState({
        rows: current.rows,
        schema: current.schema.length ? current.schema : deriveSchemaFromRows(current.rows),
        fileName: current.fileName || 'dataset.csv',
      });
  const joinColumn = options.joinColumn || 'videoId';
  const sourceState = buildMergedSourceState({
    existingRows: current.rows,
    existingSourceState,
    mergedRows: merge.rows,
    mergedSchema: merge.schema,
    incomingRows: args.incomingRows,
    incomingSchema: args.incomingSchema,
    incomingFileName: args.incomingFileName,
    joinColumn,
    incomingJoinColumn: options.incomingJoinColumn || joinColumn,
    now: new Date().toISOString(),
  });

  await args.progress('Rebuilding project state', 4);
  const mergeMappings = options.mergeOptions?.specialMappings || {};
  const history: ImportHistoryEntry[] = [{
    type: 'import_merge_completed',
    summary: `Merged ${args.incomingRows.length.toLocaleString()} incoming rows into ${current.rows.length.toLocaleString()} existing rows.`,
    details: `Project key: ${options.joinColumn || 'n/a'}; incoming key: ${options.incomingJoinColumn || options.joinColumn || 'n/a'}; mode: ${options.mergeOptions?.mergeMode || 'add-update'}.`,
  }];
  if (hasSpecialMappings(mergeMappings)) {
    history.push({
      type: 'special_mapping_updated',
      summary: 'Special field mappings updated during merge.',
      details: describeSpecialMappings(mergeMappings),
    });
  }

  const { rows: _rows, schema: _schema, fileName, annotations, ...kept } = current;
  return {
    project: {
      ...kept,
      rows: merge.rows,
      schema: merge.schema,
      fileName: fileName || args.incomingFileName,
      visible: options.selectedColumns,
      annotations: extractAnnotationsFromRows(merge.rows, annotations),
      specialMappings: options.mergeOptions?.specialMappings || current.specialMappings,
      channelMetadataSnapshot: null,
      ...sourceState,
      linkingState: {
        ...current.linkingState,
        stale: true,
        staleReason: 'Source rows changed after merge. Refresh linking summary.',
        sourceCandidateProfiles: profileLinkingColumnCandidates(merge.rows),
      },
      channelLinkingState: {
        ...current.channelLinkingState,
        stale: true,
        staleReason: 'Source rows changed after merge. Refresh channel metadata to rebuild link aggregates.',
      },
    },
    history,
  };
}
