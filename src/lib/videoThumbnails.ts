import type { GridSortRule } from '../types';
import { resolveVideoId } from './data';

// Thumbnail URLs for a video row, the table's row order, and the thumbnail grid's layout and keyboard
// movement. The thumbnail view in the explorer is built on these.

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

export function extractSortRulesFromColumnState(columnState: any[]): GridSortRule[] {
  return (columnState || [])
    .filter((column) => column?.sort === 'asc' || column?.sort === 'desc')
    .map((column): GridSortRule => ({
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

/** AG Grid's default comparator: missing values first, then plain `<`/`>` comparison. */
function compareLikeGrid(a: unknown, b: unknown): number {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing && bMissing) return 0;
  if (aMissing) return -1;
  if (bMissing) return 1;
  return (a as any) > (b as any) ? 1 : ((a as any) < (b as any) ? -1 : 0);
}

/**
 * The rows in the order the table shows them for these sort rules. The table sorts with AG Grid's
 * default comparator and keeps the original order for ties; this does the same, so both views agree.
 */
export function sortRowsLikeGrid<T>(rows: T[], sortRules: GridSortRule[]): T[] {
  const rules = sortRules.filter((rule) => rule.columnId);
  if (!rules.length) return rows;
  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    for (const rule of rules) {
      const cmp = compareLikeGrid((a.row as any)?.[rule.columnId], (b.row as any)?.[rule.columnId]);
      if (cmp !== 0) return rule.direction === 'desc' ? -cmp : cmp;
    }
    return a.index - b.index;
  });
  return indexed.map((entry) => entry.row);
}

/** Tile widths (px) the zoom controls step through. */
export const THUMBNAIL_TILE_WIDTHS = [96, 128, 160, 200, 256, 320, 400, 520];
export const DEFAULT_THUMBNAIL_TILE_WIDTH = 200;
export const THUMBNAIL_TILE_GAP = 8;
const TILE_ASPECT = 16 / 9;

/** The nearest allowed tile width, for values restored from saved state. */
export function normalizeThumbnailTileWidth(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_THUMBNAIL_TILE_WIDTH;
  return THUMBNAIL_TILE_WIDTHS.reduce((best, width) => (Math.abs(width - numeric) < Math.abs(best - numeric) ? width : best));
}

/** The next tile width in the zoom direction, or the same width at either end. */
export function stepThumbnailTileWidth(current: number, direction: 1 | -1): number {
  const index = THUMBNAIL_TILE_WIDTHS.indexOf(normalizeThumbnailTileWidth(current));
  const next = Math.max(0, Math.min(THUMBNAIL_TILE_WIDTHS.length - 1, index + direction));
  return THUMBNAIL_TILE_WIDTHS[next];
}

export interface ThumbnailGridLayout {
  columns: number;
  tileWidth: number;
  tileHeight: number;
  /** Height of one row including the gap below it. */
  rowStride: number;
  rowCount: number;
  totalHeight: number;
}

/**
 * Fits as many columns of roughly `targetTileWidth` as the width allows, then stretches the tiles to
 * fill the row exactly, so the grid has no ragged right edge.
 */
export function computeThumbnailGridLayout(containerWidth: number, targetTileWidth: number, itemCount: number, gap = THUMBNAIL_TILE_GAP): ThumbnailGridLayout {
  const width = Math.max(0, containerWidth - gap * 2);
  const columns = Math.max(1, Math.floor((width + gap) / (targetTileWidth + gap)));
  const tileWidth = Math.max(1, Math.floor((width - gap * (columns - 1)) / columns));
  const tileHeight = Math.round(tileWidth / TILE_ASPECT);
  const rowStride = tileHeight + gap;
  const rowCount = Math.ceil(itemCount / columns);
  return {
    columns,
    tileWidth,
    tileHeight,
    rowStride,
    rowCount,
    totalHeight: rowCount ? rowCount * rowStride + gap : 0,
  };
}

/** The first and last row (inclusive) to render for a scroll position, with `overscan` extra rows. */
export function visibleThumbnailRowRange(layout: ThumbnailGridLayout, scrollTop: number, viewportHeight: number, overscan = 2) {
  if (!layout.rowCount) return { firstRow: 0, lastRow: -1 };
  const firstRow = Math.max(0, Math.floor(scrollTop / layout.rowStride) - overscan);
  const lastRow = Math.min(layout.rowCount - 1, Math.ceil((scrollTop + viewportHeight) / layout.rowStride) + overscan);
  return { firstRow, lastRow };
}

/**
 * Where an arrow, Home/End or PageUp/PageDown key moves the focus in a grid of `count` items, or
 * null for any other key. `rowsPerPage` is how many rows one page key moves.
 */
export function moveThumbnailFocusIndex(index: number, key: string, columns: number, count: number, rowsPerPage = 1): number | null {
  if (count <= 0) return null;
  const clamp = (value: number) => Math.max(0, Math.min(count - 1, value));
  const start = index < 0 ? 0 : index;
  switch (key) {
    case 'ArrowRight': return index < 0 ? 0 : clamp(start + 1);
    case 'ArrowLeft': return index < 0 ? 0 : clamp(start - 1);
    case 'ArrowDown': return index < 0 ? 0 : clamp(start + columns);
    case 'ArrowUp': return index < 0 ? 0 : clamp(start - columns);
    case 'PageDown': return clamp(start + columns * Math.max(1, rowsPerPage));
    case 'PageUp': return clamp(start - columns * Math.max(1, rowsPerPage));
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}
