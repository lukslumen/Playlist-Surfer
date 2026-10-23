import type { ChannelLinkingState, GeneratedMetadataState, LinkingSnapshotState, LinkingState } from '../types';
import { aggregateChannelLinkingFromVideoRows, type LinkingStageBResult } from './linkingDashboard';

export const LINKING_DATASET_CHANGED = 'Dataset changed. Refresh linking summary.';
export const CHANNEL_LINKING_DATASET_CHANGED = 'Dataset changed. Refresh channel metadata to rebuild link aggregates.';

/** Cache key for a parsed (stage A) linking result. */
export function linkingParseCacheKey(datasetFingerprint: string, sourceColumn: string) {
  return `${datasetFingerprint}::${sourceColumn}`;
}

/**
 * Marks a linking or channel-linking state stale when the dataset it was calculated from changed.
 * Returns the same object when nothing needs to change.
 */
export function markStaleForDataset<T extends LinkingState | ChannelLinkingState>(state: T, datasetFingerprint: string, reason: string): T {
  if (!state.snapshot || state.snapshot.datasetFingerprint === datasetFingerprint) return state;
  if (state.stale && state.staleReason === reason) return state;
  return { ...state, stale: true, staleReason: reason };
}

/** Writes per-video linking results into generated metadata, keeping each video's content intent. */
export function writeLinkingIntoGeneratedMetadata(
  current: GeneratedMetadataState,
  videoIds: Iterable<string>,
  linkingByVideoId: LinkingStageBResult['generatedMetadataByVideoId'],
  intentByVideoId: Record<string, string>,
): GeneratedMetadataState {
  const byVideoId: GeneratedMetadataState['byVideoId'] = { ...current.byVideoId };
  for (const videoId of videoIds) {
    byVideoId[videoId] = {
      content_intent: intentByVideoId[videoId] || byVideoId[videoId]?.content_intent || 'other',
      linking: linkingByVideoId[videoId],
    };
  }
  return { byVideoId };
}

/** The parts of a linking snapshot that come from a (re)classification run. */
export function linkingSnapshotModel(stageB: LinkingStageBResult): Pick<LinkingSnapshotState, 'hasLinkedRows' | 'model' | 'mentionAudit' | 'domainAudit' | 'rowAudit'> {
  return {
    hasLinkedRows: stageB.model.hasLinkedRows,
    model: stageB.model,
    mentionAudit: stageB.mentionAudit,
    domainAudit: stageB.domainAudit,
    rowAudit: stageB.rowAudit,
  };
}

/**
 * Channel-level link aggregates after linking changed: rebuilt when a channel table exists, otherwise
 * marked stale with `staleReason` so the channels view asks for a refresh.
 */
export function nextChannelLinkingState(args: {
  current: ChannelLinkingState;
  hasChannelMetadata: boolean;
  videoRows: any[];
  linkingByVideoId: LinkingStageBResult['generatedMetadataByVideoId'];
  datasetFingerprint: string;
  staleReason: string;
}): ChannelLinkingState {
  if (!args.hasChannelMetadata) {
    return { ...args.current, stale: true, staleReason: args.staleReason };
  }
  return {
    stale: false,
    staleReason: undefined,
    snapshot: {
      generatedAt: new Date().toISOString(),
      // Same fingerprint the stale check compares against; the old `rows:count` format never
      // matched, so aggregates showed as stale after every reload.
      datasetFingerprint: args.datasetFingerprint,
      rowUniverseCount: args.videoRows.length,
      byChannelKey: aggregateChannelLinkingFromVideoRows({
        videoRows: args.videoRows,
        generatedMetadataByVideoId: args.linkingByVideoId,
      }),
    },
  };
}
