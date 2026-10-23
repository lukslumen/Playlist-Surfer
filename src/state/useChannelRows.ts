import { useMemo } from 'react';
import type { ChannelLinkingState, ChannelMetadataSnapshot, ImportedChannelMetadataState } from '../types';
import { mergeChannelMetadataRows } from '../lib/data';
import { buildUnifiedFilterState, detectBooleanMapColumns, detectListLikeColumns, type ExplorerFilterModel } from '../lib/filterCoordinator';
import { attachChannelLinking, attachChannelUserTags, deriveChannelSchema, scopeChannelRowsToVideos } from '../lib/channelMetadata';

/**
 * The channel table: rows from the metadata snapshot (plus imported channel metadata), limited to
 * channels of the videos in view, with user tags and link aggregates attached, then filtered.
 */
export function useChannelRows(args: {
  snapshot: ChannelMetadataSnapshot | null;
  importedChannelMetadata: ImportedChannelMetadataState | null;
  /** Video rows currently in view (included or excluded list). */
  videoRows: any[];
  channelTagsById: Record<string, string[]>;
  channelLinkingState: ChannelLinkingState;
  channelFilterModel: ExplorerFilterModel;
}) {
  const { snapshot, importedChannelMetadata, videoRows, channelTagsById, channelLinkingState, channelFilterModel } = args;
  const channelRows = useMemo(
    () => (snapshot?.rows?.length ? mergeChannelMetadataRows(snapshot.rows, importedChannelMetadata) : []),
    [importedChannelMetadata, snapshot],
  );
  const hasChannelUserTags = useMemo(
    () => Object.values(channelTagsById).some((tags) => Array.isArray(tags) && tags.length > 0),
    [channelTagsById],
  );
  const scopedChannelRows = useMemo(
    () => scopeChannelRowsToVideos(channelRows, videoRows, importedChannelMetadata),
    [channelRows, importedChannelMetadata, videoRows],
  );
  const channelRowsWithTags = useMemo(() => attachChannelUserTags(scopedChannelRows, channelTagsById), [channelTagsById, scopedChannelRows]);
  const channelRowsWithLinking = useMemo(() => attachChannelLinking(channelRowsWithTags, channelLinkingState), [channelLinkingState, channelRowsWithTags]);
  const channelSchema = useMemo(() => deriveChannelSchema(channelRowsWithLinking), [channelRowsWithLinking]);
  const channelBooleanMapColumns = useMemo(() => detectBooleanMapColumns(channelRowsWithLinking, channelSchema), [channelRowsWithLinking, channelSchema]);
  const channelListLikeColumns = useMemo(
    () => detectListLikeColumns(channelRowsWithLinking, channelSchema, channelBooleanMapColumns),
    [channelBooleanMapColumns, channelRowsWithLinking, channelSchema],
  );
  const filterState = useMemo(() => buildUnifiedFilterState({
    rows: channelRowsWithLinking,
    schema: channelSchema,
    filterModel: channelFilterModel,
    listLikeColumns: channelListLikeColumns,
    booleanMapColumns: channelBooleanMapColumns,
  }), [channelBooleanMapColumns, channelFilterModel, channelListLikeColumns, channelRowsWithLinking, channelSchema]);

  return {
    channelRows,
    hasChannelUserTags,
    channelRowsWithLinking,
    channelSchema,
    channelBooleanMapColumns,
    channelListLikeColumns,
    filteredChannelRows: filterState.filteredRows,
    channelFilteredColumns: filterState.filteredColumns,
  };
}
