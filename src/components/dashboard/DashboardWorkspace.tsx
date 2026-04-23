import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from 'react';
import { Copy, Filter, Maximize2, Minimize2, Minus, Plus, RefreshCw, Rows3, X } from 'lucide-react';
import {
  DashboardScope,
  DashboardTemplateTab,
  DashboardThumbnailCacheSnapshot,
  DashboardThumbnailLoadProgress,
  DatasetDashboardSnapshot,
} from '../../types';
import TemplateDashboard from './TemplateDashboard';
import LinkingDashboard from './LinkingDashboard';
import type { ExplorerFilterModel } from '../../lib/filterCoordinator';

type Props = {
  isOpen: boolean;
  scope: DashboardScope;
  onScopeChange: (scope: DashboardScope) => void;
  onRefresh: () => void;
  onClose: () => void;
  snapshot?: DatasetDashboardSnapshot;
  stale: boolean;
  activeTab: DashboardTemplateTab;
  onActiveTabChange: (tab: DashboardTemplateTab) => void;
  thumbnailCache?: DashboardThumbnailCacheSnapshot;
  thumbnailLoadProgress?: DashboardThumbnailLoadProgress | null;
  thumbnailTileSize: number;
  canZoomOut: boolean;
  canZoomIn: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onLoadFullThumbnails: () => void;
  onLoadFilteredThumbnails: () => void;
  onThumbnailEntryLoad: (scopeKey: DashboardThumbnailCacheSnapshot['scopeKey'], dedupeKey: string, loadedUrl?: string) => void;
  onThumbnailEntryError: (scopeKey: DashboardThumbnailCacheSnapshot['scopeKey'], dedupeKey: string, failedUrl?: string) => void;
  onRetryFailedThumbnails: () => void;
  onDocumentSizeChange?: (size: { width: number; height: number }) => void;
  onNavigateToVideo?: (videoId: string) => void;
  onNavigateToChannel?: (channel: { channelId?: string | null; channelName?: string }) => void;
  onApplyContentFilter?: (kind: 'category' | 'topic' | 'duration' | 'intent', label: string) => void;
  allChannelIds?: string[];
  linkingProps: {
    rows: any[];
    state: any;
    sourceItems: Array<{ id: string; label: string; visible: boolean }>;
    onGenerate: (sourceColumn: string) => void;
    onSelectSource: (sourceColumn: string) => void;
    onApplyOverride: (args: { domain: string; baseBucket?: string; note?: string; revert?: boolean }) => void;
    onSaveOverrideBatch: (assignments: Array<{ domain: string; baseBucket: string }>) => Promise<void> | void;
    onApplyDrilldown: (args: { filters: ExplorerFilterModel; visibleColumns?: string[] }) => void;
  };
};

type ThumbnailLayout = {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  gap: number;
  offsetX: number;
  offsetY: number;
};

const THUMBNAIL_TILE_ASPECT = 16 / 9;
const DASHBOARD_CANVAS_WIDTH = 1320;
const DASHBOARD_CANVAS_HEIGHT = Math.round((DASHBOARD_CANVAS_WIDTH * 2) / 3);
const MIN_DASHBOARD_SCALE = 0.2;

function measureDashboardHeight(contentNode: HTMLDivElement | null, activeTab: DashboardTemplateTab, isFullscreen: boolean): number {
  // Thumbnails contain a large internal scroll area; using scrollHeight there causes
  // fit-to-contain to treat the entire scrollable content as visible height and shrink
  // the dashboard to a narrow strip after fullscreen exit.
  if (activeTab === 'thumbnails' && !isFullscreen) return DASHBOARD_CANVAS_HEIGHT;
  if (!contentNode) return DASHBOARD_CANVAS_HEIGHT;
  const shell = contentNode.querySelector<HTMLElement>('.exactdash-shell');

  const measuredHeight = Math.ceil(Math.max(
    0,
    shell?.offsetHeight || 0,
    contentNode.offsetHeight || 0,
    shell?.scrollHeight || 0,
  ));
  return Math.max(DASHBOARD_CANVAS_HEIGHT, measuredHeight);
}

function computeThumbnailLayout(availableWidth: number, availableHeight: number, itemCount: number, targetTileWidth: number): ThumbnailLayout {
  const safeWidth = Math.max(240, Math.floor(availableWidth));
  const safeHeight = Math.max(180, Math.floor(availableHeight));
  const count = Math.max(0, itemCount);
  const gap = 2;
  const desiredWidth = Math.max(88, Math.floor(targetTileWidth));
  const singleColumnPreferred = desiredWidth >= safeWidth * 0.72;

  if (!count) {
    const tileWidth = Math.max(120, safeWidth);
    return {
      columns: 1,
      rows: 1,
      tileWidth,
      tileHeight: Math.max(56, Math.round(tileWidth / THUMBNAIL_TILE_ASPECT)),
      gap,
      offsetX: 0,
      offsetY: 0,
    };
  }

  const targetColumns = singleColumnPreferred
    ? 1
    : Math.max(1, Math.floor((safeWidth + gap) / (desiredWidth + gap)));
  const columns = Math.max(1, Math.min(count, targetColumns));
  const tileWidth = Math.max(88, Math.floor((safeWidth - gap * Math.max(0, columns - 1)) / columns));
  const tileHeight = Math.max(56, Math.round(tileWidth / THUMBNAIL_TILE_ASPECT));
  const rows = Math.max(1, Math.ceil(count / columns));
  const contentHeight = rows * tileHeight + gap * Math.max(0, rows - 1);

  return {
    columns,
    rows,
    tileWidth,
    tileHeight,
    gap,
    offsetX: 0,
    offsetY: Math.max(0, Math.floor((safeHeight - contentHeight) / 2)),
  };
}


async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall back
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export default function DashboardWorkspace({
  isOpen,
  scope,
  onScopeChange,
  onRefresh,
  onClose,
  snapshot,
  stale,
  activeTab,
  onActiveTabChange,
  thumbnailCache,
  thumbnailLoadProgress,
  thumbnailTileSize,
  canZoomOut,
  canZoomIn,
  onZoomOut,
  onZoomIn,
  onLoadFullThumbnails,
  onLoadFilteredThumbnails,
  onThumbnailEntryLoad,
  onThumbnailEntryError,
  onRetryFailedThumbnails,
  onDocumentSizeChange,
  onNavigateToVideo,
  onNavigateToChannel,
  onApplyContentFilter,
  allChannelIds = [],
  linkingProps,
}: Props) {
  const fitContentWidth = DASHBOARD_CANVAS_WIDTH;
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fitScale, setFitScale] = useState(1);
  const [fitSize, setFitSize] = useState({ width: DASHBOARD_CANVAS_WIDTH, height: DASHBOARD_CANVAS_HEIGHT });
  const [thumbnailLayout, setThumbnailLayout] = useState<ThumbnailLayout>(() => computeThumbnailLayout(1280, 920, thumbnailCache?.entries?.length ?? 0, thumbnailTileSize));
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const fitContentRef = useRef<HTMLDivElement | null>(null);
  const thumbnailGridWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setCopied(false);
  }, [isOpen, snapshot?.calculatedAt]);

  const freshnessLabel = !snapshot ? 'Not calculated' : stale ? 'Stale' : 'Fresh';
  const copyPayload = snapshot?.template?.detailedSummaryText || snapshot?.template?.summaryText || '';
  const canCopy = Boolean(copyPayload);
  const copyLabel = useMemo(() => (canCopy ? 'Copy dashboard write-up' : 'Copy disabled'), [canCopy]);

  const handleCopy = async () => {
    if (!copyPayload) return;
    await copyText(copyPayload);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1300);
  };

  const shouldFillThumbnailViewport = activeTab === 'thumbnails' && isFullscreen;

  const recomputeFit = useCallback(() => {
    const workspaceNode = workspaceRef.current;
    if (!workspaceNode) return;
    const rect = workspaceNode.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const unscaledContentHeight = measureDashboardHeight(fitContentRef.current, activeTab, isFullscreen);
    const horizontalPadding = isFullscreen ? 24 : 0;
    const verticalPadding = isFullscreen ? 0 : 0;
    const maxContentWidth = Math.max(320, rect.width - (horizontalPadding * 2));
    const maxContentHeight = Math.max(240, rect.height - (verticalPadding * 2));
    const nextScale = Math.max(
      MIN_DASHBOARD_SCALE,
      Math.min(maxContentWidth / DASHBOARD_CANVAS_WIDTH, maxContentHeight / unscaledContentHeight),
    );
    const nextWidth = Math.max(1, Math.floor(DASHBOARD_CANVAS_WIDTH * nextScale));
    const nextHeight = Math.max(1, Math.floor(unscaledContentHeight * nextScale));

    setFitScale(nextScale);
    setFitSize({ width: nextWidth, height: nextHeight });
    onDocumentSizeChange?.({ width: nextWidth, height: nextHeight });
  }, [activeTab, isFullscreen, onDocumentSizeChange]);

  useEffect(() => {
    if (shouldFillThumbnailViewport) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(recomputeFit);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    if (workspaceRef.current) observer.observe(workspaceRef.current);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [activeTab, isFullscreen, recomputeFit, scope, shouldFillThumbnailViewport, snapshot?.calculatedAt]);

  useEffect(() => {
    if (!shouldFillThumbnailViewport) return;
    const update = () => {
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      onDocumentSizeChange?.({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [onDocumentSizeChange, shouldFillThumbnailViewport]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'thumbnails') return;
    const node = thumbnailGridWrapRef.current;
    if (!node) return;

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        // `clientWidth/clientHeight` stay in the element's unscaled layout space even when
        // the dashboard is transform-scaled in popover mode. That keeps column math and
        // scroll behavior consistent while still filling the full available width.
        const layoutWidth = node.clientWidth;
        const layoutHeight = node.clientHeight;
        if (!layoutWidth || !layoutHeight) return;
        setThumbnailLayout(computeThumbnailLayout(layoutWidth, layoutHeight, thumbnailCache?.entries?.length ?? 0, thumbnailTileSize));
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [activeTab, isFullscreen, isOpen, thumbnailCache?.entries?.length, thumbnailTileSize]);

  const handleThumbnailGridWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const node = thumbnailGridWrapRef.current;
    if (!node) return;

    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(node.clientHeight, 1) : 1;
    const nextTop = node.scrollTop + (event.deltaY * unit);
    const nextLeft = node.scrollLeft + (event.deltaX * unit);
    const beforeTop = node.scrollTop;
    const beforeLeft = node.scrollLeft;

    node.scrollTop = nextTop;
    node.scrollLeft = nextLeft;

    if (node.scrollTop !== beforeTop || node.scrollLeft !== beforeLeft) {
      event.preventDefault();
    }
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    const shell = workspaceRef.current;
    if (!shell) return;
    try {
      if (document.fullscreenElement === shell) {
        await document.exitFullscreen();
        return;
      }
      await shell.requestFullscreen();
    } catch {
      // fullscreen can fail in restricted environments
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (typeof document === 'undefined') {
        setIsFullscreen(false);
        return;
      }
      setIsFullscreen(document.fullscreenElement === workspaceRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    onFullscreenChange();
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => () => {
    if (document.fullscreenElement === workspaceRef.current) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, []);


  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest('input, textarea, select, [contenteditable="true"]')) return;

      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        void handleToggleFullscreen();
        return;
      }

      if (event.key === 'Escape' && document.fullscreenElement === workspaceRef.current) {
        event.preventDefault();
        void document.exitFullscreen().catch(() => undefined);
        return;
      }

      if (activeTab !== 'thumbnails') return;
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.altKey) return;

      const key = event.key;
      const code = event.code;
      if (key === '+' || key === '=' || code === 'NumpadAdd') {
        event.preventDefault();
        if (canZoomIn) onZoomIn();
        return;
      }
      if (key === '-' || key === '_' || code === 'NumpadSubtract') {
        event.preventDefault();
        if (canZoomOut) onZoomOut();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, canZoomIn, canZoomOut, handleToggleFullscreen, isOpen, onZoomIn, onZoomOut]);

  const controls = (
    <>
      <div className="inline-flex h-8 items-center overflow-hidden rounded-sm border border-[var(--line)] bg-[var(--surface)]" role="group" aria-label="Dashboard scope">
        <button
          type="button"
          onClick={() => onScopeChange('full')}
          className={`inline-flex h-full items-center gap-1.5 border-r border-[var(--line)] px-3 text-[11px] font-medium transition-colors ${scope === 'full' ? 'bg-[var(--accent-soft)] text-[var(--text)]' : 'bg-transparent text-[var(--muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'}`}
          title="Show whole database dashboard"
          aria-label="Show whole database dashboard"
        >
          <Rows3 size={13} strokeWidth={1.8} />
          <span>Whole database</span>
        </button>
        <button
          type="button"
          onClick={() => onScopeChange('filtered')}
          className={`inline-flex h-full items-center gap-1.5 px-3 text-[11px] font-medium transition-colors ${scope === 'filtered' ? 'bg-[var(--accent-soft)] text-[var(--text)]' : 'bg-transparent text-[var(--muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'}`}
          title="Show filtered-view dashboard"
          aria-label="Show filtered-view dashboard"
        >
          <Filter size={13} strokeWidth={1.8} />
          <span>Filtered view</span>
        </button>
      </div>
      <span className={`exactdash-status-dot ${stale ? 'is-stale' : 'is-fresh'} ${!snapshot ? 'is-empty' : ''}`} title={freshnessLabel} aria-label={freshnessLabel} />
      <button type="button" onClick={onRefresh} className="exactdash-control" title="Regenerate dashboard" aria-label="Regenerate dashboard">
        <RefreshCw size={14} strokeWidth={1.8} />
      </button>
      <button type="button" onClick={handleCopy} disabled={!canCopy} className={`exactdash-control ${copied ? 'is-copied' : ''}`} title={copied ? 'Write-up copied' : copyLabel} aria-label={copied ? 'Write-up copied' : copyLabel}>
        <Copy size={14} strokeWidth={1.8} />
      </button>
      <button type="button" onClick={onClose} className="exactdash-control" title="Close dashboard" aria-label="Close dashboard">
        <X size={14} strokeWidth={1.8} />
      </button>
    </>
  );

  const toolbarCenter = (
    <div className="exactdash-toolbar-pill" role="group" aria-label={activeTab === 'thumbnails' ? 'Thumbnail zoom and fullscreen controls' : 'Dashboard fullscreen controls'}>
      {activeTab === 'thumbnails' ? (
        <>
          <button
            type="button"
            onClick={onZoomOut}
            disabled={!canZoomOut}
            className="exactdash-control"
            title="Zoom out thumbnails (Ctrl -)"
            aria-label="Zoom out thumbnails"
          >
            <Minus size={14} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            disabled={!canZoomIn}
            className="exactdash-control"
            title="Zoom in thumbnails (Ctrl +)"
            aria-label="Zoom in thumbnails"
          >
            <Plus size={14} strokeWidth={1.8} />
          </button>
        </>
      ) : null}
      <button
        type="button"
        onClick={() => void handleToggleFullscreen()}
        className={`exactdash-control ${isFullscreen ? 'is-active' : ''}`}
        title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Enter fullscreen (F)'}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >
        {isFullscreen ? <Minimize2 size={14} strokeWidth={1.8} /> : <Maximize2 size={14} strokeWidth={1.8} />}
      </button>
    </div>
  );

  const hasThumbnailEntries = Boolean(thumbnailCache?.entries?.length);
  const thumbnailScopeLabel = thumbnailCache?.label || (scope === 'full' ? 'Full dataset thumbnails' : 'Filtered selection thumbnails');
  const thumbnailFailedCount = thumbnailCache?.entries?.filter((entry) => entry.status === 'failed').length || 0;
  const thumbnailProgressLabel = thumbnailLoadProgress
    ? `${thumbnailLoadProgress.completed.toLocaleString()}/${thumbnailLoadProgress.total.toLocaleString()}`
    : null;
  const thumbnailSkeletonCount = Math.max(12, Math.min(24, thumbnailLayout.columns * Math.max(thumbnailLayout.rows, 3)));

  const thumbnailContent = (
    <div className="exactdash-thumbnails-root">
      <div className="exactdash-thumbnails-status">
        <span>{thumbnailScopeLabel}</span>
        <span className="inline-flex items-center gap-2">
          {thumbnailProgressLabel && thumbnailLoadProgress?.loading ? (
            <b>
              loading {thumbnailProgressLabel}
              {thumbnailLoadProgress.failed > 0 ? ` (${thumbnailLoadProgress.failed.toLocaleString()} failed)` : ''}
            </b>
          ) : (
            <b>{hasThumbnailEntries ? `${thumbnailCache?.entries.filter((entry) => entry.status === 'loaded').length.toLocaleString()} loaded` : 'No cache yet'}</b>
          )}
          {thumbnailFailedCount > 0 ? (
            <button
              type="button"
              className="exactdash-control"
              onClick={onRetryFailedThumbnails}
              title="Retry failed thumbnails"
              aria-label="Retry failed thumbnails"
            >
              Retry failed
            </button>
          ) : null}
        </span>
      </div>

      <div
        ref={thumbnailGridWrapRef}
        className={`exactdash-thumbnails-grid-wrap ${isFullscreen ? 'is-fullscreen' : ''} ${shouldFillThumbnailViewport ? 'is-fill-screen' : ''}`}
        onWheelCapture={handleThumbnailGridWheel}
      >
        {hasThumbnailEntries ? (
          <div
            className="exactdash-thumbnails-grid"
            style={{
              gridTemplateColumns: `repeat(${thumbnailLayout.columns}, ${thumbnailLayout.tileWidth}px)`,
              gridAutoRows: `${thumbnailLayout.tileHeight}px`,
              gap: `${thumbnailLayout.gap}px`,
              paddingLeft: `${thumbnailLayout.offsetX}px`,
              paddingTop: `${thumbnailLayout.offsetY}px`,
            }}
          >
            {thumbnailCache?.entries.map((entry) => {
              const tileImageUrl = entry.objectUrl || entry.activeUrl || entry.sourceUrl;
              const content = (
                <>
                  {tileImageUrl ? (
                    <img
                      src={tileImageUrl}
                      alt={entry.title || entry.videoId}
                      loading="lazy"
                      decoding="async"
                      onLoad={() => onThumbnailEntryLoad(thumbnailCache.scopeKey, entry.dedupeKey, tileImageUrl)}
                      onError={() => onThumbnailEntryError(thumbnailCache.scopeKey, entry.dedupeKey, tileImageUrl)}
                    />
                  ) : null}
                  {entry.status === 'pending' ? <div className="exactdash-thumb-pending">Loading</div> : null}
                  {entry.status === 'failed' ? <div className="exactdash-thumb-failed">Failed</div> : null}
                </>
              );
              return entry.videoId ? (
                <button
                  key={entry.dedupeKey}
                  type="button"
                  className="exactdash-thumb-tile"
                  title={entry.title || entry.videoId}
                  onClick={() => onNavigateToVideo?.(entry.videoId)}
                >
                  {content}
                </button>
              ) : (
                <div key={entry.dedupeKey} className="exactdash-thumb-tile" title={entry.title || entry.videoId}>
                  {content}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="exactdash-thumbnails-placeholder-grid" aria-hidden="true">
            {Array.from({ length: thumbnailSkeletonCount }).map((_, index) => (
              <div key={index} className="exactdash-thumb-skeleton" />
            ))}
          </div>
        )}
      </div>

      {!hasThumbnailEntries ? (
        <div className="exactdash-thumbnails-cta">
          <div className="exactdash-thumbnails-cta-card">
            <div className="exactdash-thumbnails-cta-title">Load thumbnails</div>
            <p className="exactdash-thumbnails-cta-copy">
              Thumbnails load on demand. Start with the full dataset or just the currently filtered selection.
            </p>
            <div className="exactdash-thumbnails-cta-actions">
              <button
                type="button"
                onClick={onLoadFullThumbnails}
                className="exactdash-tab is-active"
                disabled={Boolean(thumbnailLoadProgress?.loading)}
              >
                Load full dataset thumbnails
              </button>
              <button
                type="button"
                onClick={onLoadFilteredThumbnails}
                className="exactdash-tab"
                disabled={Boolean(thumbnailLoadProgress?.loading)}
              >
                Load filtered selection thumbnails
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  const emptyStateContent = (
    <div className="exactdash-empty-card exactdash-empty-card-hero">
      <div className="exactdash-empty-eyebrow">Dashboard</div>
      <div className="exactdash-empty-hero-row">
        <div className="exactdash-empty-hero-copy">
          <div className="exactdash-empty-card-title">No snapshot yet</div>
          <p>
            Generate a dashboard snapshot for the current {scope === 'full' ? 'full dataset' : 'filtered view'} to populate all tabs.
          </p>
        </div>
        <button type="button" onClick={onRefresh} className="exactdash-tab is-active exactdash-empty-primary">Generate dashboard</button>
      </div>
      <div className="exactdash-empty-support">Snapshots are cached and reused until source/row state changes.</div>
    </div>
  );

  const navigateToItem = (item: any) => {
    if (item.kind === 'channel') {
      onNavigateToChannel?.({ channelId: item.channelId, channelName: item.channelName || item.label });
      return;
    }
    if (item.videoId) onNavigateToVideo?.(item.videoId);
  };

  const dashboardTemplate = (
    <TemplateDashboard
      snapshot={snapshot?.template}
      calculatedAt={snapshot?.calculatedAt || new Date().toISOString()}
      controls={controls}
      toolbarCenter={toolbarCenter}
      activeTab={activeTab}
      onTabChange={onActiveTabChange}
      thumbnailsContent={thumbnailContent}
      linkingContent={<LinkingDashboard {...linkingProps} />}
      emptyStateContent={emptyStateContent}
      fullscreenMode={shouldFillThumbnailViewport}
      onApplyContentFilter={onApplyContentFilter}
      onNavigateToItem={navigateToItem}
      allChannelIds={allChannelIds}
    />
  );

  return (
    <div ref={workspaceRef} className={`dashboard-reference-workspace ${isFullscreen ? 'is-workspace-fullscreen' : 'is-workspace-popover'}`}>
      {shouldFillThumbnailViewport ? (
        dashboardTemplate
      ) : (
        <div className="dashboard-fit-root">
          <div className="dashboard-fit-stage" style={{ width: `${fitSize.width}px`, height: `${fitSize.height}px` }}>
            <div
              ref={fitContentRef}
              className="dashboard-fit-content"
              style={{ transform: `scale(${fitScale})`, width: `${fitContentWidth}px` }}
            >
              {dashboardTemplate}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
