import { describe, expect, test } from 'vitest';
import {
  computeThumbnailGridLayout,
  extractSortRulesFromColumnState,
  moveThumbnailFocusIndex,
  normalizeThumbnailTileWidth,
  resolveThumbnailUrlsForRow,
  sortRowsLikeGrid,
  stepThumbnailTileWidth,
  THUMBNAIL_TILE_WIDTHS,
  visibleThumbnailRowRange,
} from '../videoThumbnails';

describe('resolveThumbnailUrlsForRow', () => {
  test('reads URLs nested in JSON, embedded in text and protocol-relative', () => {
    expect(resolveThumbnailUrlsForRow({ thumbnail: '{"high":{"url":"https://cdn.example.com/high.jpg"}}' })[0]).toBe('https://cdn.example.com/high.jpg');
    expect(resolveThumbnailUrlsForRow({ thumbnail: 'preview: https://cdn.example.com/embedded.webp' })[0]).toBe('https://cdn.example.com/embedded.webp');
    expect(resolveThumbnailUrlsForRow({ thumbnail_default: '//cdn.example.com/default.jpg' })[0]).toBe('https://cdn.example.com/default.jpg');
  });

  test('falls back to YouTube image URLs from the video id, even inside a watch URL', () => {
    expect(resolveThumbnailUrlsForRow({ videoId: 'https://www.youtube.com/watch?v=abc123xyz' })).toContain('https://i.ytimg.com/vi/abc123xyz/hqdefault.jpg');
    const urls = resolveThumbnailUrlsForRow({ videoId: 'video-b', thumbnail: 'bad-url' });
    expect(urls).toEqual([
      'https://i.ytimg.com/vi/video-b/hqdefault.jpg',
      'https://i.ytimg.com/vi/video-b/mqdefault.jpg',
      'https://i.ytimg.com/vi/video-b/default.jpg',
    ]);
  });

  test('a row with neither a URL nor a video id has no candidates', () => {
    expect(resolveThumbnailUrlsForRow({ title: 'no id' })).toEqual([]);
  });
});

describe('sortRowsLikeGrid', () => {
  const rows = [
    { id: 'a', views: 10, title: 'b' },
    { id: 'b', views: null, title: 'a' },
    { id: 'c', views: 30, title: 'B' },
    { id: 'd', views: 10, title: 'a' },
  ];

  test('keeps the original order without sort rules', () => {
    expect(sortRowsLikeGrid(rows, [])).toBe(rows);
  });

  test('puts missing values first ascending and last descending, keeping ties in order', () => {
    expect(sortRowsLikeGrid(rows, [{ columnId: 'views', direction: 'asc', order: 0 }]).map((row) => row.id)).toEqual(['b', 'a', 'd', 'c']);
    expect(sortRowsLikeGrid(rows, [{ columnId: 'views', direction: 'desc', order: 0 }]).map((row) => row.id)).toEqual(['c', 'a', 'd', 'b']);
  });

  test('applies later rules to break ties, comparing strings by code point like AG Grid', () => {
    const sorted = sortRowsLikeGrid(rows, [
      { columnId: 'views', direction: 'asc', order: 0 },
      { columnId: 'title', direction: 'asc', order: 1 },
    ]);
    expect(sorted.map((row) => row.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(sortRowsLikeGrid(rows, [{ columnId: 'title', direction: 'asc', order: 0 }]).map((row) => row.title)).toEqual(['B', 'a', 'a', 'b']);
  });

  test('does not modify the input', () => {
    const copy = [...rows];
    sortRowsLikeGrid(rows, [{ columnId: 'views', direction: 'desc', order: 0 }]);
    expect(rows).toEqual(copy);
  });
});

test('extractSortRulesFromColumnState keeps sorted columns in sort-index order', () => {
  expect(extractSortRulesFromColumnState([
    { colId: 'views', sort: 'desc', sortIndex: 1 },
    { colId: 'title', sort: null },
    { colId: 'date', sort: 'asc', sortIndex: 0 },
  ])).toEqual([
    { columnId: 'date', direction: 'asc', order: 0 },
    { columnId: 'views', direction: 'desc', order: 1 },
  ]);
});

describe('tile width', () => {
  test('normalizes saved values to the nearest step and defaults when missing', () => {
    expect(normalizeThumbnailTileWidth(undefined)).toBe(200);
    expect(normalizeThumbnailTileWidth(210)).toBe(200);
    expect(normalizeThumbnailTileWidth(10_000)).toBe(THUMBNAIL_TILE_WIDTHS[THUMBNAIL_TILE_WIDTHS.length - 1]);
  });

  test('steps one size at a time and stops at both ends', () => {
    expect(stepThumbnailTileWidth(200, 1)).toBe(256);
    expect(stepThumbnailTileWidth(200, -1)).toBe(160);
    expect(stepThumbnailTileWidth(THUMBNAIL_TILE_WIDTHS[0], -1)).toBe(THUMBNAIL_TILE_WIDTHS[0]);
  });
});

describe('grid layout', () => {
  test('fits whole columns and stretches tiles to fill the width', () => {
    const layout = computeThumbnailGridLayout(1000, 200, 61, 8);
    expect(layout.columns).toBe(4);
    expect(layout.tileWidth * layout.columns + 8 * (layout.columns + 1)).toBeLessThanOrEqual(1000);
    expect(layout.tileWidth).toBeGreaterThanOrEqual(200);
    expect(layout.rowCount).toBe(16);
    expect(layout.tileHeight).toBe(Math.round(layout.tileWidth / (16 / 9)));
  });

  test('always shows at least one column and handles no items', () => {
    expect(computeThumbnailGridLayout(50, 200, 3).columns).toBe(1);
    const empty = computeThumbnailGridLayout(1000, 200, 0);
    expect(empty.totalHeight).toBe(0);
    expect(visibleThumbnailRowRange(empty, 0, 500)).toEqual({ firstRow: 0, lastRow: -1 });
  });

  test('renders only the rows in view plus overscan', () => {
    const layout = computeThumbnailGridLayout(1000, 200, 100_000);
    const range = visibleThumbnailRowRange(layout, layout.rowStride * 1000, layout.rowStride * 5, 2);
    expect(range).toEqual({ firstRow: 998, lastRow: 1007 });
  });
});

describe('moveThumbnailFocusIndex', () => {
  test('moves by one tile horizontally and one row vertically, clamped to the grid', () => {
    expect(moveThumbnailFocusIndex(5, 'ArrowRight', 4, 10)).toBe(6);
    expect(moveThumbnailFocusIndex(5, 'ArrowDown', 4, 10)).toBe(9);
    expect(moveThumbnailFocusIndex(9, 'ArrowDown', 4, 10)).toBe(9);
    expect(moveThumbnailFocusIndex(1, 'ArrowUp', 4, 10)).toBe(0);
  });

  test('starts at the first tile when nothing is focused', () => {
    expect(moveThumbnailFocusIndex(-1, 'ArrowDown', 4, 10)).toBe(0);
    expect(moveThumbnailFocusIndex(-1, 'End', 4, 10)).toBe(9);
  });

  test('pages by whole screens and ignores other keys', () => {
    expect(moveThumbnailFocusIndex(0, 'PageDown', 4, 100, 3)).toBe(12);
    expect(moveThumbnailFocusIndex(50, 'PageUp', 4, 100, 3)).toBe(38);
    expect(moveThumbnailFocusIndex(3, 'Enter', 4, 10)).toBeNull();
    expect(moveThumbnailFocusIndex(0, 'ArrowDown', 4, 0)).toBeNull();
  });
});
