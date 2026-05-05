import {
  DashboardThumbnailCandidate,
  DashboardThumbnailPersistentScopeKey,
  DashboardThumbnailScopeKey,
  DashboardThumbnailSortRule,
} from '../types';
import { resolveVideoId, resolveVideoTitle } from './data';

const THUMBNAIL_URL_PRIORITY_KEYS = [
  'thumbnailUrl',
  'thumbnail',
  'thumbnail_default',
  'thumbnail_medium',
  'thumbnail_high',
  'thumbnail_maxres',
  'thumbnail_url',
  'thumbnail_src',
  'thumbnailSrc',
  'image',
  'image_url',
  'imageUrl',
  'image_src',
  'imageSrc',
  'url',
  'src',
  'href',
  'default',
  'medium',
  'high',
  'maxres',
  'thumbnails',
  'snippet',
  'snippet_thumbnails',
  'media',
];

export const THUMBNAIL_LIMIT = 500;

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

function normalizeThumbnailUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let candidate = String(value).trim().replace(/^['"`]+|['"`]+$/g, '');
  if (!candidate) return null;
  if (candidate.startsWith('//')) candidate = `https:${candidate}`;
  if (!/^https?:\/\//i.test(candidate)) {
    const embedded = extractEmbeddedHttpUrl(candidate);
    if (!embedded) return null;
    candidate = embedded;
  }
  candidate = candidate.replace(/[),.;]+$/g, '');
  if (!candidate) return null;
  const normalized = candidate.startsWith('//') ? `https:${candidate}` : candidate;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractVideoIdFromYouTubeUrl(value: string): string | null {
  try {
    const parsed = new URL(value.startsWith('//') ? `https:${value}` : value);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'youtu.be') {
      const segment = parsed.pathname.split('/').filter(Boolean)[0];
      return segment ? segment.trim() : null;
    }
    if (!hostname.includes('youtube.com')) return null;
    const watchId = parsed.searchParams.get('v');
    if (watchId) return watchId.trim();
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live')) {
      return parts[1].trim();
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeVideoIdForThumbnailFallback(videoId: string | null): string | null {
  const raw = String(videoId || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('//')) {
    return extractVideoIdFromYouTubeUrl(raw);
  }
  return raw;
}

function parseNumberLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseDateLike(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) return Math.floor(value);
    if (value > 1e9) return Math.floor(value * 1000);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    if (Number.isFinite(numeric)) {
      if (numeric > 1e12) return Math.floor(numeric);
      if (numeric > 1e9) return Math.floor(numeric * 1000);
    }
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareUnknown(a: unknown, b: unknown): number {
  const numericA = parseNumberLike(a);
  const numericB = parseNumberLike(b);
  if (numericA !== null && numericB !== null) return numericA - numericB;
  if (numericA !== null) return -1;
  if (numericB !== null) return 1;

  const dateA = parseDateLike(a);
  const dateB = parseDateLike(b);
  if (dateA !== null && dateB !== null) return dateA - dateB;
  if (dateA !== null) return -1;
  if (dateB !== null) return 1;

  const textA = String(a ?? '').toLowerCase();
  const textB = String(b ?? '').toLowerCase();
  if (!textA && !textB) return 0;
  if (!textA) return 1;
  if (!textB) return -1;
  return textA.localeCompare(textB);
}

function fallbackOrder(rows: any[]) {
  return [...rows].sort((a, b) => {
    const posA = parseNumberLike(a?.position ?? a?.Position ?? null);
    const posB = parseNumberLike(b?.position ?? b?.Position ?? null);
    if (posA !== null && posB !== null && posA !== posB) return posA - posB;
    if (posA !== null && posB === null) return -1;
    if (posA === null && posB !== null) return 1;

    const viewsA = parseNumberLike(a?.viewCount ?? a?.view_count ?? a?.views ?? a?.Views ?? null);
    const viewsB = parseNumberLike(b?.viewCount ?? b?.view_count ?? b?.views ?? b?.Views ?? null);
    if (viewsA !== null && viewsB !== null && viewsA !== viewsB) return viewsB - viewsA;
    if (viewsA !== null && viewsB === null) return -1;
    if (viewsA === null && viewsB !== null) return 1;

    const titleCompare = compareUnknown(resolveVideoTitle(a), resolveVideoTitle(b));
    if (titleCompare !== 0) return titleCompare;
    return compareUnknown(resolveVideoId(a), resolveVideoId(b));
  });
}

export function extractSortRulesFromColumnState(columnState: any[]): DashboardThumbnailSortRule[] {
  return (columnState || [])
    .filter((column) => column?.sort === 'asc' || column?.sort === 'desc')
    .map((column): DashboardThumbnailSortRule => ({
      columnId: String(column.colId || ''),
      direction: column.sort === 'desc' ? 'desc' : 'asc',
      order: Number.isFinite(Number(column.sortIndex)) ? Number(column.sortIndex) : Number.MAX_SAFE_INTEGER,
    }))
    .filter((rule) => rule.columnId)
    .sort((a, b) => a.order - b.order);
}

export function resolveThumbnailUrlsForRow(row: any): string[] {
  const urlCandidates = THUMBNAIL_URL_PRIORITY_KEYS
    .filter((key) => row && typeof row === 'object' && key in row)
    .map((key) => row[key]);
  urlCandidates.push(
    row?.snippet?.thumbnails,
    row?.snippet,
    row?.media,
    row?.thumbnails,
  );
  const urls = urlCandidates
    .flatMap((value) => collectThumbnailUrlCandidates(value))
    .map((value) => normalizeThumbnailUrl(value))
    .filter((value): value is string => Boolean(value));
  const fallbackVideoId = normalizeVideoIdForThumbnailFallback(resolveVideoId(row));
  if (fallbackVideoId) {
    const encoded = encodeURIComponent(fallbackVideoId);
    urls.push(
      `https://i.ytimg.com/vi/${encoded}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${encoded}/mqdefault.jpg`,
      `https://i.ytimg.com/vi/${encoded}/default.jpg`,
    );
  }
  return Array.from(new Set(urls));
}

export function resolveThumbnailUrlForRow(row: any): string | null {
  return resolveThumbnailUrlsForRow(row)[0] || null;
}

function orderBySortRules(rows: any[], sortRules: DashboardThumbnailSortRule[]) {
  const rules = sortRules.filter((rule) => rule.columnId);
  if (!rules.length) return fallbackOrder(rows);
  return [...rows].sort((a, b) => {
    for (const rule of rules) {
      const cmp = compareUnknown(a?.[rule.columnId], b?.[rule.columnId]);
      if (cmp !== 0) return rule.direction === 'desc' ? -cmp : cmp;
    }
    return compareUnknown(resolveVideoId(a), resolveVideoId(b));
  });
}

export function selectThumbnailCandidates(args: {
  rows: any[];
  sortRules?: DashboardThumbnailSortRule[];
  limit?: number;
}): DashboardThumbnailCandidate[] {
  const limit = Math.max(1, Math.min(args.limit ?? THUMBNAIL_LIMIT, THUMBNAIL_LIMIT));
  const sortedRows = args.sortRules?.length
    ? orderBySortRules(args.rows, args.sortRules)
    : fallbackOrder(args.rows);

  const seen = new Set<string>();
  const candidates: DashboardThumbnailCandidate[] = [];

  for (const row of sortedRows) {
    const videoId = resolveVideoId(row) || '';
    const candidateUrls = resolveThumbnailUrlsForRow(row);
    const sourceUrl = candidateUrls[0] || '';
    if (!candidateUrls.length && !videoId) continue;
    const dedupeKey = videoId || `url:${sourceUrl || resolveVideoTitle(row)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    candidates.push({
      videoId: videoId || dedupeKey,
      dedupeKey,
      title: resolveVideoTitle(row),
      sourceUrl,
      candidateUrls,
      rank: candidates.length + 1,
    });
    if (candidates.length >= limit) break;
  }

  return candidates;
}

export function buildSavedViewThumbnailScopeKey(savedViewId: string): `savedView:${string}` {
  return `savedView:${savedViewId}`;
}

export function isSavedViewThumbnailScopeKey(scopeKey: string): scopeKey is `savedView:${string}` {
  return scopeKey.startsWith('savedView:');
}

export function isPersistentThumbnailScopeKey(scopeKey: string): scopeKey is DashboardThumbnailPersistentScopeKey {
  return scopeKey === 'full' || isSavedViewThumbnailScopeKey(scopeKey);
}

export function inferFileExtensionFromMimeType(mimeType?: string) {
  const normalized = (mimeType || '').toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('bmp')) return 'bmp';
  return 'jpg';
}

export function sanitizeThumbnailPathSegment(value: string, fallback = 'thumbnail') {
  const safe = String(value || '')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '');
  return safe || fallback;
}

export function buildThumbnailSortSignature(sortRules: DashboardThumbnailSortRule[]) {
  if (!sortRules.length) return 'fallback:position:viewCount';
  return sortRules.map((rule) => `${rule.columnId}:${rule.direction}:${rule.order}`).join('|');
}

export function resolveThumbnailCacheLabel(scopeKey: DashboardThumbnailScopeKey, savedViewName?: string) {
  if (scopeKey === 'full') return 'Full dataset thumbnails';
  if (scopeKey === 'filtered-temp') return 'Filtered selection thumbnails';
  return savedViewName ? `Saved view thumbnails: ${savedViewName}` : 'Saved view thumbnails';
}
