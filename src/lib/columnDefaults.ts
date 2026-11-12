import { ColumnSchema } from '../types';
import { isDurationColumn } from './data';

export function getDefaultChannelVisibleColumns(columnNames: string[]) {
  const preferred = [
    'channel_name',
    'channel_id',
    // Channel metadata, from a channel import or from YouTube Data Tools' per-video channel columns.
    'channel_subscriber_count',
    'channel_country',
    'video_count_in_dataset',
    'total_views_in_dataset',
    'total_likes_in_dataset',
    'total_comments_in_dataset',
    'earliest_publish_date',
    'latest_publish_date',
    'channel_created_at',
    'channel_video_count',
    'channel_total_views',
    'channel_linked_video_count',
    'channel_unique_domains',
    'channel_top_domains',
    'channel_linking_recipe_mix',
    CHANNEL_USER_TAGS_COLUMN,
  ];
  const ordered = preferred.filter((column) => columnNames.includes(column));
  return ordered.length ? ordered : columnNames.slice(0, Math.min(8, columnNames.length));
}

export function shouldHideRedundantChannelIdentityColumn(column: ColumnSchema, schema: ColumnSchema[]) {
  const columnName = column.column_name;
  const rawName = column.source_column_name || columnName;
  const displayName = (column.display_column_name || '').toLowerCase();
  const semanticType = column.semantic_type || '';
  const hasCanonicalChannelName = schema.some((entry) => entry.column_name === 'channel_name');
  const hasCanonicalChannelId = schema.some((entry) => entry.column_name === 'channel_id');

  if (columnName === 'channel_name' || columnName === 'channel_id') return false;

  if (hasCanonicalChannelName) {
    const isDuplicateChannelName = semanticType === 'channel-name'
      || displayName.startsWith('channel name')
      || ['channelTitle', 'channel_title'].includes(columnName)
      || (rawName === 'title' && displayName.startsWith('channel name'));
    if (isDuplicateChannelName) return true;
  }

  if (hasCanonicalChannelId) {
    const isDuplicateChannelId = semanticType === 'channel-id'
      || displayName.startsWith('channel id')
      || ['channelId', 'Channel_ID', 'channelID', 'id'].includes(columnName);
    if (isDuplicateChannelId) return true;
  }

  return false;
}

export function getDefaultVideoVisibleColumns(schema: ColumnSchema[]) {
  return schema
    .filter((column) => !shouldHideRedundantChannelIdentityColumn(column, schema))
    .map((column) => column.column_name);
}

export const CHANNEL_USER_TAGS_COLUMN = 'channel_user_tags';

export const CHANNEL_BASE_SCHEMA = [
  { column_name: 'channel_name', column_type: 'VARCHAR' },
  { column_name: 'channel_id', column_type: 'VARCHAR' },
  { column_name: CHANNEL_USER_TAGS_COLUMN, column_type: 'VARCHAR[]' },
  { column_name: 'video_count_in_dataset', column_type: 'BIGINT' },
  { column_name: 'total_views_in_dataset', column_type: 'BIGINT' },
  { column_name: 'total_likes_in_dataset', column_type: 'BIGINT' },
  { column_name: 'total_comments_in_dataset', column_type: 'BIGINT' },
  { column_name: 'earliest_publish_date', column_type: 'TIMESTAMP' },
  { column_name: 'latest_publish_date', column_type: 'TIMESTAMP' },
];

export function findVideoChannelColumn(schema: { column_name: string; }[]) {
  const preferred = ['channel_name', 'channelTitle', 'channel', 'ChannelTitle'];
  for (const candidate of preferred) {
    if (schema.some((column) => column.column_name === candidate)) return candidate;
  }
  const fallback = schema.find((column) => column.column_name.toLowerCase().includes('channel'));
  return fallback?.column_name ?? null;
}


export function findDashboardCategoryColumn(schema: { column_name: string; }[]) {
  const preferred = ['video_category', 'video_category_label', 'category', 'categories'];
  for (const candidate of preferred) {
    const match = schema.find((column) => column.column_name.toLowerCase() == candidate.toLowerCase());
    if (match) return match.column_name;
  }
  const fallback = schema.find((column) => {
    const normalized = column.column_name.toLowerCase();
    return normalized.includes('category') && !normalized.includes('topic');
  });
  return fallback?.column_name ?? null;
}

export function findDashboardTopicColumn(schema: { column_name: string; }[]) {
  const preferred = ['topic_categories', 'topics', 'topic', 'topicCategories'];
  for (const candidate of preferred) {
    const match = schema.find((column) => column.column_name.toLowerCase() == candidate.toLowerCase());
    if (match) return match.column_name;
  }
  const fallback = schema.find((column) => column.column_name.toLowerCase().includes('topic'));
  return fallback?.column_name ?? null;
}

export function findDashboardDurationColumn(schema: { column_name: string; }[]) {
  const preferred = ['duration', 'duration_seconds', 'length', 'runtime'];
  for (const candidate of preferred) {
    const match = schema.find((column) => column.column_name.toLowerCase() === candidate.toLowerCase());
    if (match) return match.column_name;
  }
  const fallback = schema.find((column) => isDurationColumn(column.column_name));
  return fallback?.column_name ?? null;
}

export function findDashboardIntentColumn(schema: { column_name: string; }[]) {
  const preferred = ['content_intent', 'intent'];
  for (const candidate of preferred) {
    const match = schema.find((column) => column.column_name.toLowerCase() === candidate.toLowerCase());
    if (match) return match.column_name;
  }
  const fallback = schema.find((column) => column.column_name.toLowerCase().includes('intent'));
  return fallback?.column_name ?? null;
}

function findColumn(schema: { column_name: string; }[], preferred: string[], fallback?: (normalized: string) => boolean) {
  for (const candidate of preferred) {
    const match = schema.find((column) => column.column_name.toLowerCase() === candidate.toLowerCase());
    if (match) return match.column_name;
  }
  if (!fallback) return null;
  return schema.find((column) => fallback(column.column_name.toLowerCase()))?.column_name ?? null;
}

export function findDashboardPublishedColumn(schema: { column_name: string; }[]) {
  return findColumn(schema, ['publishedAt', 'published_at', 'publishedAtSQL', 'Published_At'], (name) => name.includes('published'));
}

export function findDashboardViewsColumn(schema: { column_name: string; }[]) {
  return findColumn(schema, ['viewCount', 'view_count', 'views']);
}

export function findDashboardLanguageColumn(schema: { column_name: string; }[], source: 'audio' | 'declared') {
  return source === 'audio'
    ? findColumn(schema, ['defaultAudioLanguage', 'default_audio_language', 'audioLanguage'])
    : findColumn(schema, ['defaultLanguage', 'default_language', 'language']);
}

export function findDashboardTitleColumn(schema: { column_name: string; }[]) {
  return findColumn(schema, ['videoTitle', 'video_title', 'title']);
}

export function findDashboardDescriptionColumn(schema: { column_name: string; }[]) {
  return findColumn(schema, ['videoDescription', 'video_description', 'description']);
}

export function findDashboardShortColumn(schema: { column_name: string; }[]) {
  return findColumn(schema, ['isShort', 'is_short', 'isShorts']);
}
