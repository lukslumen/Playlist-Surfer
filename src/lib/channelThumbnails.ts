const THUMBNAIL_URL_PRIORITY_KEYS = [
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

function parseJsonLikeValue(value: string): unknown | null {
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

function extractEmbeddedHttpUrl(value: string): string | null {
  const match = value.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : null;
}

function collectThumbnailUrlCandidates(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const parsedJson = parseJsonLikeValue(trimmed);
    if (parsedJson !== null) return collectThumbnailUrlCandidates(parsedJson, seen);
    const embedded = extractEmbeddedHttpUrl(trimmed);
    return embedded ? [embedded] : [trimmed];
  }
  if (typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((entry) => collectThumbnailUrlCandidates(entry, seen));

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  const orderedKeys = [
    ...THUMBNAIL_URL_PRIORITY_KEYS.filter((key) => key in obj),
    ...keys.filter((key) => !THUMBNAIL_URL_PRIORITY_KEYS.includes(key)),
  ];
  return orderedKeys.flatMap((key) => collectThumbnailUrlCandidates(obj[key], seen));
}

function normalizeHttpUrl(value: string): string | null {
  let candidate = value.trim().replace(/^['"`]+|['"`]+$/g, '');
  if (!candidate) return null;
  if (candidate.startsWith('//')) candidate = `https:${candidate}`;
  if (!/^https?:\/\//i.test(candidate)) {
    const embedded = extractEmbeddedHttpUrl(candidate);
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

const THUMBNAIL_ROW_SOURCE_KEYS = [
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
];

export function resolveChannelThumbnailCandidates(rows: Array<any | null | undefined> | any | null | undefined): string[] {
  const rowList = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  if (!rowList.length) return [];
  const rawCandidates = rowList.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const candidates = THUMBNAIL_ROW_SOURCE_KEYS
      .filter((key) => key in row)
      .map((key) => row[key]);
    candidates.push(
      row?.snippet?.thumbnails,
      row?.snippet,
      row?.brandingSettings?.image,
    );
    return candidates;
  });
  const urls = rawCandidates
    .flatMap((entry) => collectThumbnailUrlCandidates(entry))
    .map((entry) => normalizeHttpUrl(entry))
    .filter((entry): entry is string => Boolean(entry));
  return Array.from(new Set(urls));
}
