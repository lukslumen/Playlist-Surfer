import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Check, ImageOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatDateDisplay, formatDurationDisplay, resolveChannelName, resolvePublishedAt, resolveVideoId, resolveVideoTitle, resolveViews } from '../../lib/data';
import { isDeleteKey } from '../../lib/keyboard';
import type { ScopeSelectionState, ScopeSelectionUpdate } from '../../lib/selectionState';
import {
  THUMBNAIL_TILE_GAP,
  computeThumbnailGridLayout,
  moveThumbnailFocusIndex,
  resolveThumbnailUrlsForRow,
  stepThumbnailTileWidth,
  visibleThumbnailRowRange,
} from '../../lib/videoThumbnails';

interface ThumbnailGridProps {
  /** Rows in display order (already filtered and sorted like the table). */
  rows: any[];
  selection: ScopeSelectionState;
  onSelectionChange: (update: ScopeSelectionUpdate) => void;
  /** Delete / Backspace: move the selection between Included and Excluded. */
  onMoveSelection?: (videoIds: string[]) => void;
  /** Ctrl/Cmd + Delete: exclude (or restore) the selection. */
  onExcludeSelection?: (videoIds: string[]) => void;
  onUnkeyedRowInteraction?: () => void;
  tileWidth: number;
  onTileWidthChange: (width: number) => void;
  isLoading?: boolean;
  /** Shown when there are no rows to display. */
  emptyState?: ReactNode;
}

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function formatViews(value: unknown): string {
  const numeric = Number(String(value ?? '').replace(/,/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return `${compactNumber.format(numeric)} views`;
}

function resolveDuration(row: any): unknown {
  return row?.duration ?? row?.durationSec ?? row?.duration_sec ?? null;
}

interface ThumbnailTileProps {
  row: any;
  videoId: string | null;
  index: number;
  isSelected: boolean;
  isFocused: boolean;
  style: CSSProperties;
  onTileMouseDown: (event: MouseEvent<HTMLDivElement>, index: number) => void;
}

/** One tile. Tries each thumbnail URL in turn and falls back to the title when none loads. */
const ThumbnailTile = memo(function ThumbnailTile({ row, videoId, index, isSelected, isFocused, style, onTileMouseDown }: ThumbnailTileProps) {
  const urls = useMemo(() => resolveThumbnailUrlsForRow(row), [row]);
  // Which URL failed last, tied to the URL list so a changed row starts again from the first one.
  const [failed, setFailed] = useState<{ urls: string[]; count: number }>({ urls, count: 0 });
  const urlIndex = failed.urls === urls ? failed.count : 0;
  const url = urls[urlIndex];
  const title = resolveVideoTitle(row) || videoId || 'Untitled video';
  const channel = resolveChannelName(row);
  const meta = [channel, formatViews(resolveViews(row)), formatDateDisplay(resolvePublishedAt(row))].filter(Boolean).join(' · ');
  const duration = formatDurationDisplay(resolveDuration(row));

  return (
    <div
      role="option"
      aria-selected={isSelected}
      aria-label={title}
      data-video-id={videoId ?? undefined}
      data-thumbnail-index={index}
      className={cn('thumbnail-tile group', isSelected && 'is-selected', isFocused && 'is-focused', !videoId && 'is-unkeyed')}
      style={style}
      onMouseDown={(event) => onTileMouseDown(event, index)}
    >
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          decoding="async"
          onError={() => setFailed({ urls, count: urlIndex + 1 })}
        />
      ) : (
        <div className="thumbnail-tile-fallback">
          <ImageOff size={18} aria-hidden="true" />
          <span>{title}</span>
        </div>
      )}
      <div className="thumbnail-tile-info" aria-hidden="true">
        <p className="thumbnail-tile-title">{title}</p>
        {meta ? <p className="thumbnail-tile-meta">{meta}</p> : null}
      </div>
      {duration ? <span className="thumbnail-tile-duration" aria-hidden="true">{duration}</span> : null}
      {isSelected ? (
        <span className="thumbnail-tile-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
      ) : null}
    </div>
  );
});

/**
 * The explorer's thumbnail view: the same rows as the table, as a virtualized grid of images that
 * shares the table's selection, Delete/Backspace handling and keyboard navigation.
 */
export function ThumbnailGrid({
  rows,
  selection,
  onSelectionChange,
  onMoveSelection,
  onExcludeSelection,
  onUnkeyedRowInteraction,
  tileWidth,
  onTileWidthChange,
  isLoading = false,
  emptyState,
}: ThumbnailGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  // Latest selection for event handlers that fire before the next render (e.g. a key right after a click).
  const selectionRef = useRef(selection);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  const videoIds = useMemo(() => rows.map((row) => resolveVideoId(row)), [rows]);
  const indexByVideoId = useMemo(() => {
    const map = new Map<string, number>();
    videoIds.forEach((videoId, index) => {
      if (videoId && !map.has(videoId)) map.set(videoId, index);
    });
    return map;
  }, [videoIds]);
  const selectedSet = useMemo(() => new Set(selection.selectedKeys), [selection.selectedKeys]);

  const layout = useMemo(
    () => computeThumbnailGridLayout(viewport.width, tileWidth, rows.length),
    [rows.length, tileWidth, viewport.width],
  );
  const { firstRow, lastRow } = visibleThumbnailRowRange(layout, scrollTop, viewport.height);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /** Scrolls just enough to show the tile at `index`, or centres it when `center` is set. */
  const scrollIndexIntoView = useCallback((index: number, center = false) => {
    const node = scrollRef.current;
    if (!node || index < 0 || !layout.columns) return;
    const top = Math.floor(index / layout.columns) * layout.rowStride + THUMBNAIL_TILE_GAP;
    const bottom = top + layout.tileHeight;
    if (center) {
      node.scrollTop = Math.max(0, top - (node.clientHeight - layout.tileHeight) / 2);
    } else if (top < node.scrollTop) {
      node.scrollTop = top - THUMBNAIL_TILE_GAP;
    } else if (bottom > node.scrollTop + node.clientHeight) {
      node.scrollTop = bottom - node.clientHeight + THUMBNAIL_TILE_GAP;
    }
  }, [layout.columns, layout.rowStride, layout.tileHeight]);

  // Keep the focused video in view when it changes from outside (Back/Forward, the detail panel, ↑/↓),
  // and centre the selection when the view opens or the zoom changes.
  const focusVideoId = selection.focusKey || selection.detailKey;
  const focusIndex = focusVideoId ? (indexByVideoId.get(focusVideoId) ?? -1) : -1;
  const hasCenteredRef = useRef(false);
  useEffect(() => {
    if (!viewport.width || focusIndex < 0) return;
    scrollIndexIntoView(focusIndex, !hasCenteredRef.current);
    hasCenteredRef.current = true;
  }, [focusIndex, scrollIndexIntoView, viewport.width]);
  useEffect(() => {
    hasCenteredRef.current = false;
  }, [tileWidth]);

  const selectIndex = useCallback((index: number, mode: 'single' | 'toggle' | 'range') => {
    const videoId = videoIds[index];
    if (!videoId) {
      onUnkeyedRowInteraction?.();
      return;
    }
    const current = selectionRef.current;
    let update: ScopeSelectionUpdate;
    if (mode === 'range') {
      const anchorId = current.anchorKey || current.focusKey || videoId;
      const anchorIndex = indexByVideoId.get(anchorId) ?? index;
      const [from, to] = anchorIndex <= index ? [anchorIndex, index] : [index, anchorIndex];
      const rangeIds = videoIds.slice(from, to + 1).filter((id): id is string => Boolean(id));
      update = { selectedKeys: rangeIds, anchorKey: anchorId, focusKey: videoId, detailKey: videoId };
    } else if (mode === 'toggle') {
      const next = new Set<string>(current.selectedKeys);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      const selectedKeys = Array.from(next);
      update = {
        selectedKeys,
        anchorKey: selectedKeys.length ? videoId : null,
        focusKey: selectedKeys.length ? videoId : null,
        detailKey: videoId,
      };
    } else {
      update = { selectedKeys: [videoId], anchorKey: videoId, focusKey: videoId, detailKey: videoId };
    }
    selectionRef.current = {
      selectedKeys: update.selectedKeys,
      anchorKey: update.anchorKey ?? null,
      focusKey: update.focusKey ?? null,
      detailKey: update.detailKey ?? null,
    };
    onSelectionChange(update);
  }, [indexByVideoId, onSelectionChange, onUnkeyedRowInteraction, videoIds]);

  const handleTileMouseDown = useCallback((event: MouseEvent<HTMLDivElement>, index: number) => {
    if (event.button !== 0) return;
    // Keep focus on the grid so keys work straight away, without scrolling the page.
    event.preventDefault();
    scrollRef.current?.focus({ preventScroll: true });
    const mode = event.shiftKey ? 'range' : (event.metaKey || event.ctrlKey ? 'toggle' : 'single');
    selectIndex(index, mode);
  }, [selectIndex]);

  const zoom = useCallback((direction: 1 | -1) => {
    onTileWidthChange(stepThumbnailTileWidth(tileWidth, direction));
  }, [onTileWidthChange, tileWidth]);

  // Pinch (Ctrl + wheel) zooms the tiles. React's wheel listener is passive, so register our own.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (Math.abs(event.deltaY) < 4) return;
      zoom(event.deltaY < 0 ? 1 : -1);
    };
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, [zoom]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    const current = selectionRef.current;
    const hasModifier = event.ctrlKey || event.metaKey;

    if (isDeleteKey(event.key) && current.selectedKeys.length > 0) {
      event.preventDefault();
      if (hasModifier) onExcludeSelection?.(current.selectedKeys);
      else onMoveSelection?.(current.selectedKeys);
      return;
    }
    if (hasModifier && (event.key === '=' || event.key === '+' || event.key === '-')) {
      event.preventDefault();
      zoom(event.key === '-' ? -1 : 1);
      return;
    }
    if (hasModifier && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      const allIds = videoIds.filter((id): id is string => Boolean(id));
      onSelectionChange({
        selectedKeys: allIds,
        anchorKey: allIds[0] ?? null,
        focusKey: allIds[allIds.length - 1] ?? null,
        detailKey: current.detailKey,
      });
      return;
    }
    if (hasModifier && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      onSelectionChange({ selectedKeys: [], anchorKey: null, focusKey: null, detailKey: current.detailKey });
      return;
    }
    if (hasModifier || event.altKey) return;

    const currentId = current.focusKey || current.detailKey;
    const currentIndex = currentId ? (indexByVideoId.get(currentId) ?? -1) : -1;
    const rowsPerPage = Math.max(1, Math.floor(viewport.height / Math.max(1, layout.rowStride)));
    const nextIndex = moveThumbnailFocusIndex(currentIndex, event.key, layout.columns, rows.length, rowsPerPage);
    if (nextIndex === null) return;
    event.preventDefault();
    selectIndex(nextIndex, event.shiftKey ? 'range' : 'single');
  }, [indexByVideoId, layout.columns, layout.rowStride, onExcludeSelection, onMoveSelection, onSelectionChange, rows.length, selectIndex, videoIds, viewport.height, zoom]);

  const tiles = [];
  for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex += 1) {
    for (let column = 0; column < layout.columns; column += 1) {
      const index = rowIndex * layout.columns + column;
      if (index >= rows.length) break;
      const videoId = videoIds[index];
      tiles.push(
        <ThumbnailTile
          key={videoId || `row-${index}`}
          row={rows[index]}
          videoId={videoId}
          index={index}
          isSelected={Boolean(videoId && selectedSet.has(videoId))}
          isFocused={Boolean(videoId && videoId === focusVideoId)}
          onTileMouseDown={handleTileMouseDown}
          style={{
            width: layout.tileWidth,
            height: layout.tileHeight,
            transform: `translate(${THUMBNAIL_TILE_GAP + column * (layout.tileWidth + THUMBNAIL_TILE_GAP)}px, ${THUMBNAIL_TILE_GAP + rowIndex * layout.rowStride}px)`,
          }}
        />,
      );
    }
  }

  return (
    <div className="thumbnail-grid-shell relative h-full w-full">
      <div
        ref={scrollRef}
        className="thumbnail-grid-scroll h-full w-full overflow-y-auto overflow-x-hidden focus:outline-none"
        tabIndex={0}
        role="listbox"
        aria-multiselectable="true"
        aria-label="Video thumbnails"
        data-thumbnail-grid-root="true"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={handleKeyDown}
      >
        <div className="relative" style={{ height: layout.totalHeight }}>
          {tiles}
        </div>
      </div>

      {rows.length === 0 && !isLoading ? emptyState : null}

    </div>
  );
}
