import {
  Annotation,
  ChannelMetadataImportAuditEntry,
  ChannelMetadataRelationshipType,
  ChannelMetadataSnapshot,
  ChannelMetadataRow,
  ColumnSchema,
  ConflictStrategy,
  DashboardThumbnailCacheIndex,
  DuplicateGroup,
  ExcludedVideoMeta,
  GeneratedMetadataState,
  ImportedChannelMetadataState,
  InclusionView,
  ImportKind,
  LinkingState,
  MergeOptions,
  MergePreview,
  ChannelLinkingState,
  ColumnLineageState,
  ProjectArchiveManifest,
  QuoteRef,
  ResearchHistoryEvent,
  RowLineageState,
  ResearchLogCommentSectionId,
  SavedViewDashboardSnapshot,
  RowConflictChoice,
  SourceRegistryState,
  SourceVisibilityState,
  ThemeMode,
  TimestampRef,
  ViewScope,
  WatchHistoryEntry,
} from '../types';

export const USER_TAGS_COLUMN = 'user_tags';
export const NOTES_COLUMN = 'notes';
export const TRANSCRIPT_COLUMN = 'transcript';
export const VIDEO_DESCRIPTION_COLUMN = 'videoDescription';
const MANAGED_HEADINGS = ['Transcript Quotes', 'Timestamps'];
const YOUTUBE_VIDEO_URL_PREFIX = 'https://www.youtube.com/watch?v=';
const YOUTUBE_CHANNEL_URL_PREFIX = 'https://www.youtube.com/channel/';

export type BatchCopyExportMode = 'videoIds' | 'videoUrls' | 'channelIds' | 'channelUrls';

export interface BatchCopyClipboardPayload {
  mode: BatchCopyExportMode;
  values: string[];
  text: string;
}

function normalizeListValues(val: any): string[] {
  if (val === null || val === undefined) return [];
  if (Array.isArray(val)) return val.map((item) => String(item).trim()).filter(Boolean);
  if (typeof val !== 'string') return [String(val).trim()].filter(Boolean);

  const trimmed = val.trim();
  if (!trimmed || trimmed === '[]') return [];

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, '').trim())
        .filter(Boolean);
    }
  }

  return trimmed
    .split(/[|,;]/)
    .map((item) => item.trim().replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
}

export function normalizeColumnName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}


export type FriendlyImportSchemaId = 'youtube-data-tools-channelsearch' | 'youtube-data-tools-videolist';

type FriendlyImportSchemaConfig = {
  id: FriendlyImportSchemaId;
  filenamePattern: RegExp;
  signature: string[];
  mapping: Record<string, string>;
  semanticHints?: Record<string, ColumnSchema['semantic_type']>;
  widthHints?: Record<string, NonNullable<ColumnSchema['width_hint']>>;
};

const YOUTUBE_DATA_TOOLS_CHANNELSEARCH_MAPPING: Record<string, string> = {
  position: 'Search Ranking',
  id: 'Channel ID',
  title: 'Channel Name',
  description: 'Channel Description',
  publishedAt: 'Channel Created At',
  defaultLanguage: 'Default Language',
  country: 'Channel Country',
  viewCount: 'Total Views',
  subscriberCount: 'Subscribers',
  videoCount: 'Total Videos',
  thumbnail: 'Thumbnail URL',
  keywords: 'Keywords',
  topicDetails: 'Topics',
};

const YOUTUBE_DATA_TOOLS_VIDEOLIST_MAPPING: Record<string, string> = {
  position: 'Search Ranking',
  channelId: 'Channel ID',
  channelTitle: 'Channel Name',
  videoId: 'Video ID',
  publishedAt: 'Published At',
  publishedAtSQL: 'Published At (SQL)',
  videoTitle: 'Video Title',
  videoDescription: 'Video Description',
  tags: 'Tags',
  videoCategoryId: 'Category ID',
  videoCategoryLabel: 'Category',
  topicCategories: 'Topics',
  duration: 'Duration (ISO 8601)',
  durationSec: 'Duration (Seconds)',
  dimension: 'Video Dimension',
  definition: 'Video Quality',
  caption: 'Has Captions',
  defaultLanguage: 'Default Language',
  defaultLAudioLanguage: 'Default Audio Language',
  thumbnail_maxres: 'Thumbnail URL',
  licensedContent: 'Licensed Content',
  hasPaidProductPlacement: 'Paid Product Placement',
  locationDescription: 'Location Description',
  latitude: 'Latitude',
  longitude: 'Longitude',
  viewCount: 'Views',
  likeCount: 'Likes',
  dislikeCount: 'Dislikes',
  favoriteCount: 'Favorites',
  commentCount: 'Comments',
};

const SHARED_SEMANTIC_HINTS: Record<string, ColumnSchema['semantic_type']> = {
  position: 'rank',
  id: 'channel-id',
  channelId: 'channel-id',
  videoId: 'video-id',
  title: 'channel-name',
  channelTitle: 'channel-name',
  videoTitle: 'video-title',
  description: 'description',
  videoDescription: 'description',
  publishedAt: 'date-time',
  publishedAtSQL: 'date-time',
  duration: 'duration',
  durationSec: 'duration-seconds',
  viewCount: 'count',
  subscriberCount: 'count',
  videoCount: 'count',
  likeCount: 'count',
  dislikeCount: 'count',
  favoriteCount: 'count',
  commentCount: 'count',
  country: 'country',
  defaultLanguage: 'language',
  defaultLAudioLanguage: 'language',
  caption: 'boolean',
  licensedContent: 'boolean',
  hasPaidProductPlacement: 'boolean',
  definition: 'short-text',
  dimension: 'short-text',
  keywords: 'keywords',
  topicDetails: 'topics',
  topicCategories: 'topics',
  thumbnail: 'url',
  thumbnail_maxres: 'url',
  locationDescription: 'location',
  latitude: 'geo',
  longitude: 'geo',
};

const SHARED_WIDTH_HINTS: Record<string, NonNullable<ColumnSchema['width_hint']>> = {
  position: 'tiny',
  duration: 'small',
  durationSec: 'small',
  caption: 'small',
  country: 'small',
  definition: 'small',
  dimension: 'small',
  licensedContent: 'small',
  hasPaidProductPlacement: 'small',
  defaultLanguage: 'small',
  defaultLAudioLanguage: 'small',
  latitude: 'small',
  longitude: 'small',
  publishedAt: 'medium',
  publishedAtSQL: 'medium',
  id: 'medium',
  channelId: 'medium',
  videoId: 'medium',
  thumbnail: 'medium',
  thumbnail_maxres: 'medium',
  title: 'wide',
  channelTitle: 'wide',
  videoTitle: 'wide',
  description: 'xwide',
  videoDescription: 'xwide',
  keywords: 'wide',
  topicDetails: 'wide',
  topicCategories: 'wide',
};

const FRIENDLY_IMPORT_SCHEMAS: FriendlyImportSchemaConfig[] = [
  {
    id: 'youtube-data-tools-channelsearch',
    filenamePattern: /channelsearch/i,
    signature: ['id', 'title', 'subscriberCount', 'videoCount', 'topicDetails'],
    mapping: YOUTUBE_DATA_TOOLS_CHANNELSEARCH_MAPPING,
    semanticHints: SHARED_SEMANTIC_HINTS,
    widthHints: SHARED_WIDTH_HINTS,
  },
  {
    id: 'youtube-data-tools-videolist',
    filenamePattern: /videolist/i,
    signature: ['videoId', 'channelId', 'videoTitle', 'durationSec', 'commentCount'],
    mapping: YOUTUBE_DATA_TOOLS_VIDEOLIST_MAPPING,
    semanticHints: SHARED_SEMANTIC_HINTS,
    widthHints: SHARED_WIDTH_HINTS,
  },
];

function titleCaseWords(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function buildUniqueDisplayNames(columns: Array<{ raw: string; proposed: string }>) {
  const counts = new Map<string, number>();
  return columns.map(({ raw, proposed }) => {
    const base = (proposed || raw).trim() || raw;
    const seen = counts.get(base) || 0;
    counts.set(base, seen + 1);
    return seen === 0 ? base : `${base} (${seen + 1})`;
  });
}

export function detectFriendlyImportSchema(schema: { column_name: string }[], fileName = ''): FriendlyImportSchemaId | null {
  const normalizedNames = new Set(schema.map((column) => normalizeColumnName(column.column_name)));
  const lowerName = fileName.toLowerCase();
  let best: { id: FriendlyImportSchemaId; score: number } | null = null;

  FRIENDLY_IMPORT_SCHEMAS.forEach((candidate) => {
    const headerHits = candidate.signature.filter((column) => normalizedNames.has(normalizeColumnName(column))).length;
    const filenameBonus = candidate.filenamePattern.test(lowerName) ? 2 : 0;
    const score = headerHits + filenameBonus;
    const headerStrong = headerHits >= Math.max(3, Math.min(candidate.signature.length, 4));
    if (!filenameBonus && !headerStrong) return;
    if (!best || score > best.score) {
      best = { id: candidate.id, score };
    }
  });

  return best?.id || null;
}

function getFriendlyImportSchemaConfig(schema: { column_name: string }[], fileName = '') {
  const detected = detectFriendlyImportSchema(schema, fileName);
  return FRIENDLY_IMPORT_SCHEMAS.find((entry) => entry.id === detected) || null;
}

export function applyFriendlyColumnMappings(schema: ColumnSchema[], fileName = ''): ColumnSchema[] {
  const config = getFriendlyImportSchemaConfig(schema, fileName);
  if (!config) {
    return schema.map((column) => ({
      ...column,
      source_column_name: column.source_column_name || column.column_name,
    }));
  }

  const uniqueDisplayNames = buildUniqueDisplayNames(schema.map((column) => ({
    raw: column.source_column_name || column.column_name,
    proposed: config.mapping[column.source_column_name || column.column_name] || column.display_column_name || column.column_name,
  })));

  return schema.map((column, index) => {
    const sourceColumnName = column.source_column_name || column.column_name;
    return {
      ...column,
      source_column_name: sourceColumnName,
      display_column_name: uniqueDisplayNames[index],
      detected_schema: config.id,
      semantic_type: column.semantic_type || config.semanticHints?.[sourceColumnName] || column.semantic_type,
      width_hint: column.width_hint || config.widthHints?.[sourceColumnName] || column.width_hint,
    };
  });
}

function inferFriendlyDisplayName(column: Pick<ColumnSchema, 'column_name' | 'display_column_name' | 'source_column_name' | 'semantic_type'>, schema?: ColumnSchema[]): string {
  if (column.display_column_name) return column.display_column_name;

  const columnName = column.column_name;
  const raw = column.source_column_name || columnName;
  const hasCanonicalChannelName = Boolean(schema?.some((entry) => entry.column_name === 'channel_name'));
  const hasCanonicalChannelId = Boolean(schema?.some((entry) => entry.column_name === 'channel_id'));

  if (columnName === 'channel_name') return 'Channel Name';
  if (columnName === 'channel_id') return 'Channel ID';

  const semantic = column.semantic_type || '';
  if (hasCanonicalChannelName && semantic === 'channel-name' && columnName !== 'channel_name') {
    return `Channel Name (${raw})`;
  }
  if (hasCanonicalChannelId && semantic === 'channel-id' && columnName !== 'channel_id') {
    return `Channel ID (${raw})`;
  }
  return columnName;
}

export function getColumnDisplayName(column: Pick<ColumnSchema, 'column_name' | 'display_column_name' | 'source_column_name' | 'semantic_type'> | string, schema?: ColumnSchema[]): string {
  if (typeof column === 'string') {
    if (schema) {
      const match = schema.find((entry) => entry.column_name === column);
      if (match) return inferFriendlyDisplayName(match, schema);
    }
    if (column === 'channel_name') return 'Channel Name';
    if (column === 'channel_id') return 'Channel ID';
    return column;
  }
  return inferFriendlyDisplayName(column, schema);
}

export function getColumnHeaderTooltip(column: Pick<ColumnSchema, 'column_name' | 'display_column_name' | 'source_column_name' | 'detected_schema' | 'semantic_type'>, schema?: ColumnSchema[]): string {
  const display = inferFriendlyDisplayName(column, schema);
  const raw = column.source_column_name || column.column_name;
  if (display === raw) return raw;
  const schemaLine = column.detected_schema ? `
Detected schema: ${column.detected_schema}` : '';
  return `${display}
Raw field: ${raw}${schemaLine}`;
}

export function buildColumnDisplayNameMap(schema: ColumnSchema[]): Record<string, string> {
  return Object.fromEntries(schema.map((column) => [column.column_name, getColumnDisplayName(column, schema)]));
}

export function getDefaultGridColumnSizing(column: ColumnSchema, sampleValues: any[] = []) {
  const rawName = column.source_column_name || column.column_name;
  const normalized = normalizeColumnName(rawName);
  const semanticType = column.semantic_type || '';
  const widthHint = column.width_hint;
  const type = String(column.column_type || '').toLowerCase();
  const sampleStrings = sampleValues
    .filter((value) => !valueIsEmpty(value))
    .slice(0, 40)
    .map((value) => String(value));
  const sampleLength = sampleStrings.reduce((max, value) => Math.max(max, value.length), 0);
  const displayName = getColumnDisplayName(column);
  const headerLength = displayName.length;

  const fixed = (width: number, minWidth = Math.max(64, Math.min(width, width - 8)), maxWidth: number | undefined = undefined) => ({ initialWidth: width, minWidth, maxWidth });

  if (widthHint === 'tiny' || semanticType === 'rank' || /^(position|rank|idx|index|order)$/i.test(rawName)) return fixed(82, 66, 120);
  if (widthHint === 'small' || semanticType === 'duration' || semanticType === 'duration-seconds' || semanticType === 'country' || semanticType === 'language' || semanticType === 'boolean' || semanticType === 'geo' || /(duration|caption|country|definition|dimension|license|paidproductplacement|language|latitude|longitude)/.test(normalized)) return fixed(112, 84, 180);
  if (semanticType === 'date-time' || /(publishedat|createdat|date|time)/.test(normalized)) return fixed(148, 120, 220);
  if (semanticType === 'video-id' || semanticType === 'channel-id' || /(videoid|channelid)\b/.test(normalized)) return fixed(172, 148, 260);
  if (semanticType === 'count' || /(viewcount|subscriber|commentcount|likecount|dislikecount|favoritecount|videocount|count)$/.test(normalized)) return fixed(118, 92, 170);
  if (semanticType === 'url' || /thumbnail|url|link/.test(normalized)) return fixed(196, 140, 320);
  if (semanticType === 'description' || /description|transcript|notes/.test(normalized)) return fixed(320, 180, 760);
  if (semanticType === 'keywords' || semanticType === 'topics' || /keywords|topic|tags/.test(normalized)) return fixed(240, 150, 520);
  if (semanticType === 'video-title' || semanticType === 'channel-name' || /title|name/.test(normalized)) return fixed(260, 150, 480);
  if (widthHint === 'wide') return fixed(240, 150, 480);
  if (widthHint === 'xwide') return fixed(320, 180, 760);
  if (type.includes('boolean')) return fixed(100, 82, 140);
  if (type.includes('int') || type.includes('double') || type.includes('float') || type.includes('decimal')) return fixed(118, 92, 180);

  const estimated = Math.min(280, Math.max(100, Math.round(Math.max(headerLength * 9 + 26, Math.min(sampleLength, 18) * 7 + 24))));
  return fixed(estimated, Math.min(estimated, 90), Math.max(estimated + 40, 220));
}

export function valueIsEmpty(value: any) {
  return value === null || value === undefined || value === '';
}

export function valuesMatch(a: any, b: any) {
  if (valueIsEmpty(a) && valueIsEmpty(b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(normalizeListValues(a)) === JSON.stringify(normalizeListValues(b));
  }
  return String(a ?? '').trim() === String(b ?? '').trim();
}

export function stripDeletedColumnsFromRows(rows: any[], deletedColumns: string[]): any[] {
  if (!deletedColumns.length) return rows;
  return rows.map((row) => {
    const next = { ...row };
    deletedColumns.forEach((column) => {
      delete next[column];
    });
    return next;
  });
}

export function stripDeletedColumnsFromSchema(schema: ColumnSchema[], deletedColumns: string[]): ColumnSchema[] {
  if (!deletedColumns.length) return schema;
  return schema.filter((column) => !deletedColumns.includes(column.column_name));
}

export function deriveSchemaFromRows(rows: any[], previousSchema: ColumnSchema[] = []): ColumnSchema[] {
  const names = new Set<string>();
  previousSchema.forEach((column) => names.add(column.column_name));
  rows.forEach((row) => Object.keys(row || {}).forEach((key) => names.add(key)));

  return Array.from(names).map((name) => {
    const existing = previousSchema.find((column) => column.column_name === name);
    if (existing) return existing;
    const sample = rows.find((row) => row && !valueIsEmpty(row[name]))?.[name];
    let columnType = 'VARCHAR';
    if (typeof sample === 'number') columnType = Number.isInteger(sample) ? 'BIGINT' : 'DOUBLE';
    else if (typeof sample === 'boolean') columnType = 'BOOLEAN';
    else if (Array.isArray(sample)) columnType = 'VARCHAR[]';
    return { column_name: name, column_type: columnType };
  });
}

export function resolveVideoId(row: any): string | null {
  if (!row) return null;
  const value = row.videoId || row.video_id || row.id || row.Video_ID || row.videoID;
  return value == null || value === '' ? null : String(value);
}

export function collectVideoIds(rows: any[]): string[] {
  return Array.from(new Set(
    rows
      .map((row) => resolveVideoId(row))
      .filter((value): value is string => !!value),
  ));
}

export function splitRowsByInclusion(rows: any[], excludedVideoIds: Set<string>, inclusionView: InclusionView): any[] {
  return rows.filter((row) => {
    const videoId = resolveVideoId(row);
    if (!videoId) return inclusionView === 'included';
    const isExcluded = excludedVideoIds.has(videoId);
    return inclusionView === 'excluded' ? isExcluded : !isExcluded;
  });
}

export function partitionRowsByInclusion(rows: any[], excludedVideoIds: Set<string>) {
  const included: any[] = [];
  const excluded: any[] = [];

  rows.forEach((row) => {
    const videoId = resolveVideoId(row);
    if (videoId && excludedVideoIds.has(videoId)) {
      excluded.push(row);
      return;
    }
    included.push(row);
  });

  return { included, excluded };
}

export function resolveVideoTitle(row: any): string {
  return row?.videoTitle || row?.title || row?.video_title || row?.Title || 'Untitled Video';
}

export function resolveChannelName(row: any): string {
  return String(row?.channel_name || row?.channelTitle || row?.title || row?.channel || row?.ChannelTitle || row?.creator || 'Unknown channel').trim() || 'Unknown channel';
}

function resolveChannelIdFromRow(row: any, mode: 'strict' | 'legacy' = 'legacy'): string | null {
  const directValue = row?.channel_id
    ?? row?.channelId
    ?? row?.Channel_ID
    ?? row?.channelID
    ?? row?.['channel id']
    ?? row?.['Channel ID']
    ?? row?.creatorId;
  const value = mode === 'legacy' ? (directValue ?? row?.id) : directValue;
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}

export function resolveChannelId(row: any): string | null {
  return resolveChannelIdFromRow(row, 'legacy');
}

export function buildBatchCopyClipboardPayload(rows: any[], mode: BatchCopyExportMode): BatchCopyClipboardPayload {
  const values: string[] = [];
  const seen = new Set<string>();

  rows.forEach((row) => {
    let nextValue: string | null = null;
    if (mode === 'videoIds') {
      nextValue = resolveVideoId(row);
    } else if (mode === 'videoUrls') {
      const videoId = resolveVideoId(row);
      nextValue = videoId ? `${YOUTUBE_VIDEO_URL_PREFIX}${videoId}` : null;
    } else if (mode === 'channelIds') {
      nextValue = resolveChannelIdFromRow(row, 'strict');
    } else if (mode === 'channelUrls') {
      const channelId = resolveChannelIdFromRow(row, 'strict');
      nextValue = channelId ? `${YOUTUBE_CHANNEL_URL_PREFIX}${channelId}` : null;
    }

    if (!nextValue) return;
    const normalized = nextValue.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    values.push(normalized);
  });

  return {
    mode,
    values,
    text: values.join(','),
  };
}

export function normalizeChannelTitle(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function buildChannelLookupKey(value: unknown, kind: ChannelMetadataRelationshipType): string | null {
  if (kind === 'channelId') {
    const trimmed = String(value ?? '').trim();
    return trimmed ? `id:${trimmed}` : null;
  }
  const normalized = normalizeChannelTitle(value);
  return normalized ? `name:${normalized}` : null;
}

export function detectIncomingChannelIdColumn(schema: { column_name: string }[]): string | null {
  const normalizedNames = schema.map((column) => normalizeColumnName(column.column_name));
  const looksLikeYdtChannelMetadata = normalizedNames.includes('id')
    && normalizedNames.includes('title')
    && normalizedNames.includes('publishedat')
    && (normalizedNames.includes('subscribercount') || normalizedNames.includes('videocount') || normalizedNames.includes('topicdetails') || normalizedNames.includes('keywords'));

  const preferred = ['channelId', 'channel_id', 'Channel_ID', 'channelID', 'channel id'];
  for (const candidate of preferred) {
    if (schema.some((column) => column.column_name === candidate)) return candidate;
  }
  if (looksLikeYdtChannelMetadata && schema.some((column) => column.column_name === 'id')) return 'id';
  const fallback = schema.find((column) => {
    const normalized = normalizeColumnName(column.column_name);
    return normalized === 'channelid' || normalized === 'channelidentifier' || (normalized.includes('channel') && normalized.endsWith('id'));
  });
  return fallback?.column_name || null;
}

export function detectIncomingChannelTitleColumn(schema: { column_name: string }[]): string | null {
  const normalizedNames = schema.map((column) => normalizeColumnName(column.column_name));
  const looksLikeYdtChannelMetadata = normalizedNames.includes('id')
    && normalizedNames.includes('title')
    && normalizedNames.includes('publishedat')
    && (normalizedNames.includes('subscribercount') || normalizedNames.includes('videocount') || normalizedNames.includes('topicdetails') || normalizedNames.includes('keywords'));

  const preferred = ['channelTitle', 'channel_title', 'ChannelTitle', 'channel_name', 'channel name', 'channel'];
  for (const candidate of preferred) {
    if (schema.some((column) => column.column_name === candidate)) return candidate;
  }
  if (looksLikeYdtChannelMetadata && schema.some((column) => column.column_name === 'title')) return 'title';
  const fallback = schema.find((column) => {
    const normalized = normalizeColumnName(column.column_name);
    return normalized === 'channeltitle' || normalized === 'channelname' || normalized === 'creator' || normalized === 'creatorname' || (normalized.includes('channel') && (normalized.includes('title') || normalized.includes('name')));
  });
  return fallback?.column_name || null;
}


export function detectIncomingChannelCreatedAtColumn(schema: { column_name: string }[]): string | null {
  const preferred = [
    'channel_created_at',
    'channelCreatedAt',
    'channel_joined',
    'channelJoined',
    'channel_created',
    'channelCreated',
    'publishedAt',
    'published_at',
    'Published_At',
    'joined',
    'creation_date',
    'createdAt',
  ];
  for (const candidate of preferred) {
    if (schema.some((column) => column.column_name === candidate)) return candidate;
  }
  const fallback = schema.find((column) => {
    const normalized = normalizeColumnName(column.column_name);
    return normalized === 'channelcreatedat'
      || normalized === 'channeljoined'
      || normalized === 'channelcreated'
      || normalized === 'publishedat'
      || normalized === 'creationdate'
      || normalized === 'createdat'
      || (normalized.includes('channel') && (normalized.includes('created') || normalized.includes('joined')));
  });
  return fallback?.column_name || null;
}

const CHANNEL_THUMBNAIL_VALUE_PRIORITY_KEYS = [
  'channel_thumbnail_url',
  'channelThumbnailUrl',
  'channel_thumbnail',
  'channelThumbnail',
  'channel_icon',
  'channelIcon',
  'channel_avatar',
  'channelAvatar',
  'avatar_url',
  'avatarUrl',
  'avatar',
  'profile_image',
  'profileImage',
  'profile_picture',
  'profilePicture',
  'photo_url',
  'photoUrl',
  'photo',
  'image_url',
  'imageUrl',
  'image',
  'thumbnailUrl',
  'thumbnail',
  'thumbnail_default',
  'thumbnail_medium',
  'thumbnail_high',
  'thumbnail_maxres',
  'thumbnails',
  'snippet',
  'brandingSettings',
  'url',
  'src',
  'href',
  'default',
  'medium',
  'high',
  'maxres',
];

function detectIncomingChannelThumbnailColumns(schema: { column_name: string }[]): string[] {
  const scored = schema.map((column) => {
    const normalized = normalizeColumnName(column.column_name);
    let score = -1;
    if (!normalized) return { name: column.column_name, score };
    if (normalized === 'channelthumbnailurl' || normalized === 'channelthumbnail') score = 200;
    else if (normalized === 'thumbnailurl' || normalized === 'thumbnail') score = 180;
    else if (normalized.includes('channel') && (normalized.includes('thumbnail') || normalized.includes('avatar') || normalized.includes('icon') || normalized.includes('profile'))) score = 160;
    else if (normalized.includes('avatar') || normalized.includes('profileimage') || normalized.includes('profilepicture') || normalized.includes('channelicon') || normalized.includes('channelavatar')) score = 140;
    else if (normalized.includes('thumbnails')) score = 120;
    else if (normalized.includes('thumbnail') && !normalized.includes('video')) score = 100;
    else if ((normalized === 'photo' || normalized === 'photourl') && !normalized.includes('video')) score = 80;
    return { name: column.column_name, score };
  }).filter((entry) => entry.score > 0);

  return scored
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .map((entry) => entry.name);
}

function parseJsonLikeThumbnailValue(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const looksLikeJson = (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (!looksLikeJson) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function extractEmbeddedHttpThumbnailUrl(value: string): string | null {
  const match = value.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : null;
}

function normalizeHttpThumbnailUrl(value: string): string | null {
  let candidate = value.trim().replace(/^['"`]+|['"`]+$/g, '');
  if (!candidate) return null;
  if (candidate.startsWith('//')) candidate = `https:${candidate}`;
  if (!/^https?:\/\//i.test(candidate)) {
    const embedded = extractEmbeddedHttpThumbnailUrl(candidate);
    if (!embedded) return null;
    candidate = embedded;
  }
  candidate = candidate.replace(/[),.;]+$/g, '');
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function collectChannelThumbnailCandidates(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const parsedJson = parseJsonLikeThumbnailValue(trimmed);
    if (parsedJson !== null) return collectChannelThumbnailCandidates(parsedJson, seen);
    const embedded = extractEmbeddedHttpThumbnailUrl(trimmed);
    return embedded ? [embedded] : [trimmed];
  }
  if (typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((entry) => collectChannelThumbnailCandidates(entry, seen));

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  const orderedKeys = [
    ...CHANNEL_THUMBNAIL_VALUE_PRIORITY_KEYS.filter((key) => key in obj),
    ...keys.filter((key) => !CHANNEL_THUMBNAIL_VALUE_PRIORITY_KEYS.includes(key)),
  ];
  return orderedKeys.flatMap((key) => collectChannelThumbnailCandidates(obj[key], seen));
}

function normalizeImportedChannelMetadataRow(args: {
  row: Record<string, any>;
  schema: ColumnSchema[];
  canonicalTitle: string;
  canonicalId: string | null;
}) {
  const channelCreatedColumn = detectIncomingChannelCreatedAtColumn(args.schema);
  const subscriberColumn = args.schema.find((column) => normalizeColumnName(column.column_name) === 'subscribercount')?.column_name;
  const videoCountColumn = args.schema.find((column) => normalizeColumnName(column.column_name) === 'videocount')?.column_name;
  const viewCountColumn = args.schema.find((column) => ['viewcount', 'channelviews', 'totalviews'].includes(normalizeColumnName(column.column_name)))?.column_name;
  const thumbnailColumns = detectIncomingChannelThumbnailColumns(args.schema);
  const countryColumn = args.schema.find((column) => normalizeColumnName(column.column_name) === 'country')?.column_name;
  const keywordsColumn = args.schema.find((column) => normalizeColumnName(column.column_name) === 'keywords')?.column_name;
  const topicDetailsColumn = args.schema.find((column) => normalizeColumnName(column.column_name) === 'topicdetails')?.column_name;
  const descriptionColumn = args.schema.find((column) => normalizeColumnName(column.column_name) === 'description')?.column_name;
  const languageColumn = args.schema.find((column) => normalizeColumnName(column.column_name) === 'defaultlanguage')?.column_name;
  const thumbnailUrl = Array.from(new Set(
    thumbnailColumns
      .flatMap((column) => collectChannelThumbnailCandidates(args.row?.[column]))
      .map((candidate) => normalizeHttpThumbnailUrl(candidate))
      .filter((candidate): candidate is string => Boolean(candidate)),
  ))[0] || null;

  const normalizedRow: Record<string, any> = {
    ...args.row,
    channel_name: args.canonicalTitle,
    channel_id: args.canonicalId,
    channelTitle: args.canonicalTitle,
    channelId: args.canonicalId,
  };

  if (channelCreatedColumn) {
    const createdAt = args.row?.[channelCreatedColumn];
    normalizedRow.channel_created_at = createdAt ?? null;
    if (valueIsEmpty(normalizedRow[channelCreatedColumn])) {
      normalizedRow[channelCreatedColumn] = createdAt ?? null;
    }
  }
  if (subscriberColumn) normalizedRow.channel_subscriber_count = args.row?.[subscriberColumn] ?? null;
  if (videoCountColumn) normalizedRow.channel_video_count = args.row?.[videoCountColumn] ?? null;
  if (viewCountColumn) normalizedRow.channel_total_views = args.row?.[viewCountColumn] ?? null;
  normalizedRow.channel_thumbnail_url = thumbnailUrl;
  if (countryColumn) normalizedRow.channel_country = args.row?.[countryColumn] ?? null;
  if (keywordsColumn) normalizedRow.channel_keywords = args.row?.[keywordsColumn] ?? null;
  if (topicDetailsColumn) normalizedRow.channel_topics = args.row?.[topicDetailsColumn] ?? null;
  if (descriptionColumn) normalizedRow.channel_description = args.row?.[descriptionColumn] ?? null;
  if (languageColumn) normalizedRow.channel_default_language = args.row?.[languageColumn] ?? null;
  return normalizedRow;
}

export function detectImportKind(schema: { column_name: string }[], fileName = ''): ImportKind {
  const normalizedNames = schema.map((column) => normalizeColumnName(column.column_name));
  const hasVideoId = normalizedNames.some((name) => name === 'videoid' || name === 'id' || name.endsWith('videoid'));
  const hasChannelSignals = Boolean(detectIncomingChannelIdColumn(schema) || detectIncomingChannelTitleColumn(schema));
  const hasChannelStats = normalizedNames.some((name) => /subscriber|channelviews|totalviews|videocount|uploads/.test(name));
  const looksLikeYdtChannelMetadata = normalizedNames.includes('id')
    && normalizedNames.includes('title')
    && normalizedNames.includes('publishedat')
    && (normalizedNames.includes('subscribercount') || normalizedNames.includes('videocount') || normalizedNames.includes('topicdetails') || normalizedNames.includes('keywords'));
  const lowerName = fileName.toLowerCase();
  if ((looksLikeYdtChannelMetadata || !hasVideoId) && hasChannelSignals && (hasChannelStats || lowerName.includes('channel'))) return 'channelMetadata';
  return 'video';
}

export function mergeChannelMetadataRows(rows: ChannelMetadataRow[], imported: ImportedChannelMetadataState | null | undefined): ChannelMetadataRow[] {
  if (!rows.length || !imported || !Object.keys(imported.byKey || {}).length) return rows;
  return rows.map((row) => {
    const merged: Record<string, any> = { ...row };
    const possibleKeys = [
      row.channel_id ? buildChannelLookupKey(row.channel_id, 'channelId') : null,
      row.channel_name ? buildChannelLookupKey(row.channel_name, 'normalizedChannelTitle') : null,
    ].filter((value): value is string => Boolean(value));

    possibleKeys.forEach((key) => {
      const incoming = imported.byKey[key];
      if (!incoming) return;
      Object.entries(incoming).forEach(([field, fieldValue]) => {
        if (!(field in merged) || valueIsEmpty(merged[field])) {
          merged[field] = fieldValue;
        }
      });
    });

    const canonicalChannelName = String(merged.channel_name ?? '').trim() || String(merged.title ?? '').trim() || String(merged.channelTitle ?? '').trim() || 'Unknown channel';
    const canonicalChannelId = String(merged.channel_id ?? '').trim() || String(merged.id ?? '').trim() || String(merged.channelId ?? '').trim() || null;
    merged.channel_name = canonicalChannelName;
    merged.channel_id = canonicalChannelId;
    if (valueIsEmpty(merged.title)) merged.title = canonicalChannelName;
    if (valueIsEmpty(merged.channelTitle)) merged.channelTitle = canonicalChannelName;
    if (valueIsEmpty(merged.id) && canonicalChannelId) merged.id = canonicalChannelId;
    if (valueIsEmpty(merged.channelId) && canonicalChannelId) merged.channelId = canonicalChannelId;

    return merged as ChannelMetadataRow;
  });
}

export function buildImportedChannelMetadataState(args: {
  existingVideoRows: any[];
  incomingRows: any[];
  incomingSchema: ColumnSchema[];
  relationshipType: ChannelMetadataRelationshipType;
  sourceFileName: string;
  previousState?: ImportedChannelMetadataState | null;
}): { state: ImportedChannelMetadataState; updatedCount: number; skippedCount: number; relationshipColumn: string | null } {
  const relationshipColumn = args.relationshipType === 'channelId'
    ? detectIncomingChannelIdColumn(args.incomingSchema)
    : detectIncomingChannelTitleColumn(args.incomingSchema);

  if (!relationshipColumn) {
    throw new Error('Could not find a matching relationship column in the imported channel metadata file.');
  }

  const knownKeys = new Set<string>();
  const knownChannelByKey = new Map<string, { channel_name: string; channel_id: string | null }>();
  args.existingVideoRows.forEach((row) => {
    const id = resolveChannelId(row);
    const name = resolveChannelName(row);
    const idKey = id ? buildChannelLookupKey(id, 'channelId') : null;
    const nameKey = name ? buildChannelLookupKey(name, 'normalizedChannelTitle') : null;
    const details = { channel_name: name, channel_id: id };
    if (idKey) {
      knownKeys.add(idKey);
      knownChannelByKey.set(idKey, details);
    }
    if (nameKey) {
      knownKeys.add(nameKey);
      knownChannelByKey.set(nameKey, details);
    }
  });

  const nextByKey = { ...(args.previousState?.byKey || {}) };
  const nextColumns = Array.from(new Set([...(args.previousState?.columns || []), ...args.incomingSchema.map((column) => column.column_name), 'channel_name', 'channel_id', 'channelTitle', 'channelId', 'channel_created_at', 'channel_subscriber_count', 'channel_video_count', 'channel_total_views', 'channel_thumbnail_url', 'channel_country', 'channel_keywords', 'channel_topics', 'channel_description', 'channel_default_language']));
  const incomingIdColumn = detectIncomingChannelIdColumn(args.incomingSchema);
  const incomingTitleColumn = detectIncomingChannelTitleColumn(args.incomingSchema);
  let updatedCount = 0;
  let skippedCount = 0;

  args.incomingRows.forEach((row) => {
    const lookupKey = buildChannelLookupKey(row?.[relationshipColumn], args.relationshipType);
    if (!lookupKey || !knownKeys.has(lookupKey)) {
      skippedCount += 1;
      return;
    }
    const knownChannel = knownChannelByKey.get(lookupKey);
    const incomingTitle = incomingTitleColumn ? String(row?.[incomingTitleColumn] ?? '').trim() : '';
    const incomingId = incomingIdColumn ? String(row?.[incomingIdColumn] ?? '').trim() : '';
    const canonicalTitle = incomingTitle || knownChannel?.channel_name || 'Unknown channel';
    const canonicalId = incomingId || knownChannel?.channel_id || null;
    const normalizedRow = normalizeImportedChannelMetadataRow({
      row,
      schema: args.incomingSchema,
      canonicalTitle,
      canonicalId,
    });
    if (incomingTitleColumn && valueIsEmpty(normalizedRow[incomingTitleColumn])) {
      normalizedRow[incomingTitleColumn] = canonicalTitle;
    }
    if (incomingIdColumn && canonicalId && valueIsEmpty(normalizedRow[incomingIdColumn])) {
      normalizedRow[incomingIdColumn] = canonicalId;
    }
    nextByKey[lookupKey] = { ...(nextByKey[lookupKey] || {}), ...normalizedRow };
    updatedCount += 1;
  });

  const auditEntry: ChannelMetadataImportAuditEntry = {
    sourceFileName: args.sourceFileName,
    importedAt: new Date().toISOString(),
    relationshipType: args.relationshipType,
    incomingRowCount: args.incomingRows.length,
    updatedCount,
    skippedCount,
  };

  return {
    state: {
      byKey: nextByKey,
      columns: nextColumns,
      imports: [...(args.previousState?.imports || []), auditEntry],
    },
    updatedCount,
    skippedCount,
    relationshipColumn,
  };
}

export function resolvePublishedAt(row: any): any {
  return row?.publishedAt || row?.published_at || row?.Published_At || row?.publishedAtSQL || null;
}

export function resolveViews(row: any): any {
  return row?.viewCount || row?.view_count || row?.views || row?.Views || 0;
}

function resolveLikes(row: any): number | null {
  const value = row?.likeCount ?? row?.like_count ?? row?.likes ?? row?.Likes;
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveComments(row: any): number | null {
  const value = row?.commentCount ?? row?.comment_count ?? row?.comments ?? row?.Comments;
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveThumbnailUrl(row: any): string | null {
  const value = row?.thumbnailUrl ?? row?.thumbnail ?? row?.thumbnail_default ?? row?.thumbnail_medium ?? row?.thumbnail_high ?? row?.thumbnail_maxres;
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  return text || null;
}

function parseTimestampMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) return Math.floor(value);
    if (value > 1e9) return Math.floor(value * 1000);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    if (numeric > 1e12) return Math.floor(numeric);
    if (numeric > 1e9) return Math.floor(numeric * 1000);
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildChannelMetadataRows(rows: any[], imported?: ImportedChannelMetadataState | null): ChannelMetadataRow[] {
  type ChannelAccumulator = {
    channel_key: string;
    channel_name: string;
    channel_id: string | null;
    video_count_in_dataset: number;
    total_views_in_dataset: number;
    total_likes_in_dataset: number;
    likesValuePresent: boolean;
    total_comments_in_dataset: number;
    commentsValuePresent: boolean;
    earliest_publish_ms: number | null;
    latest_publish_ms: number | null;
  };

  const byChannel = new Map<string, ChannelAccumulator>();

  rows.forEach((row) => {
    const channelName = resolveChannelName(row);
    const channelId = resolveChannelId(row);
    const channelKey = channelId ? `id:${channelId}` : `name:${channelName.toLowerCase()}`;
    const views = Number(resolveViews(row)) || 0;
    const likes = resolveLikes(row);
    const comments = resolveComments(row);
    const publishMs = parseTimestampMs(resolvePublishedAt(row));

    const existing = byChannel.get(channelKey) || {
      channel_key: channelKey,
      channel_name: channelName,
      channel_id: channelId,
      video_count_in_dataset: 0,
      total_views_in_dataset: 0,
      total_likes_in_dataset: 0,
      likesValuePresent: false,
      total_comments_in_dataset: 0,
      commentsValuePresent: false,
      earliest_publish_ms: null,
      latest_publish_ms: null,
    };

    existing.video_count_in_dataset += 1;
    existing.total_views_in_dataset += views;
    if (likes !== null) {
      existing.likesValuePresent = true;
      existing.total_likes_in_dataset += likes;
    }
    if (comments !== null) {
      existing.commentsValuePresent = true;
      existing.total_comments_in_dataset += comments;
    }

    if (publishMs !== null) {
      if (existing.earliest_publish_ms === null || publishMs < existing.earliest_publish_ms) {
        existing.earliest_publish_ms = publishMs;
      }
      if (existing.latest_publish_ms === null || publishMs > existing.latest_publish_ms) {
        existing.latest_publish_ms = publishMs;
      }
    }

    byChannel.set(channelKey, existing);
  });

  const aggregatedRows = [...byChannel.values()]
    .map((channel) => ({
      channel_key: channel.channel_key,
      channel_name: channel.channel_name,
      channel_id: channel.channel_id,
      video_count_in_dataset: channel.video_count_in_dataset,
      total_views_in_dataset: channel.total_views_in_dataset,
      total_likes_in_dataset: channel.likesValuePresent ? channel.total_likes_in_dataset : null,
      total_comments_in_dataset: channel.commentsValuePresent ? channel.total_comments_in_dataset : null,
      earliest_publish_date: channel.earliest_publish_ms ? new Date(channel.earliest_publish_ms).toISOString() : null,
      latest_publish_date: channel.latest_publish_ms ? new Date(channel.latest_publish_ms).toISOString() : null,
    }))
    .sort((a, b) => {
      if (b.video_count_in_dataset !== a.video_count_in_dataset) return b.video_count_in_dataset - a.video_count_in_dataset;
      if (b.total_views_in_dataset !== a.total_views_in_dataset) return b.total_views_in_dataset - a.total_views_in_dataset;
      return a.channel_name.localeCompare(b.channel_name);
    });

  return mergeChannelMetadataRows(aggregatedRows, imported);
}

export function resolveTranscript(row: any, annotation?: Annotation): string {
  const value = annotation?.transcriptOverride ?? row?.[TRANSCRIPT_COLUMN] ?? row?.text ?? row?.Text ?? '';
  return value == null ? '' : String(value);
}

export function resolveVideoDescription(row: any): string {
  const value = row?.[VIDEO_DESCRIPTION_COLUMN] ?? row?.video_description ?? row?.description ?? '';
  return value == null ? '' : String(value);
}

export function resolveVideoTags(row: any): string[] {
  const value = row?.videoTags ?? row?.video_tags ?? row?.tags ?? row?.Tags ?? [];
  return normalizeListValues(value);
}

export function resolveTagFilterColumn(schema: ColumnSchema[]): string | null {
  const preferred = ['videoTags', 'video_tags', 'tags', 'Tags'];
  for (const column of preferred) {
    if (schema.some((item) => item.column_name === column)) return column;
  }

  const fallback = schema.find((column) => {
    const name = column.column_name.toLowerCase();
    return name.includes('tag') && column.column_name !== USER_TAGS_COLUMN;
  });

  return fallback?.column_name || null;
}

export function buildDisplaySchema(baseSchema: ColumnSchema[], userTagsByVideoId: Record<string, string[]>): ColumnSchema[] {
  const hasUserTags = Object.values(userTagsByVideoId).some((tags) => tags.length > 0);
  if (!hasUserTags || baseSchema.some((column) => column.column_name === USER_TAGS_COLUMN)) {
    return baseSchema;
  }

  return [
    ...baseSchema,
    {
      column_name: USER_TAGS_COLUMN,
      column_type: 'VARCHAR[]',
      source_column_name: USER_TAGS_COLUMN,
      display_column_name: 'User Tags',
      semantic_type: 'tags',
      width_hint: 'wide',
    },
  ];
}

function inferGeneratedColumnType(value: unknown): string {
  if (Array.isArray(value)) return 'VARCHAR[]';
  if (typeof value === 'number') return Number.isInteger(value) ? 'BIGINT' : 'DOUBLE';
  if (typeof value === 'boolean') return 'BOOLEAN';
  return 'VARCHAR';
}

export function buildGeneratedMetadataSchema(generatedMetadataByVideoId: Record<string, Record<string, any>>): ColumnSchema[] {
  const sample = Object.values(generatedMetadataByVideoId || {}).find((entry) => entry && typeof entry === 'object');
  if (!sample) return [];
  return Object.keys(sample).map((columnName) => ({
    column_name: columnName,
    column_type: inferGeneratedColumnType((sample as Record<string, any>)[columnName]),
    source_column_name: columnName,
    display_column_name: titleCaseWords(columnName),
  }));
}

export function overlayGeneratedMetadataRows(baseRows: any[], generatedMetadataByVideoId: Record<string, Record<string, any>>): any[] {
  if (!baseRows.length || !generatedMetadataByVideoId || Object.keys(generatedMetadataByVideoId).length === 0) {
    return baseRows;
  }
  return baseRows.map((row) => {
    const videoId = resolveVideoId(row);
    if (!videoId) return row;
    const generated = generatedMetadataByVideoId[videoId];
    if (!generated) return row;
    return { ...row, ...generated };
  });
}

export function buildDisplayRows(baseRows: any[], userTagsByVideoId: Record<string, string[]>): any[] {
  if (Object.keys(userTagsByVideoId).length === 0) {
    return baseRows;
  }

  return baseRows.map((row) => {
    const videoId = resolveVideoId(row);
    const userTags = videoId ? userTagsByVideoId[videoId] : undefined;

    if (!userTags || userTags.length === 0) {
      return row;
    }

    return {
      ...row,
      [USER_TAGS_COLUMN]: userTags,
    };
  });
}

export function convertRowsToCsv(rows: any[], columns: string[]): string {
  const header = columns.join(',');
  const body = rows.map((row) =>
    columns
      .map((column) => {
        const value = row[column];
        const normalized = Array.isArray(value) ? value.join('|') : value ?? '';
        const escaped = String(normalized).replace(/"/g, '""');
        return `"${escaped}"`;
      })
      .join(','),
  );

  return [header, ...body].join('\n');
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function sanitizeFileName(value: string | null | undefined, fallback = 'project'): string {
  const base = (value || fallback).replace(/\.[^.]+$/, '');
  const safe = base.replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '');
  return safe || fallback;
}

export function formatTimestampLabel(seconds: number, durationSeconds?: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  const useHours = hours > 0 || (durationSeconds ?? 0) >= 3600;

  return useHours
    ? `[${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}]`
    : `[${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}]`;
}

export function parseDurationToSeconds(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 0 ? Math.round(value) : null;
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    return Math.max(0, Math.round(Number(text)));
  }

  if (/^PT/i.test(text)) {
    const match = text.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
    if (match) {
      const hours = Number(match[1] || 0);
      const minutes = Number(match[2] || 0);
      const seconds = Number(match[3] || 0);
      return (hours * 3600) + (minutes * 60) + seconds;
    }
  }

  const parts = text.split(':').map((part) => part.trim());
  if (parts.length >= 2 && parts.length <= 3 && parts.every((part) => /^\d+$/.test(part))) {
    const numbers = parts.map((part) => Number(part));
    if (parts.length === 2) return (numbers[0] * 60) + numbers[1];
    return (numbers[0] * 3600) + (numbers[1] * 60) + numbers[2];
  }

  const verbose = text.match(/(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?\s*(?:(\d+)\s*s(?:ec(?:onds?)?)?)?/i);
  if (verbose && (verbose[1] || verbose[2] || verbose[3])) {
    return (Number(verbose[1] || 0) * 3600) + (Number(verbose[2] || 0) * 60) + Number(verbose[3] || 0);
  }

  return null;
}

export function formatDurationDisplay(value: unknown): string {
  const seconds = parseDurationToSeconds(value);
  if (seconds === null) return value == null ? '' : String(value);

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function isDurationColumn(columnName: string): boolean {
  const normalized = columnName.toLowerCase();
  return normalized === 'duration'
    || normalized === 'durationsec'
    || normalized === 'duration_sec'
    || normalized.endsWith('duration')
    || normalized.endsWith('durationsec')
    || normalized.includes('duration');
}

export function isDateLikeColumn(columnName: string, columnType = ''): boolean {
  const normalized = columnName.toLowerCase();
  const type = columnType.toLowerCase();
  if (type.includes('date') || type.includes('timestamp')) return true;
  return normalized.includes('published')
    || normalized.endsWith('date')
    || normalized.endsWith('_date')
    || normalized.includes('timestamp')
    || normalized.endsWith('atsql')
    || normalized.endsWith('_at')
    || normalized.endsWith('at');
}

export function formatDateDisplay(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';

  let date: Date | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : (value > 1e9 ? value * 1000 : value);
    date = new Date(ms);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      const ms = numeric > 1e12 ? numeric : (numeric > 1e9 ? numeric * 1000 : numeric);
      date = new Date(ms);
    } else {
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) date = parsed;
    }
  }

  if (!date || Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function sortQuoteRefs(refs: QuoteRef[] = []): QuoteRef[] {
  return [...refs].sort((a, b) => (a.startIndex - b.startIndex) || (a.createdAt - b.createdAt));
}

export function sortTimestampRefs(refs: TimestampRef[] = []): TimestampRef[] {
  return [...refs].sort((a, b) => (a.seconds - b.seconds) || (a.createdAt - b.createdAt));
}

function stripManagedSections(notes: string): string {
  if (!notes.trim()) return '';
  const lines = notes.split(/\r?\n/);
  const kept: string[] = [];
  let skipHeading: string | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.*)$/);
    if (headingMatch) {
      const heading = headingMatch[1].trim();
      if (MANAGED_HEADINGS.includes(heading)) {
        skipHeading = heading;
        continue;
      }
      skipHeading = null;
    }

    if (skipHeading) continue;
    kept.push(line);
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function syncManagedNotes(baseNotes: string, quoteRefs: QuoteRef[] = [], timestampRefs: TimestampRef[] = []): string {
  const sections: string[] = [];
  const plainNotes = stripManagedSections(baseNotes);
  const sortedQuotes = sortQuoteRefs(quoteRefs);
  const sortedTimestamps = sortTimestampRefs(timestampRefs);

  if (plainNotes) sections.push(plainNotes);

  if (sortedQuotes.length > 0) {
    sections.push([
      '## Transcript Quotes',
      ...sortedQuotes.map((quote) => `- "${quote.text.replace(/"/g, '\\"')}"`),
    ].join('\n'));
  }

  if (sortedTimestamps.length > 0) {
    sections.push([
      '## Timestamps',
      ...sortedTimestamps.map((item) => `- ${item.label}`),
    ].join('\n'));
  }

  return sections.join('\n\n').trim();
}

export function findManagedSectionEntryPosition(notes: string, heading: 'Transcript Quotes' | 'Timestamps', entryIndex: number) {
  if (!notes || entryIndex < 0) return null;

  const lines = notes.split(/\r?\n/);
  let runningOffset = 0;
  let inSection = false;
  let currentEntry = -1;

  for (const line of lines) {
    const lineStart = runningOffset;
    const lineEnd = lineStart + line.length;

    if (line.startsWith('## ')) {
      inSection = line.slice(3).trim() === heading;
      runningOffset = lineEnd + 1;
      continue;
    }

    if (inSection && line.startsWith('- ')) {
      currentEntry += 1;
      if (currentEntry === entryIndex) {
        return {
          lineStart,
          lineEnd,
          cursorStart: lineEnd,
          cursorEnd: lineEnd,
        };
      }
    }

    runningOffset = lineEnd + 1;
  }

  return null;
}

function formatDiaryHeading(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function ensureResearchDiaryDateSection(notes: string, date = new Date()) {
  const heading = `## ${formatDiaryHeading(date)}`;
  const trimmed = notes.trim();

  if (!trimmed) {
    const nextNotes = `${heading}\n`;
    return { notes: nextNotes, inserted: true, cursorPosition: nextNotes.length };
  }

  if (trimmed.split(/\r?\n/).some((line) => line.trim() === heading)) {
    return { notes, inserted: false, cursorPosition: notes.indexOf(heading) + heading.length + 1 };
  }

  const separator = trimmed.endsWith('\n') ? '' : '\n';
  const nextNotes = `${trimmed}${separator}\n${heading}\n`;
  return { notes: nextNotes, inserted: true, cursorPosition: nextNotes.length };
}

export function cleanupAutoSeededResearchDiary(notes: string) {
  if (!notes) return notes;
  const normalized = notes.replace(/\r\n/g, '\n');
  const trimmed = normalized.trim();
  if (!trimmed) return '';

  const onlyHeadingMatch = trimmed.match(/^##\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})$/);
  if (!onlyHeadingMatch) return notes;

  const parsedDate = Date.parse(onlyHeadingMatch[1]);
  if (!Number.isFinite(parsedDate)) return notes;
  return '';
}


function sectionBody(value: string | undefined | null) {
  const trimmed = (value || '').trim();
  return trimmed || 'No entries recorded';
}

export function buildResearchLogMarkdown(args: {
  projectName: string;
  overview: string;
  diary: string;
  corpusProcessing: string;
  views: string;
  watchHistory: string;
  researchActions: string;
  notesAppendix: string;
  dashboard: string;
  includeNotesAppendix: boolean;
  includeDashboardSection: boolean;
  dashboardStale: boolean;
  generatedAt?: string;
}) {
  const notesBody = args.includeNotesAppendix ? sectionBody(args.notesAppendix) : 'Not included in this export.';
  const dashboardBase = args.includeDashboardSection ? sectionBody(args.dashboard) : 'Not included in this export.';
  const dashboardBody = args.dashboardStale && args.includeDashboardSection
    ? `${dashboardBase}\n\n> Snapshot status: one or more dashboard snapshots are stale. Recalculate snapshots in-app to refresh this section.`
    : dashboardBase;
  const generatedAt = args.generatedAt || new Date().toISOString();

  return [
    `# Research Log`,
    '',
    `Project: ${args.projectName || 'Untitled project'}`,
    '',
    `## 1. Project Overview`,
    '',
    sectionBody(args.overview),
    '',
    `## 2. Research Diary`,
    '',
    sectionBody(args.diary),
    '',
    `## 3. Corpus & Processing`,
    '',
    sectionBody(args.corpusProcessing),
    '',
    `## 4. Views`,
    '',
    sectionBody(args.views),
    '',
    `## 5. Watch History`,
    '',
    sectionBody(args.watchHistory),
    '',
    `## 6. Research Actions`,
    '',
    sectionBody(args.researchActions),
    '',
    `## 7. Notes Appendix`,
    '',
    notesBody,
    '',
    `## 8. Dashboard`,
    '',
    dashboardBody,
    '',
    `## 9. Export Metadata`,
    '',
    `Generated at: ${generatedAt}`,
    `Source: Playlist Surfer Research Log`,
    '',
  ].join('\n');
}

export function detectSpecialMappings(schema: ColumnSchema[]) {
  return {
    transcriptColumn: schema.find((column) => normalizeColumnName(column.column_name) === 'transcript')?.column_name,
    descriptionColumn: schema.find((column) => normalizeColumnName(column.column_name) === normalizeColumnName(VIDEO_DESCRIPTION_COLUMN))?.column_name,
    tagColumn: resolveTagFilterColumn(schema) || undefined,
    mergeKeyColumn: schema.find((column) => normalizeColumnName(column.column_name) === 'videoid')?.column_name || schema[0]?.column_name,
  };
}

const JOIN_ALIAS_GROUPS = [
  {
    existing: ['videoId', 'video_id', 'Video_ID', 'videoID', 'id'],
    incoming: ['videoId', 'video_id', 'Video_ID', 'videoID', 'id'],
    normalized: ['videoid', 'videoidentifier', 'youtubevideoid', 'id'],
  },
  {
    existing: ['channelId', 'channel_id', 'Channel_ID', 'channelID', 'id'],
    incoming: ['channelId', 'channel_id', 'Channel_ID', 'channelID', 'id'],
    normalized: ['channelid', 'channelidentifier', 'creatorid', 'id'],
  },
];

function pickColumnFromAliases(schema: ColumnSchema[], preferred: string[], normalizedAliases: string[]) {
  for (const candidate of preferred) {
    const match = schema.find((column) => column.column_name === candidate);
    if (match) return match.column_name;
  }
  for (const alias of normalizedAliases) {
    const match = schema.find((column) => normalizeColumnName(column.column_name) === alias);
    if (match) return match.column_name;
  }
  return null;
}

export function detectSuggestedMergeJoinColumns(existingSchema: ColumnSchema[], incomingSchema: ColumnSchema[]) {
  for (const group of JOIN_ALIAS_GROUPS) {
    const existingJoinColumn = pickColumnFromAliases(existingSchema, group.existing, group.normalized);
    const incomingJoinColumn = pickColumnFromAliases(incomingSchema, group.incoming, group.normalized);
    if (existingJoinColumn && incomingJoinColumn) {
      return { existingJoinColumn, incomingJoinColumn };
    }
  }

  const incomingByNormalized = new Map(incomingSchema.map((column) => [normalizeColumnName(column.column_name), column.column_name]));
  for (const existing of existingSchema) {
    const normalized = normalizeColumnName(existing.column_name);
    const incomingJoinColumn = incomingByNormalized.get(normalized);
    if (incomingJoinColumn) {
      return { existingJoinColumn: existing.column_name, incomingJoinColumn };
    }
  }

  return {
    existingJoinColumn: existingSchema[0]?.column_name || '',
    incomingJoinColumn: incomingSchema[0]?.column_name || '',
  };
}

export function groupDuplicateRows(rows: any[], keyColumn: string): DuplicateGroup[] {
  if (!keyColumn) return [];
  const groups = new Map<string, { rowIndices: number[]; rows: any[] }>();

  rows.forEach((row, index) => {
    const key = row?.[keyColumn];
    if (valueIsEmpty(key)) return;
    const normalized = String(key);
    const existing = groups.get(normalized) || { rowIndices: [], rows: [] };
    existing.rowIndices.push(index);
    existing.rows.push(row);
    groups.set(normalized, existing);
  });

  return Array.from(groups.entries())
    .filter(([, value]) => value.rows.length > 1)
    .map(([key, value]) => ({ key, rowIndices: value.rowIndices, rows: value.rows }));
}

export function applyDuplicateSelections(rows: any[], duplicateGroups: DuplicateGroup[], selections: Record<string, number> = {}) {
  if (!duplicateGroups.length) return rows;
  const removeIndices = new Set<number>();

  duplicateGroups.forEach((group) => {
    const keepOriginalIndex = selections[group.key] ?? group.rowIndices[0];
    group.rowIndices.forEach((rowIndex) => {
      if (rowIndex !== keepOriginalIndex) removeIndices.add(rowIndex);
    });
  });

  return rows.filter((_, index) => !removeIndices.has(index));
}

function suggestMapping(existingColumns: string[], incomingColumns: string[]) {
  const existingByNormalized = new Map(existingColumns.map((column) => [normalizeColumnName(column), column]));
  const mapping: Record<string, string> = {};

  existingColumns.forEach((existingColumn) => {
    if (incomingColumns.includes(existingColumn)) {
      mapping[existingColumn] = existingColumn;
      return;
    }

    const normalized = normalizeColumnName(existingColumn);
    const match = incomingColumns.find((column) => normalizeColumnName(column) === normalized);
    if (match) mapping[existingColumn] = match;
  });

  incomingColumns.forEach((incomingColumn) => {
    const normalized = normalizeColumnName(incomingColumn);
    if (!existingByNormalized.has(normalized)) return;
    const existingColumn = existingByNormalized.get(normalized)!;
    if (!mapping[existingColumn]) mapping[existingColumn] = incomingColumn;
  });

  return mapping;
}

export function buildMergePreview(args: {
  existingRows: any[];
  incomingRows: any[];
  existingSchema: ColumnSchema[];
  incomingSchema: ColumnSchema[];
  joinColumn: string;
  incomingJoinColumn?: string;
  columnMapping?: Record<string, string>;
}): MergePreview {
  const existingColumns = args.existingSchema.map((column) => column.column_name);
  const incomingColumns = args.incomingSchema.map((column) => column.column_name);
  const baseMapping = suggestMapping(existingColumns, incomingColumns);
  const incomingJoinColumn = args.incomingJoinColumn || args.joinColumn;
  const mapping = { ...baseMapping, ...(args.columnMapping || {}) };
  if (args.joinColumn && incomingJoinColumn && !mapping[args.joinColumn]) {
    mapping[args.joinColumn] = incomingJoinColumn;
  }
  const duplicateGroupsExisting = groupDuplicateRows(args.existingRows, args.joinColumn);
  const duplicateGroupsIncoming = groupDuplicateRows(args.incomingRows, incomingJoinColumn);
  const existingMap = new Map(args.existingRows.map((row) => [String(row?.[args.joinColumn] ?? ''), row]));

  const matchedRows = args.incomingRows.filter((row) => !valueIsEmpty(row?.[incomingJoinColumn]) && existingMap.has(String(row[incomingJoinColumn])));
  const unmatchedIncomingCount = args.incomingRows.filter((row) => valueIsEmpty(row?.[incomingJoinColumn]) || !existingMap.has(String(row[incomingJoinColumn]))).length;

  const conflictColumns = Object.entries(mapping).flatMap(([existingColumn, incomingColumn]) => {
    if (!incomingColumn) return [];
    let count = 0;
    matchedRows.forEach((incomingRow) => {
      const key = String(incomingRow[incomingJoinColumn]);
      const existingRow = existingMap.get(key);
      if (!existingRow) return;
      const oldValue = existingRow[existingColumn];
      const newValue = incomingRow[incomingColumn];
      if (valueIsEmpty(newValue) || valueIsEmpty(oldValue) || valuesMatch(oldValue, newValue)) return;
      count += 1;
    });
    return count > 0 ? [{ column: existingColumn, incomingColumn, count }] : [];
  });

  const matchedColumns = Object.entries(mapping)
    .filter(([, incomingColumn]) => !!incomingColumn)
    .map(([existingColumn, incomingColumn]) => ({ existingColumn, incomingColumn: incomingColumn! }));

  const matchedIncoming = new Set(Object.values(mapping).filter(Boolean));
  const newColumns = incomingColumns.filter((column) => !matchedIncoming.has(column) && !existingColumns.includes(column));
  const unmatchedIncomingColumns = incomingColumns.filter((column) => !matchedIncoming.has(column) && existingColumns.includes(column) === false);

  return {
    matchedCount: matchedRows.length,
    unmatchedIncomingCount,
    newColumns,
    matchedColumns,
    unmatchedIncomingColumns,
    conflictColumns,
    duplicateGroupsExisting,
    duplicateGroupsIncoming,
  };
}

function transformIncomingRow(row: any, incomingSchema: ColumnSchema[], specialMappings?: MergeOptions['specialMappings']) {
  const next = { ...row };
  if (specialMappings?.transcriptColumn && specialMappings.transcriptColumn in row) {
    next[TRANSCRIPT_COLUMN] = row[specialMappings.transcriptColumn];
  }
  if (specialMappings?.descriptionColumn && specialMappings.descriptionColumn in row) {
    next[VIDEO_DESCRIPTION_COLUMN] = row[specialMappings.descriptionColumn];
  }
  return next;
}


function getCanonicalSpecialFieldValues(row: any, specialMappings?: MergeOptions['specialMappings']) {
  const canonical: Partial<Record<typeof TRANSCRIPT_COLUMN | typeof VIDEO_DESCRIPTION_COLUMN, any>> = {};

  if (!row) return canonical;

  if (!valueIsEmpty(row[TRANSCRIPT_COLUMN])) {
    canonical[TRANSCRIPT_COLUMN] = row[TRANSCRIPT_COLUMN];
  } else if (specialMappings?.transcriptColumn && !valueIsEmpty(row[specialMappings.transcriptColumn])) {
    canonical[TRANSCRIPT_COLUMN] = row[specialMappings.transcriptColumn];
  }

  if (!valueIsEmpty(row[VIDEO_DESCRIPTION_COLUMN])) {
    canonical[VIDEO_DESCRIPTION_COLUMN] = row[VIDEO_DESCRIPTION_COLUMN];
  } else if (specialMappings?.descriptionColumn && !valueIsEmpty(row[specialMappings.descriptionColumn])) {
    canonical[VIDEO_DESCRIPTION_COLUMN] = row[specialMappings.descriptionColumn];
  }

  return canonical;
}

export function applyMerge(args: {
  existingRows: any[];
  incomingRows: any[];
  existingSchema: ColumnSchema[];
  incomingSchema: ColumnSchema[];
  joinColumn: string;
  incomingJoinColumn?: string;
  mergeOptions: MergeOptions;
}) {
  const preview = buildMergePreview({
    existingRows: args.existingRows,
    incomingRows: args.incomingRows,
    existingSchema: args.existingSchema,
    incomingSchema: args.incomingSchema,
    joinColumn: args.joinColumn,
    incomingJoinColumn: args.incomingJoinColumn,
    columnMapping: args.mergeOptions.columnMapping,
  });

  const incomingJoinColumn = args.incomingJoinColumn || args.joinColumn;
  const resolvedExisting = applyDuplicateSelections(args.existingRows, preview.duplicateGroupsExisting, args.mergeOptions.existingDuplicateSelections);
  const resolvedIncoming = applyDuplicateSelections(args.incomingRows, preview.duplicateGroupsIncoming, args.mergeOptions.incomingDuplicateSelections);
  const existingByKey = new Map(resolvedExisting.map((row) => [String(row?.[args.joinColumn] ?? ''), row]));
  const incomingByKey = new Map(resolvedIncoming.map((row) => [String(row?.[incomingJoinColumn] ?? ''), transformIncomingRow(row, args.incomingSchema, args.mergeOptions.specialMappings)]));
  const resultRows = resolvedExisting.map((row) => ({ ...row }));
  const resultIndexByKey = new Map(resultRows.map((row, index) => [String(row?.[args.joinColumn] ?? ''), index]));

  if (args.mergeOptions.mergeMode !== 'add-only') {
    incomingByKey.forEach((incomingRow, key) => {
      const existingRow = existingByKey.get(key);
      const resultIndex = resultIndexByKey.get(key);
      if (!existingRow || resultIndex === undefined) return;
      if (args.mergeOptions.mergeMode === 'add-only') return;
      const merged = { ...existingRow };

      preview.matchedColumns.forEach(({ existingColumn, incomingColumn }) => {
        const oldValue = existingRow[existingColumn];
        const newValue = incomingRow[incomingColumn];
        if (valueIsEmpty(newValue)) return;
        if (valueIsEmpty(oldValue) || valuesMatch(oldValue, newValue)) {
          if (valueIsEmpty(oldValue)) merged[existingColumn] = newValue;
          return;
        }

        const strategy = args.mergeOptions.conflictStrategies[existingColumn] || 'keep-existing';
        if (strategy === 'use-new') {
          merged[existingColumn] = newValue;
          return;
        }
        if (strategy === 'review') {
          const decision = args.mergeOptions.rowConflictDecisions[existingColumn]?.[key] || 'existing';
          merged[existingColumn] = decision === 'new' ? newValue : oldValue;
          return;
        }
      });

      preview.newColumns.forEach((column) => {
        if (!valueIsEmpty(incomingRow[column])) merged[column] = incomingRow[column];
      });

      const canonicalSpecialFields = getCanonicalSpecialFieldValues(incomingRow, args.mergeOptions.specialMappings);
      if (!valueIsEmpty(canonicalSpecialFields[TRANSCRIPT_COLUMN])) {
        merged[TRANSCRIPT_COLUMN] = canonicalSpecialFields[TRANSCRIPT_COLUMN];
      }
      if (!valueIsEmpty(canonicalSpecialFields[VIDEO_DESCRIPTION_COLUMN])) {
        merged[VIDEO_DESCRIPTION_COLUMN] = canonicalSpecialFields[VIDEO_DESCRIPTION_COLUMN];
      }

      resultRows[resultIndex] = merged;
    });
  }

  if (args.mergeOptions.mergeMode !== 'update-only') {
    const unmatchedIncoming = resolvedIncoming.filter((row) => {
      const key = row?.[incomingJoinColumn];
      return valueIsEmpty(key) || !existingByKey.has(String(key));
    });

    const selectedUnmatchedKeySet = new Set(args.mergeOptions.selectedUnmatchedKeys);
    const selectedRows = unmatchedIncoming.filter((row) => {
      if (args.mergeOptions.unmatchedRowMode === 'all') return true;
      if (args.mergeOptions.unmatchedRowMode === 'none') return false;
      return selectedUnmatchedKeySet.has(String(row?.[incomingJoinColumn] ?? ''));
    });

    for (const row of selectedRows) {
      resultRows.push(transformIncomingRow(row, args.incomingSchema, args.mergeOptions.specialMappings));
    }
  }

  const resultSchema = deriveSchemaFromRows(resultRows, [
    ...args.existingSchema,
    ...args.incomingSchema.filter((column) => !args.existingSchema.some((existing) => existing.column_name === column.column_name)),
  ]);

  return {
    rows: resultRows,
    schema: resultSchema,
  };
}

export function deleteColumnFromProject(args: {
  deletedColumns: string[];
  column: string;
  visibleColumns: string[];
  channelVisibleColumns?: string[];
  videoColumnWidths?: Record<string, number>;
  channelColumnWidths?: Record<string, number>;
  savedViews: ProjectArchiveManifest['savedViews'];
  specialMappings?: Record<string, string | undefined>;
}) {
  const nextDeletedColumns = args.deletedColumns.includes(args.column)
    ? args.deletedColumns
    : [...args.deletedColumns, args.column];
  const nextVisibleColumns = args.visibleColumns.filter((value) => value !== args.column);
  const nextSavedViews = args.savedViews.map((view) => ({
    ...view,
    columnState: (view.columnState || []).filter((columnState: any) => columnState.colId !== args.column),
    filterModel: Object.fromEntries(Object.entries(view.filterModel || {}).filter(([key]) => key !== args.column)),
  }));
  const nextSpecialMappings = Object.fromEntries(
    Object.entries(args.specialMappings || {}).map(([key, value]) => [key, value === args.column ? undefined : value]),
  ) as Record<string, string | undefined>;

  return { nextDeletedColumns, nextVisibleColumns, nextSavedViews, nextSpecialMappings };
}

export function createProjectManifest(args: {
  fileName: string | null;
  projectName: string;
  schema: ColumnSchema[];
  sourceSchema?: ColumnSchema[];
  visibleColumns: string[];
  channelVisibleColumns?: string[];
  videoColumnWidths?: Record<string, number>;
  channelColumnWidths?: Record<string, number>;
  savedViews: ProjectArchiveManifest['savedViews'];
  activeViewId: string | null;
  annotations: Record<string, Annotation>;
  channelNotesById?: Record<string, string>;
  channelTagsById?: Record<string, string[]>;
  projectOverview?: string;
  projectNotes: string;
  researchLogSectionComments?: Partial<Record<ResearchLogCommentSectionId, string>>;
  researchHistory?: ResearchHistoryEvent[];
  watchHistoryByVideoId?: Record<string, WatchHistoryEntry>;
  theme: ThemeMode;
  isRightPanelCollapsed: boolean;
  deletedColumns?: string[];
  specialMappings?: Record<string, string | undefined>;
  excludedVideoIds?: string[];
  excludedVideoMetaById?: Record<string, ExcludedVideoMeta>;
  dashboardSnapshots?: ProjectArchiveManifest['dashboardSnapshots'];
  savedViewDashboardSnapshots?: Record<string, SavedViewDashboardSnapshot>;
  savedViewsVersion?: number;
  channelMetadataSnapshot?: ChannelMetadataSnapshot | null;
  importedChannelMetadata?: ImportedChannelMetadataState | null;
  thumbnailCacheIndex?: DashboardThumbnailCacheIndex;
  viewScope?: ViewScope;
  sourceRegistry?: SourceRegistryState;
  sourceVisibility?: SourceVisibilityState;
  rowLineage?: RowLineageState;
  columnLineage?: ColumnLineageState;
  generatedMetadata?: GeneratedMetadataState;
  linkingState?: LinkingState;
  channelLinkingState?: ChannelLinkingState;
}): ProjectArchiveManifest {
  return {
    version: 10,
    projectName: args.projectName || sanitizeFileName(args.fileName, 'ytde_project'),
    originalFileName: args.fileName,
    exportedAt: new Date().toISOString(),
    schema: args.schema,
    sourceSchema: args.sourceSchema || args.schema,
    visibleColumns: args.visibleColumns,
    channelVisibleColumns: args.channelVisibleColumns || [],
    videoColumnWidths: args.videoColumnWidths || {},
    channelColumnWidths: args.channelColumnWidths || {},
    savedViews: args.savedViews,
    activeViewId: args.activeViewId,
    annotations: args.annotations,
    channelNotesById: args.channelNotesById || {},
    channelTagsById: args.channelTagsById || {},
    projectOverview: args.projectOverview || '',
    projectNotes: args.projectNotes,
    researchLogSectionComments: args.researchLogSectionComments || {},
    researchHistory: args.researchHistory || [],
    watchHistoryByVideoId: args.watchHistoryByVideoId || {},
    transcriptColumn: (args.sourceSchema || args.schema).some((column) => column.column_name === TRANSCRIPT_COLUMN)
      ? TRANSCRIPT_COLUMN
      : undefined,
    deletedColumns: args.deletedColumns || [],
    specialMappings: args.specialMappings,
    excluded_videos: args.excludedVideoIds || [],
    excludedVideoMetaById: args.excludedVideoMetaById || {},
    uiState: {
      theme: args.theme,
      isRightPanelCollapsed: args.isRightPanelCollapsed,
    },
    dashboardSnapshots: args.dashboardSnapshots,
    savedViewDashboardSnapshots: args.savedViewDashboardSnapshots || {},
    savedViewsVersion: args.savedViewsVersion ?? 0,
    thumbnailCacheIndex: args.thumbnailCacheIndex,
    channelMetadataSnapshot: args.channelMetadataSnapshot ?? null,
    importedChannelMetadata: args.importedChannelMetadata ?? null,
    viewScope: args.viewScope ?? 'videos',
    sourceRegistry: args.sourceRegistry,
    sourceVisibility: args.sourceVisibility,
    rowLineage: args.rowLineage,
    columnLineage: args.columnLineage,
    generatedMetadata: args.generatedMetadata,
    linkingState: args.linkingState,
    channelLinkingState: args.channelLinkingState,
  };
}
