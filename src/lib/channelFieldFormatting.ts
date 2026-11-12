import { formatDateDisplay } from './data';

export type MetadataBucket = 'publishing' | 'performance' | 'linking' | 'profile' | 'imported';

export const EMPTY_PLACEHOLDER = 'N/A';

const FIELD_LABELS: Record<string, string> = {
  channel_name: 'Channel name',
  channel_id: 'Channel ID',
  channel_user_tags: 'Channel user tags',
  channel_created_at: 'Channel created',
  channel_days_active: 'Days active',
  channel_subscriber_count: 'Subscribers',
  channel_video_count: 'Channel video count',
  channel_total_views: 'Channel total views',
  channel_country: 'Country',
  channel_default_language: 'Default language',
  channel_keywords: 'Keywords',
  channel_topics: 'Topics',
  channel_description: 'Description',
  channel_linked_video_count: 'Linked videos',
  channel_total_urls: 'Total outgoing URLs',
  channel_unique_domains: 'Unique linked domains',
  channel_top_domains: 'Top linked domains',
  channel_linking_recipe_mix: 'Linking recipe mix',
  video_count_in_dataset: 'Videos in dataset',
  total_views_in_dataset: 'Total views in dataset',
  total_likes_in_dataset: 'Total likes in dataset',
  total_comments_in_dataset: 'Total comments in dataset',
  earliest_publish_date: 'Earliest publish date',
  latest_publish_date: 'Latest publish date',
};

export const SECTION_PRIORITY: Record<'publishing' | 'performance' | 'linking' | 'profile', string[]> = {
  publishing: [
    'earliest_publish_date',
    'latest_publish_date',
    'channel_created_at',
    'channel_days_active',
    'video_count_in_dataset',
    'channel_video_count',
  ],
  performance: [
    'total_views_in_dataset',
    'total_likes_in_dataset',
    'total_comments_in_dataset',
    'channel_subscriber_count',
    'channel_total_views',
  ],
  linking: [
    'channel_linked_video_count',
    'channel_unique_domains',
    'channel_total_urls',
    'channel_top_domains',
    'channel_linking_recipe_mix',
  ],
  profile: [
    'channel_country',
    'channel_default_language',
    'channel_keywords',
    'channel_topics',
    'channel_thumbnail_url',
  ],
};

export const PROFILE_SNAPSHOT_KEYS = [
  'channel_country',
  'channel_default_language',
  'channel_subscriber_count',
  'channel_video_count',
  'channel_total_views',
  'channel_created_at',
  'channel_keywords',
  'channel_topics',
];

export const CHANNEL_KPI_KEYS = [
  'video_count_in_dataset',
  'channel_video_count',
  'total_views_in_dataset',
  'total_likes_in_dataset',
  'total_comments_in_dataset',
  'channel_unique_domains',
];

export const CHANNEL_HEADER_META_KEYS = [
  'channel_id',
  'earliest_publish_date',
  'latest_publish_date',
];

export const METADATA_HIDDEN_KEYS = new Set([
  'channel_name',
  'channel_id',
  'channel_key',
  'channel_user_tags',
  'channel_description',
  'description',
  'about',
  'channel_about',
  'channelDescription',
  'aboutText',
  'id',
  'title',
  'publishedAt',
  'defaultLanguage',
  'country',
  'viewCount',
  'subscriberCount',
  'videoCount',
  'thumbnail',
  'keywords',
  'topicDetails',
]);

export function isEmptyValue(value: unknown) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

export function fieldLabel(key: string) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isNumericFieldKey(key: string) {
  return /(count|views?|likes?|comments?|subscribers?|followers?|score|avg|average|rate|ratio|urls?|domains?|videos?)/i.test(key);
}

function isDateFieldKey(key: string) {
  return /(date|published|publish|created|updated|time|_at|At)$/.test(key) || /(date|published|created|updated)$/i.test(key);
}

function isListFieldKey(key: string) {
  return /(tags?|topics?|keywords?|domains?|languages?|countries?|categories?|recipes?|mix|urls?)/i.test(key);
}

export function isLongTextFieldKey(key: string) {
  return /(description|about|notes?|summary|bio|transcript)/i.test(key);
}

export function formatValue(value: unknown) {
  if (value === null || value === undefined || value === '') return EMPTY_PLACEHOLDER;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : EMPTY_PLACEHOLDER;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return formatDateDisplay(text);
  return text.trim() || EMPTY_PLACEHOLDER;
}

export function parseArrayLikeValue(key: string, value: unknown): string[] {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);

  const text = String(value).trim();
  if (!text) return [];

  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry).trim()).filter(Boolean);
    } catch {
      // fall through
    }
  }

  if (text.includes('|')) return text.split('|').map((entry) => entry.trim()).filter(Boolean);
  if (text.includes(';')) return text.split(';').map((entry) => entry.trim()).filter(Boolean);
  if (isListFieldKey(key) && text.includes(',')) return text.split(',').map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function coerceNumericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !/^-?[\d,.]+$/.test(trimmed)) return null;
  const parsed = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatMetadataDisplay(key: string, value: unknown): string | string[] {
  const list = parseArrayLikeValue(key, value);
  if (list.length) return list;
  if (value === null || value === undefined || value === '') return EMPTY_PLACEHOLDER;
  // Dates can arrive as epoch milliseconds when DuckDB parsed the column as a timestamp.
  if (isDateFieldKey(key)) return typeof value === 'number' ? (formatDateDisplay(value) || EMPTY_PLACEHOLDER) : formatValue(value);
  const numeric = coerceNumericValue(value);
  if (numeric !== null && (isNumericFieldKey(key) || typeof value === 'number')) return numeric.toLocaleString();
  return String(value).trim() || EMPTY_PLACEHOLDER;
}

export function orderKeysByPriority(keys: string[], priority: string[]) {
  const unique = Array.from(new Set(keys));
  const prioritySet = new Set(priority);
  const prioritized = priority.filter((key) => unique.includes(key));
  const rest = unique
    .filter((key) => !prioritySet.has(key))
    .sort((a, b) => fieldLabel(a).localeCompare(fieldLabel(b)));
  return [...prioritized, ...rest];
}

export function dedupeMetadataKeys(keys: string[], row: any) {
  const seen = new Set<string>();
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
  return keys.filter((key) => {
    const label = normalize(fieldLabel(key));
    const display = formatMetadataDisplay(key, row?.[key]);
    const value = normalize(Array.isArray(display) ? display.join(' | ') : String(display));
    const signature = `${label}::${value}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

export function bucketForKey(key: string): MetadataBucket {
  if (SECTION_PRIORITY.publishing.includes(key)) return 'publishing';
  if (SECTION_PRIORITY.performance.includes(key)) return 'performance';
  if (SECTION_PRIORITY.linking.includes(key)) return 'linking';
  if (SECTION_PRIORITY.profile.includes(key)) return 'profile';

  if (/(publish|upload|created|date|video_count)/i.test(key)) return 'publishing';
  if (/(view|like|comment|subscriber|follower|engagement|watch)/i.test(key)) return 'performance';
  if (/(link|domain|url|recipe)/i.test(key)) return 'linking';
  if (/(country|language|keyword|topic|category|tag|profile|thumbnail|about|description)/i.test(key)) return 'profile';
  return 'imported';
}

export function resolveChannelKey(row: any) {
  return String(row?.channel_key || row?.channel_id || row?.channel_name || '').trim();
}

export function resolveChannelDescription(row: any) {
  const candidates = [
    row?.channel_description,
    row?.description,
    row?.about,
    row?.channel_about,
    row?.channelDescription,
    row?.aboutText,
  ];
  const value = candidates.find((entry) => String(entry ?? '').trim().length > 0);
  return value == null ? '' : String(value);
}

export function buildChannelMonogram(channelName: unknown): string {
  const text = String(channelName ?? '').trim();
  if (!text) return 'CH';
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
}
