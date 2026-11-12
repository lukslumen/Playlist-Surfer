import type {
  Annotation,
  InclusionView,
  ProjectArchiveManifest,
} from '../types';
import type { LastProjectAutosaveSnapshot } from './projectAutosave';
import type { HydrateProjectArgs } from './projectHydration';
import { decodeTextFile } from './archive';
import { mergeAnnotationsWithUserTags } from './userTags';
import { buildLegacyNotesFromAnnotations, extractNotesFromArchive, getArchiveEntry } from './projectNotes';
import {
  buildDefaultProjectSourceState,
  computeSourceVisibilityInclusionCounts,
  createEmptyChannelLinkingState,
  createEmptyColumnLineage,
  createEmptyGeneratedMetadata,
  createEmptyLinkingState,
  createEmptyRowLineage,
  createEmptySourceRegistry,
  createEmptySourceVisibility,
  reconcileSourceVisibility,
  resolveRecoverableInclusionView,
  withSourceRegistryCounts,
} from './projectSourceState';

/** The saved app state as App persists it (see persistedAppState). Fields may be missing in old saves. */
export type SavedAppState = Record<string, any>;

/**
 * Rebuilds the last project from the autosaved rows plus the saved app state (curation, views,
 * lineage...). If the saved inclusion view would show no rows, switches to the other one.
 */
export function planAutosaveRestore(snapshot: LastProjectAutosaveSnapshot, saved: SavedAppState): {
  project: HydrateProjectArgs;
  preferredInclusion: InclusionView;
  recoveredInclusion: InclusionView;
} {
  const mergedAnnotations = mergeAnnotationsWithUserTags(
    (saved.annotations || {}) as Record<string, Annotation>,
    (saved.userTagsByVideoId || {}) as Record<string, string[]>,
  );
  const sourceStateBase = buildDefaultProjectSourceState({
    rows: snapshot.rows,
    schema: snapshot.sourceSchema,
    fileName: snapshot.fileName,
  });
  const nextRowLineage = saved.rowLineage ?? sourceStateBase.rowLineage;
  const nextSourceRegistry = withSourceRegistryCounts({
    sourceRegistry: saved.sourceRegistry ?? sourceStateBase.sourceRegistry,
    rowLineage: nextRowLineage,
    defaultRowCount: snapshot.rows.length,
  });
  const nextSourceVisibility = reconcileSourceVisibility(saved.sourceVisibility ?? sourceStateBase.sourceVisibility, nextSourceRegistry);
  const preferredInclusion: InclusionView = saved.inclusionView === 'excluded' ? 'excluded' : 'included';
  const recoveredInclusion = resolveRecoverableInclusionView({
    preferred: preferredInclusion,
    ...computeSourceVisibilityInclusionCounts({
      rows: snapshot.rows,
      rowLineage: nextRowLineage,
      sourceVisibility: nextSourceVisibility,
      excludedVideoIds: saved.excludedVideoIds ?? [],
    }),
  });

  return {
    preferredInclusion,
    recoveredInclusion,
    project: {
      rows: snapshot.rows,
      schema: snapshot.sourceSchema,
      fileName: snapshot.fileName || undefined,
      visible: saved.visibleColumns,
      channelVisible: saved.channelVisibleColumns,
      videoColumnWidths: saved.videoColumnWidths,
      vernacularExclusions: saved.vernacularExclusions,
      channelColumnWidths: saved.channelColumnWidths,
      annotations: mergedAnnotations,
      notesByVideoId: saved.notesByVideoId,
      channelNotesById: saved.channelNotesById,
      channelTagsById: saved.channelTagsById,
      savedViews: saved.savedViews,
      activeViewId: saved.activeViewId,
      projectOverview: saved.projectOverview,
      projectNotes: saved.projectNotes,
      researchLogSectionComments: saved.researchLogSectionComments,
      researchHistory: saved.researchHistory,
      watchHistoryByVideoId: saved.watchHistoryByVideoId,
      theme: saved.theme,
      isRightPanelCollapsed: saved.isRightPanelCollapsed,
      deletedColumns: saved.deletedColumns,
      specialMappings: saved.specialMappings,
      excludedVideoIds: saved.excludedVideoIds,
      excludedVideoMetaById: saved.excludedVideoMetaById,
      inclusionView: recoveredInclusion,
      dashboardSnapshots: saved.dashboardSnapshots,
      savedViewDashboardSnapshots: saved.savedViewDashboardSnapshots,
      savedViewsVersion: saved.savedViewsVersion ?? 0,
      channelMetadataSnapshot: saved.channelMetadataSnapshot ?? null,
      importedChannelMetadata: saved.importedChannelMetadata ?? null,
      viewScope: saved.viewScope === 'channels' ? 'channels' : 'videos',
      channelFilterModel: saved.channelFilterModel ?? {},
      sourceRegistry: nextSourceRegistry,
      sourceVisibility: nextSourceVisibility,
      rowLineage: nextRowLineage,
      columnLineage: saved.columnLineage ?? sourceStateBase.columnLineage,
      generatedMetadata: saved.generatedMetadata ?? createEmptyGeneratedMetadata(),
      linkingState: saved.linkingState ?? createEmptyLinkingState(),
      channelLinkingState: saved.channelLinkingState ?? createEmptyChannelLinkingState(),
    },
  };
}

export interface UnpackedProjectBackup {
  manifest: ProjectArchiveManifest;
  dataBytes: Uint8Array;
  noteFiles: Record<string, string>;
}

/** Validates an unpacked backup zip: it must hold project.json (archive version 10) and data.csv. */
export function unpackProjectBackup(archiveFiles: Record<string, Uint8Array>): UnpackedProjectBackup {
  const manifestBytes = getArchiveEntry(archiveFiles, 'project.json');
  const dataBytes = getArchiveEntry(archiveFiles, 'data.csv');
  if (!manifestBytes || !dataBytes) throw new Error('This backup is missing project.json or data.csv.');
  const manifest = JSON.parse(decodeTextFile(manifestBytes)) as ProjectArchiveManifest;
  if (manifest.version !== 10) {
    throw new Error(`Unsupported project archive version ${manifest.version}. This build only imports version 10 archives.`);
  }
  return { manifest, dataBytes, noteFiles: extractNotesFromArchive(archiveFiles) };
}

/** Rebuilds a project from a backup's manifest and its parsed data.csv. */
export function planBackupRestore(args: {
  manifest: ProjectArchiveManifest;
  noteFiles: Record<string, string>;
  parsed: { rows: any[]; schema: any[] };
}): HydrateProjectArgs {
  const { manifest, noteFiles, parsed } = args;
  return {
  rows: parsed.rows,
  schema: manifest.sourceSchema || parsed.schema,
  fileName: manifest.originalFileName || 'restored_project.csv',
  visible: manifest.visibleColumns,
  channelVisible: manifest.channelVisibleColumns,
  videoColumnWidths: manifest.videoColumnWidths,
  vernacularExclusions: manifest.vernacularExclusions,
  channelColumnWidths: manifest.channelColumnWidths,
  annotations: manifest.annotations,
  notesByVideoId: Object.keys(noteFiles).length > 0 ? noteFiles : buildLegacyNotesFromAnnotations(manifest.annotations),
  channelNotesById: manifest.channelNotesById ?? {},
  channelTagsById: manifest.channelTagsById ?? {},
  savedViews: manifest.savedViews,
  activeViewId: manifest.activeViewId,
  projectOverview: manifest.projectOverview,
  projectNotes: manifest.projectNotes,
  researchLogSectionComments: manifest.researchLogSectionComments,
  researchHistory: manifest.researchHistory,
  watchHistoryByVideoId: manifest.watchHistoryByVideoId,
  theme: manifest.uiState?.theme,
  isRightPanelCollapsed: manifest.uiState?.isRightPanelCollapsed,
  deletedColumns: manifest.deletedColumns,
  specialMappings: manifest.specialMappings,
  excludedVideoIds: manifest.excluded_videos,
  excludedVideoMetaById: manifest.excludedVideoMetaById,
  inclusionView: 'included',
  dashboardSnapshots: manifest.dashboardSnapshots,
  savedViewDashboardSnapshots: manifest.savedViewDashboardSnapshots,
  savedViewsVersion: manifest.savedViewsVersion ?? 0,
  channelMetadataSnapshot: manifest.channelMetadataSnapshot ?? null,
  importedChannelMetadata: manifest.importedChannelMetadata ?? null,
  viewScope: manifest.viewScope === 'channels' ? 'channels' : 'videos',
  channelSnapshotShouldBeFresh: true,
  sourceRegistry: manifest.sourceRegistry ?? createEmptySourceRegistry(),
  sourceVisibility: manifest.sourceVisibility ?? createEmptySourceVisibility(),
  rowLineage: manifest.rowLineage ?? createEmptyRowLineage(),
  columnLineage: manifest.columnLineage ?? createEmptyColumnLineage(),
  generatedMetadata: manifest.generatedMetadata ?? createEmptyGeneratedMetadata(),
  linkingState: manifest.linkingState ?? createEmptyLinkingState(),
  channelLinkingState: manifest.channelLinkingState ?? createEmptyChannelLinkingState(),
  };
}
