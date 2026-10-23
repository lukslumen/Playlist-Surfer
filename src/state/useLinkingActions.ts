import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import type { ChannelLinkingState, ColumnLineageState, GeneratedMetadataState, LinkingState } from '../types';
import {
  applyLinkingDomainOverride,
  buildLinkingStageAAsync,
  buildLinkingStageB,
  buildLinkingStageBAsync,
  profileLinkingColumnCandidates,
  revertLinkingDomainOverride,
  type LinkingStageAResult,
  type LinkingStageBResult,
} from '../lib/linkingDashboard';
import {
  CHANNEL_LINKING_DATASET_CHANGED,
  LINKING_DATASET_CHANGED,
  linkingParseCacheKey,
  linkingSnapshotModel,
  markStaleForDataset,
  nextChannelLinkingState,
  writeLinkingIntoGeneratedMetadata,
} from '../lib/linkingState';
import { ensureGeneratedColumnLineage } from '../lib/projectSourceState';
import { waitForNextPaint } from '../lib/browser';
import type { LongTaskProgressUpdate } from './useImportFlow';
import type { NewResearchHistoryEvent } from './useResearchHistory';

const OVERRIDE_SAVED_NO_SUMMARY = 'Override saved. Generate linking summary to apply changes.';
const OVERRIDE_SAVED_NO_CACHE = 'Override saved, but parse cache is missing. Refresh linking summary.';
const CHANNEL_STALE_AFTER_OVERRIDE = 'Linking bucket overrides changed. Refresh channel metadata to rebuild channel-level link aggregates.';

/**
 * Linking analysis actions: choose the source column, generate the summary (parse links, classify
 * domains), and apply domain-bucket overrides. Results are written into generated metadata and the
 * channel-level link aggregates; stale markers follow dataset changes.
 */
export function useLinkingActions(args: {
  linkingState: LinkingState;
  setLinkingState: Dispatch<SetStateAction<LinkingState>>;
  setChannelLinkingState: Dispatch<SetStateAction<ChannelLinkingState>>;
  setGeneratedMetadata: Dispatch<SetStateAction<GeneratedMetadataState>>;
  setColumnLineage: Dispatch<SetStateAction<ColumnLineageState>>;
  /** Rows the linking summary is calculated over (whole dataset or filtered view). */
  linkingRows: any[];
  linkingVideoIds: Set<string>;
  linkingDatasetFingerprint: string;
  sourceVisibilityFingerprint: string;
  /** Included video rows, for channel-level aggregates. */
  channelVideoRows: any[];
  channelDatasetFingerprint: string;
  hasChannelMetadata: boolean;
  contentIntentByVideoId: Record<string, string>;
  visibleSourceLabels: string[];
  appendResearchHistory: (event: NewResearchHistoryEvent) => void;
  updateLongTaskProgress: (progress: LongTaskProgressUpdate | null) => void;
}) {
  const {
    linkingState,
    setLinkingState,
    setChannelLinkingState,
    setGeneratedMetadata,
    setColumnLineage,
    linkingRows,
    linkingVideoIds,
    linkingDatasetFingerprint,
    sourceVisibilityFingerprint,
    channelVideoRows,
    channelDatasetFingerprint,
    hasChannelMetadata,
    contentIntentByVideoId,
    visibleSourceLabels,
    appendResearchHistory,
    updateLongTaskProgress,
  } = args;

  // Results calculated from an older dataset are kept but flagged, so the dashboards ask for a refresh.
  useEffect(() => {
    setLinkingState((current) => markStaleForDataset(current, linkingDatasetFingerprint, LINKING_DATASET_CHANGED));
  }, [linkingDatasetFingerprint, setLinkingState]);
  useEffect(() => {
    setChannelLinkingState((current) => markStaleForDataset(current, channelDatasetFingerprint, CHANNEL_LINKING_DATASET_CHANGED));
  }, [channelDatasetFingerprint, setChannelLinkingState]);

  /** Writes a classification result into generated metadata and the channel aggregates. */
  const applyStageB = useCallback((stageB: LinkingStageBResult, channelStaleReason: string) => {
    setGeneratedMetadata((current) => writeLinkingIntoGeneratedMetadata(current, linkingVideoIds, stageB.generatedMetadataByVideoId, contentIntentByVideoId));
    setChannelLinkingState((current) => nextChannelLinkingState({
      current,
      hasChannelMetadata,
      videoRows: channelVideoRows,
      linkingByVideoId: stageB.generatedMetadataByVideoId,
      datasetFingerprint: channelDatasetFingerprint,
      staleReason: channelStaleReason,
    }));
  }, [channelDatasetFingerprint, channelVideoRows, contentIntentByVideoId, hasChannelMetadata, linkingVideoIds, setChannelLinkingState, setGeneratedMetadata]);

  const handleSelectLinkingSource = useCallback((sourceColumn: string) => {
    if (!sourceColumn) return;
    setLinkingState((current) => ({
      ...current,
      selectedSourceColumn: sourceColumn,
      selectedSourceUpdatedAt: new Date().toISOString(),
      sourceCandidateProfiles: profileLinkingColumnCandidates(linkingRows),
    }));
    appendResearchHistory({
      type: 'linking_source_selected',
      summary: `Selected linking source column "${sourceColumn}".`,
      meta: { sourceColumn },
    });
  }, [appendResearchHistory, linkingRows, setLinkingState]);

  const handleGenerateLinkingSummary = useCallback(async (sourceColumn: string) => {
    const selectedColumn = String(sourceColumn || linkingState.selectedSourceColumn || '').trim();
    if (!selectedColumn) return;
    const title = 'Generating linking summary';
    const progress = (detail: string, completed: number) => updateLongTaskProgress({ title, detail, completed, total: 100 });

    progress(`Preparing ${linkingRows.length.toLocaleString()} row(s) from ${selectedColumn}`, 1);
    const cacheKey = linkingParseCacheKey(linkingDatasetFingerprint, selectedColumn);
    try {
      await waitForNextPaint();
      const cachedStageA = linkingState.parseCacheByKey[cacheKey] as LinkingStageAResult | undefined;
      const stageA = cachedStageA && cachedStageA.sourceColumn === selectedColumn
        ? cachedStageA
        : await buildLinkingStageAAsync(linkingRows, { linkColumn: selectedColumn }, (step) => {
            progress(step.detail, Math.min(45, Math.max(1, Math.round((step.completed / Math.max(step.total, 1)) * 45))));
          });
      const nextParseCache = cachedStageA ? linkingState.parseCacheByKey : { ...linkingState.parseCacheByKey, [cacheKey]: stageA };

      progress('Classifying domains and building bucket summaries', cachedStageA ? 45 : 46);
      await waitForNextPaint();
      const stageB = await buildLinkingStageBAsync(stageA, {
        sourceColumn: selectedColumn,
        overridesByDomain: linkingState.overridesByDomain,
      }, (step) => {
        progress(step.detail, Math.min(80, 46 + Math.round((step.completed / Math.max(step.total, 1)) * 34)));
      });

      progress('Writing linking metadata back into the explorer', 86);
      await waitForNextPaint();
      setGeneratedMetadata((current) => writeLinkingIntoGeneratedMetadata(current, linkingVideoIds, stageB.generatedMetadataByVideoId, contentIntentByVideoId));
      setColumnLineage((current) => ensureGeneratedColumnLineage(current));
      setLinkingState((current) => ({
        ...current,
        selectedSourceColumn: selectedColumn,
        selectedSourceUpdatedAt: new Date().toISOString(),
        stale: false,
        staleReason: undefined,
        datasetFingerprint: linkingDatasetFingerprint,
        sourceVisibilityFingerprint,
        parseCacheByKey: nextParseCache,
        sourceCandidateProfiles: profileLinkingColumnCandidates(linkingRows),
        snapshot: {
          sourceColumn: selectedColumn,
          generatedAt: new Date().toISOString(),
          datasetFingerprint: linkingDatasetFingerprint,
          stageAFingerprint: stageA.stageAFingerprint,
          overrideVersion: current.overrideVersion,
          ...linkingSnapshotModel(stageB),
        },
      }));

      progress(hasChannelMetadata
        ? 'Refreshing channel-level link aggregates from the new linking metadata'
        : 'Finishing linking summary', 92);
      await waitForNextPaint();
      setChannelLinkingState((current) => nextChannelLinkingState({
        current,
        hasChannelMetadata,
        videoRows: channelVideoRows,
        linkingByVideoId: stageB.generatedMetadataByVideoId,
        datasetFingerprint: channelDatasetFingerprint,
        staleReason: 'Linking summary changed. Refresh channel metadata to rebuild channel-level link aggregates.',
      }));
      appendResearchHistory({
        type: linkingState.snapshot ? 'linking_summary_refreshed' : 'linking_summary_generated',
        summary: `${linkingState.snapshot ? 'Refreshed' : 'Generated'} linking summary from "${selectedColumn}" (${linkingRows.length.toLocaleString()} rows).`,
        details: `Visible sources: ${visibleSourceLabels.join(', ') || 'none'}.`,
        meta: { sourceColumn: selectedColumn, rowCount: linkingRows.length },
      });
      progress('Done', 100);
      await waitForNextPaint();
    } finally {
      updateLongTaskProgress(null);
    }
  }, [
    appendResearchHistory,
    channelDatasetFingerprint,
    channelVideoRows,
    contentIntentByVideoId,
    hasChannelMetadata,
    linkingDatasetFingerprint,
    linkingRows,
    linkingState.overridesByDomain,
    linkingState.parseCacheByKey,
    linkingState.selectedSourceColumn,
    linkingState.snapshot,
    linkingVideoIds,
    setChannelLinkingState,
    setColumnLineage,
    setGeneratedMetadata,
    setLinkingState,
    sourceVisibilityFingerprint,
    updateLongTaskProgress,
    visibleSourceLabels,
  ]);

  /**
   * Saves new overrides. Without a summary or parse cache they wait for the next generation;
   * otherwise the cached parse is reclassified right away. Returns the stage B result, if any.
   */
  const saveOverrides = useCallback(async (
    nextOverrides: LinkingState['overridesByDomain'],
    nextOverrideVersion: number,
    reclassify: (stageA: LinkingStageAResult, sourceColumn: string) => Promise<LinkingStageBResult> | LinkingStageBResult,
  ): Promise<LinkingStageBResult | null> => {
    const snapshot = linkingState.snapshot;
    const stageA = snapshot
      ? linkingState.parseCacheByKey[linkingParseCacheKey(snapshot.datasetFingerprint, snapshot.sourceColumn)] as LinkingStageAResult | undefined
      : undefined;
    if (!snapshot || !stageA) {
      setLinkingState((current) => ({
        ...current,
        overridesByDomain: nextOverrides,
        overrideVersion: nextOverrideVersion,
        stale: true,
        staleReason: snapshot ? OVERRIDE_SAVED_NO_CACHE : OVERRIDE_SAVED_NO_SUMMARY,
      }));
      return null;
    }
    const stageB = await reclassify(stageA, snapshot.sourceColumn);
    applyStageB(stageB, CHANNEL_STALE_AFTER_OVERRIDE);
    setLinkingState((current) => ({
      ...current,
      overridesByDomain: nextOverrides,
      overrideVersion: nextOverrideVersion,
      stale: false,
      staleReason: undefined,
      snapshot: {
        ...snapshot,
        generatedAt: new Date().toISOString(),
        overrideVersion: nextOverrideVersion,
        ...linkingSnapshotModel(stageB),
      },
    }));
    return stageB;
  }, [applyStageB, linkingState.parseCacheByKey, linkingState.snapshot, setLinkingState]);

  const handleApplyLinkingOverride = useCallback(async (overrideArgs: { domain: string; baseBucket?: string; note?: string; revert?: boolean }) => {
    const domain = String(overrideArgs.domain || '').trim().toLowerCase();
    if (!domain) return;
    const mutation = overrideArgs.revert
      ? revertLinkingDomainOverride({ overridesByDomain: linkingState.overridesByDomain, domain })
      : applyLinkingDomainOverride({
          overridesByDomain: linkingState.overridesByDomain,
          domain,
          baseBucket: overrideArgs.baseBucket as any,
          note: overrideArgs.note,
        });
    const previousAssignment = linkingState.snapshot?.domainAudit?.find((entry: any) => entry.domain === domain);
    const stageB = await saveOverrides(mutation.overridesByDomain, linkingState.overrideVersion + 1, (stageA, sourceColumn) => buildLinkingStageB(stageA, {
      sourceColumn,
      overridesByDomain: mutation.overridesByDomain,
    }));
    const nextAssignment = stageB?.domainAudit.find((entry) => entry.domain === domain);
    const oldBucket = previousAssignment?.currentBaseBucket || previousAssignment?.baseBucket || null;
    const newBucket = nextAssignment?.currentBaseBucket || nextAssignment?.baseBucket || null;
    appendResearchHistory({
      type: (overrideArgs.revert
        ? 'linking_bucket_override_reverted'
        : mutation.previous ? 'linking_bucket_override_changed' : 'linking_bucket_override_created') as any,
      summary: overrideArgs.revert
        ? `Reverted linking override for ${domain}.`
        : mutation.previous ? `Changed linking bucket override for ${domain}.` : `Assigned linking buckets for ${domain}.`,
      details: `Ecology bucket: ${oldBucket || 'auto'} -> ${newBucket || 'auto'}.`,
      meta: { domain, oldBaseBucket: oldBucket, newBaseBucket: newBucket, previouslyUnmapped: Boolean(previousAssignment?.unmapped) },
    });
  }, [appendResearchHistory, linkingState.overrideVersion, linkingState.overridesByDomain, linkingState.snapshot, saveOverrides]);

  const handleApplyLinkingOverrideBatch = useCallback(async (assignments: Array<{ domain: string; baseBucket: string }>) => {
    const cleaned = assignments
      .map((entry) => ({ domain: String(entry.domain || '').trim().toLowerCase(), baseBucket: String(entry.baseBucket || '').trim() || 'other' }))
      .filter((entry) => entry.domain);
    if (!cleaned.length) return;
    let nextOverrides = linkingState.overridesByDomain;
    cleaned.forEach((entry) => {
      nextOverrides = applyLinkingDomainOverride({ overridesByDomain: nextOverrides, domain: entry.domain, baseBucket: entry.baseBucket as any }).overridesByDomain;
    });

    const title = 'Saving ecology buckets';
    const sourceColumn = linkingState.snapshot?.sourceColumn;
    let showedProgress = false;
    try {
      const stageB = await saveOverrides(nextOverrides, linkingState.overrideVersion + cleaned.length, async (stageA, column) => {
        showedProgress = true;
        updateLongTaskProgress({ title, detail: `Applying ${cleaned.length.toLocaleString()} domain reassignment(s)`, completed: 1, total: 100 });
        await waitForNextPaint();
        const result = await buildLinkingStageBAsync(stageA, { sourceColumn: column, overridesByDomain: nextOverrides }, (step) => {
          updateLongTaskProgress({ title, detail: step.detail, completed: Math.min(88, 8 + Math.round((step.completed / Math.max(step.total, 1)) * 80)), total: 100 });
        });
        updateLongTaskProgress({ title, detail: 'Writing updated ecology labels back into the explorer', completed: 92, total: 100 });
        await waitForNextPaint();
        return result;
      });
      appendResearchHistory({
        type: 'linking_bucket_override_changed' as any,
        summary: `Updated ecology buckets for ${cleaned.length} domains.`,
        ...(stageB && sourceColumn
          ? { details: `Selected source: ${sourceColumn}.`, meta: { domainCount: cleaned.length, sourceColumn } }
          : { meta: { domainCount: cleaned.length } }),
      });
      if (stageB) {
        updateLongTaskProgress({ title, detail: 'Done', completed: 100, total: 100 });
        await waitForNextPaint();
      }
    } finally {
      if (showedProgress) updateLongTaskProgress(null);
    }
  }, [appendResearchHistory, linkingState.overrideVersion, linkingState.overridesByDomain, linkingState.snapshot?.sourceColumn, saveOverrides, updateLongTaskProgress]);

  return {
    handleSelectLinkingSource,
    handleGenerateLinkingSummary,
    handleApplyLinkingOverride,
    handleApplyLinkingOverrideBatch,
  };
}
