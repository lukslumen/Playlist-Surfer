import { InclusionView, SourceVisibilityState } from '../types';
import { resolveVideoId, resolveChannelId } from './data';

export function buildSourceVisibilityFingerprint(sourceVisibility: SourceVisibilityState) {
  const hiddenRows = [...(sourceVisibility.hiddenSourceIds || [])].sort().join('|');
  const hiddenVideoCols = [...(sourceVisibility.hiddenColumnSourceIdsByScope?.videos || [])].sort().join('|');
  const hiddenChannelCols = [...(sourceVisibility.hiddenColumnSourceIdsByScope?.channels || [])].sort().join('|');
  return `rows:${hiddenRows};videos:${hiddenVideoCols};channels:${hiddenChannelCols}`;
}

export function buildDatasetFingerprint(args: {
  datasetVersion: number;
  inclusionView: InclusionView;
  rowCount: number;
  sourceVisibility: SourceVisibilityState;
}) {
  return [
    `v${args.datasetVersion}`,
    `inc:${args.inclusionView}`,
    `rows:${args.rowCount}`,
    buildSourceVisibilityFingerprint(args.sourceVisibility),
  ].join(';');
}

export function hashFingerprint(seed: number, value: string) {
  let next = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, 16777619) >>> 0;
  }
  return next >>> 0;
}

export function buildStableFingerprint(values: string[]) {
  let hash = 2166136261;
  values.forEach((value) => {
    hash = hashFingerprint(hash, value);
    hash = hashFingerprint(hash, '\n');
  });
  return `${values.length}:${(hash >>> 0).toString(36)}`;
}

export function buildVideoCorpusFingerprint(rows: any[], schema: Array<{ column_name: string; }>) {
  const rowKeys = rows.map((row) => {
    const videoId = resolveVideoId(row) || '';
    const channelId = resolveChannelId(row) || '';
    const views = row?.viewCount ?? row?.view_count ?? row?.views ?? row?.Views ?? '';
    const likes = row?.likeCount ?? row?.like_count ?? row?.likes ?? row?.Likes ?? '';
    const comments = row?.commentCount ?? row?.comment_count ?? row?.comments ?? row?.Comments ?? '';
    const publishedAt = row?.publishedAt ?? row?.published_at ?? row?.publishDate ?? row?.publish_date ?? row?.upload_date ?? row?.date ?? '';
    return `${videoId}|${channelId}|${views}|${likes}|${comments}|${publishedAt}`;
  });
  const schemaKey = schema.map((column) => column.column_name).join('|');
  return `rows:${rows.length};schema:${schema.length}:${buildStableFingerprint([schemaKey, ...rowKeys])}`;
}

export function buildExcludedMembershipFingerprint(videoIds: string[]) {
  const uniqueSorted = Array.from(new Set(videoIds.filter(Boolean))).sort();
  return `excluded:${uniqueSorted.length}:${buildStableFingerprint(uniqueSorted)}`;
}

export function buildChannelMetadataCacheKey(args: {
  videoCorpusFingerprint: string;
  exclusionMembershipFingerprint: string;
  inclusionView: InclusionView;
}) {
  return [
    args.videoCorpusFingerprint,
    args.exclusionMembershipFingerprint,
    `inc:${args.inclusionView}`,
  ].join(';');
}
