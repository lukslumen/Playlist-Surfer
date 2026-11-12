import type {
  ChannelLinkingState,
  ChannelMetadataRow,
  ChannelMetadataSnapshot,
  ColumnSchema,
  ImportedChannelMetadataState,
  InclusionView,
} from '../types';
import { buildChannelMetadataRows, deriveSchemaFromRows, resolveChannelId, resolveChannelName } from './data';
import { CHANNEL_BASE_SCHEMA, CHANNEL_USER_TAGS_COLUMN } from './columnDefaults';
import { appendNotesBlock } from './projectNotes';
import { resolveChannelRowKey } from './projectSourceState';

/** The channel key a video row belongs to: `id:<channelId>` or `name:<lowercased channel name>`. */
export function videoRowChannelKey(row: any) {
  const channelId = resolveChannelId(row);
  return channelId ? `id:${channelId}` : `name:${resolveChannelName(row).toLowerCase()}`;
}

export interface ChannelMetadataContext {
  datasetVersion: number;
  inclusionView: InclusionView;
  videoCorpusFingerprint: string;
  exclusionMembershipFingerprint: string;
  cacheKey: string;
}

/** A channel metadata snapshot of `rows`, stamped with what it was calculated from. */
export function buildChannelMetadataSnapshot(rows: ChannelMetadataRow[], context: ChannelMetadataContext): ChannelMetadataSnapshot {
  return {
    rows,
    calculatedAt: new Date().toISOString(),
    datasetVersionAtCalculation: context.datasetVersion,
    inclusionViewAtCalculation: context.inclusionView,
    videoCorpusFingerprintAtCalculation: context.videoCorpusFingerprint,
    exclusionMembershipFingerprintAtCalculation: context.exclusionMembershipFingerprint,
    cacheKeyAtCalculation: context.cacheKey,
  };
}

/** Whether a snapshot still matches the current dataset and inclusion state. */
export function isChannelMetadataSnapshotFresh(
  snapshot: ChannelMetadataSnapshot | null | undefined,
  current: Pick<ChannelMetadataContext, 'cacheKey' | 'datasetVersion' | 'inclusionView'>,
) {
  if (!snapshot) return false;
  if (snapshot.cacheKeyAtCalculation) return snapshot.cacheKeyAtCalculation === current.cacheKey;
  return snapshot.datasetVersionAtCalculation === current.datasetVersion && snapshot.inclusionViewAtCalculation === current.inclusionView;
}

/**
 * Channel rows for the channels that appear in `videoRows`: cached rows where available, and rows
 * built on the fly for channels the snapshot doesn't cover yet.
 */
export function scopeChannelRowsToVideos(channelRows: ChannelMetadataRow[], videoRows: any[], imported: ImportedChannelMetadataState | null): ChannelMetadataRow[] {
  if (!channelRows.length || !videoRows.length) return [];
  const scopedKeys = new Set<string>();
  videoRows.forEach((row) => {
    const key = videoRowChannelKey(row);
    if (key) scopedKeys.add(key);
  });
  if (!scopedKeys.size) return [];

  const cached = channelRows.filter((row) => scopedKeys.has(resolveChannelRowKey(row)));
  const covered = new Set(cached.map((row) => resolveChannelRowKey(row)).filter(Boolean));
  const missingVideoRows = videoRows.filter((row) => {
    const key = videoRowChannelKey(row);
    return Boolean(key) && !covered.has(key);
  });
  if (!missingVideoRows.length) return cached;

  const fallback = buildChannelMetadataRows(missingVideoRows, imported).filter((row) => {
    const key = resolveChannelRowKey(row);
    return Boolean(key) && !covered.has(key);
  });
  return [...cached, ...fallback];
}

export function attachChannelUserTags(rows: ChannelMetadataRow[], tagsById: Record<string, string[]>): ChannelMetadataRow[] {
  const hasTags = Object.values(tagsById).some((tags) => Array.isArray(tags) && tags.length > 0);
  if (!rows.length || !hasTags) return rows;
  return rows.map((row) => {
    const key = resolveChannelRowKey(row);
    return { ...row, [CHANNEL_USER_TAGS_COLUMN]: key ? (tagsById[key] || []) : [] };
  });
}

/** Adds link aggregates to channel rows, unless they are stale. */
export function attachChannelLinking(rows: ChannelMetadataRow[], linkingState: ChannelLinkingState): ChannelMetadataRow[] {
  const byChannelKey = linkingState.snapshot?.byChannelKey;
  if (!rows.length || !byChannelKey || linkingState.stale) return rows;
  return rows.map((row) => {
    const linking = byChannelKey[String(row?.channel_key || '')];
    return linking ? { ...row, ...linking } : row;
  });
}

/** Schema of the channel table; the raw `title` column is dropped when `channel_name` exists. */
export function deriveChannelSchema(rows: ChannelMetadataRow[]): ColumnSchema[] {
  const schema = deriveSchemaFromRows(rows, CHANNEL_BASE_SCHEMA);
  const hasChannelName = schema.some((column) => column.column_name === 'channel_name');
  return schema.filter((column) => !(hasChannelName && column.column_name === 'title'));
}

// Channel notes and tags, keyed by channel key. Each returns the same object when nothing changes.

export function setChannelNote(notesById: Record<string, string>, channelKey: string, notes: string) {
  const key = String(channelKey || '').trim();
  if (!key) return notesById;
  if (!notes.trim()) {
    if (!(key in notesById)) return notesById;
    const next = { ...notesById };
    delete next[key];
    return next;
  }
  return notesById[key] === notes ? notesById : { ...notesById, [key]: notes };
}

export function appendChannelNotes(notesById: Record<string, string>, channelKeys: string[], noteBlock: string) {
  const next = { ...notesById };
  channelKeys.forEach((key) => {
    const merged = appendNotesBlock(next[key], noteBlock);
    if (merged.trim()) next[key] = merged;
    else delete next[key];
  });
  return next;
}

export function replaceChannelTags(tagsById: Record<string, string[]>, channelKey: string, tags: string[]) {
  const key = String(channelKey || '').trim();
  if (!key) return tagsById;
  const normalized = Array.from(new Set((tags || []).map((tag) => String(tag || '').trim()).filter(Boolean)));
  if (!normalized.length) {
    if (!(key in tagsById)) return tagsById;
    const next = { ...tagsById };
    delete next[key];
    return next;
  }
  const current = tagsById[key] || [];
  if (current.length === normalized.length && current.every((tag, index) => tag === normalized[index])) return tagsById;
  return { ...tagsById, [key]: normalized };
}

export function addTagToChannels(tagsById: Record<string, string[]>, channelKeys: string[], tag: string) {
  const trimmed = String(tag || '').trim();
  if (!trimmed || !channelKeys.length) return tagsById;
  const next = { ...tagsById };
  channelKeys.forEach((key) => {
    const current = next[key] || [];
    if (!current.includes(trimmed)) next[key] = [...current, trimmed];
  });
  return next;
}

export function removeTagFromChannels(tagsById: Record<string, string[]>, channelKeys: string[], tag: string) {
  const trimmed = String(tag || '').trim();
  if (!trimmed || !channelKeys.length) return tagsById;
  const next = { ...tagsById };
  channelKeys.forEach((key) => {
    const remaining = (next[key] || []).filter((item) => item !== trimmed);
    if (remaining.length) next[key] = remaining;
    else delete next[key];
  });
  return next;
}
