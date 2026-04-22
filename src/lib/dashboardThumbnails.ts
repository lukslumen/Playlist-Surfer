import {
  DashboardThumbnailCandidate,
  DashboardThumbnailPersistentScopeKey,
  DashboardThumbnailScopeKey,
  DashboardThumbnailSortRule,
} from '../types';
import { resolveVideoId, resolveVideoTitle } from './data';

const THUMBNAIL_URL_FIELDS = [
  'thumbnailUrl',
  'thumbnail',
  'thumbnail_default',
  'thumbnail_medium',
  'thumbnail_high',
  'thumbnail_maxres',
];

export const THUMBNAIL_LIMIT = 500;

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

export function resolveThumbnailUrlForRow(row: any): string | null {
  for (const field of THUMBNAIL_URL_FIELDS) {
    const value = row?.[field];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (!text) continue;
    if (text.startsWith('//')) return `https:${text}`;
    return text;
  }
  const videoId = resolveVideoId(row);
  if (!videoId) return null;
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
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
    const sourceUrl = resolveThumbnailUrlForRow(row);
    if (!sourceUrl && !videoId) continue;
    const dedupeKey = videoId || `url:${sourceUrl}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    candidates.push({
      videoId: videoId || dedupeKey,
      dedupeKey,
      title: resolveVideoTitle(row),
      sourceUrl: sourceUrl || '',
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
