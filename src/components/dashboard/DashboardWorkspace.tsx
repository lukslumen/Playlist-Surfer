import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Filter, Maximize2, Minimize2, RefreshCw, Rows3, X } from 'lucide-react';
import { DashboardScope, DashboardTemplateTab, DatasetDashboardSnapshot } from '../../types';
import type { DashboardTemplateVideoRecord, OverviewDrilldown } from '../../lib/dashboardTemplateTypes';
import TemplateDashboard, { type DashboardCompare } from './TemplateDashboard';
import LinkingDashboard from './LinkingDashboard';
import type { ExplorerFilterModel } from '../../lib/filterCoordinator';

export type DashboardWorkspaceProps = {
  isOpen: boolean;
  scope: DashboardScope;
  onScopeChange: (scope: DashboardScope) => void;
  onRefresh: () => void;
  onClose: () => void;
  snapshot?: DatasetDashboardSnapshot;
  stale: boolean;
  activeTab: DashboardTemplateTab;
  onActiveTabChange: (tab: DashboardTemplateTab) => void;
  onDocumentSizeChange?: (size: { width: number; height: number }) => void;
  onNavigateToVideo?: (videoId: string) => void;
  onOverviewDrilldown?: (drilldown: OverviewDrilldown) => void;
  /** "none", "full" or "view:<id>". */
  compareValue: string;
  compareOptions: Array<{ value: string; label: string }>;
  onCompareChange: (value: string) => void;
  compare?: DashboardCompare;
  scopeLabel: string;
  getScopeRecords?: () => DashboardTemplateVideoRecord[];
  vernacularExclusions: string[];
  onVernacularExclusionsChange?: (exclusions: string[]) => void;
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

const DASHBOARD_CANVAS_WIDTH = 1320;
const DASHBOARD_CANVAS_HEIGHT = Math.round((DASHBOARD_CANVAS_WIDTH * 2) / 3);
const MIN_DASHBOARD_SCALE = 0.2;

function measureDashboardHeight(contentNode: HTMLDivElement | null): number {
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
  onDocumentSizeChange,
  onNavigateToVideo,
  onOverviewDrilldown,
  compareValue,
  compareOptions,
  onCompareChange,
  compare,
  scopeLabel,
  getScopeRecords,
  vernacularExclusions,
  onVernacularExclusionsChange,
  linkingProps,
}: DashboardWorkspaceProps) {
  const fitContentWidth = DASHBOARD_CANVAS_WIDTH;
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fitScale, setFitScale] = useState(1);
  const [fitSize, setFitSize] = useState({ width: DASHBOARD_CANVAS_WIDTH, height: DASHBOARD_CANVAS_HEIGHT });
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const fitContentRef = useRef<HTMLDivElement | null>(null);

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

  const recomputeFit = useCallback(() => {
    const workspaceNode = workspaceRef.current;
    if (!workspaceNode) return;
    const rect = workspaceNode.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const unscaledContentHeight = measureDashboardHeight(fitContentRef.current);
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
  }, [isFullscreen, onDocumentSizeChange]);

  useEffect(() => {
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
  }, [activeTab, isFullscreen, recomputeFit, scope, snapshot?.calculatedAt]);

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
      }
    };
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleFullscreen, isOpen]);

  const controls = (
    <>
      <div className="dash-segmented is-toolbar" role="group" aria-label="Dashboard scope">
        <button type="button" onClick={() => onScopeChange('full')} className={scope === 'full' ? 'is-active' : undefined} aria-pressed={scope === 'full'} title="Show whole database dashboard" aria-label="Show whole database dashboard">
          <Rows3 size={13} strokeWidth={1.8} /> Whole database
        </button>
        <button type="button" onClick={() => onScopeChange('filtered')} className={scope === 'filtered' ? 'is-active' : undefined} aria-pressed={scope === 'filtered'} title="Show filtered-view dashboard" aria-label="Show filtered-view dashboard">
          <Filter size={13} strokeWidth={1.8} /> Filtered view
        </button>
      </div>
      <label className="dash-compare-select">
        <span>Compare</span>
        <select value={compareValue} onChange={(event) => onCompareChange(event.target.value)} aria-label="Compare with">
          {compareOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <span className={`dash-status-dot ${!snapshot ? 'is-empty' : stale ? 'is-stale' : 'is-fresh'}`} title={freshnessLabel} aria-label={freshnessLabel} />
      <button type="button" onClick={onRefresh} className="dash-icon-button" title="Regenerate dashboard" aria-label="Regenerate dashboard">
        <RefreshCw size={14} strokeWidth={1.8} />
      </button>
      <button type="button" onClick={handleCopy} disabled={!canCopy} className={`dash-icon-button ${copied ? 'is-copied' : ''}`} title={copied ? 'Write-up copied' : copyLabel} aria-label={copied ? 'Write-up copied' : copyLabel}>
        <Copy size={14} strokeWidth={1.8} />
      </button>
      <button type="button" onClick={onClose} className="dash-icon-button" title="Close dashboard" aria-label="Close dashboard">
        <X size={14} strokeWidth={1.8} />
      </button>
    </>
  );

  const toolbarCenter = (
    <button
      type="button"
      onClick={() => void handleToggleFullscreen()}
      className={`dash-icon-button ${isFullscreen ? 'is-active' : ''}`}
      title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Enter fullscreen (F)'}
      aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
    >
      {isFullscreen ? <Minimize2 size={14} strokeWidth={1.8} /> : <Maximize2 size={14} strokeWidth={1.8} />}
    </button>
  );

  const emptyStateContent = (
    <section className="dash-card dash-outdated">
      <strong>No snapshot yet</strong>
      <span>Generate a dashboard for the {scope === 'full' ? 'whole dataset' : 'filtered view'}. It is kept until the data changes.</span>
      <button type="button" onClick={onRefresh} className="dash-button">Generate dashboard</button>
    </section>
  );

  const dashboardTemplate = (
    <TemplateDashboard
      snapshot={snapshot?.template}
      calculatedAt={snapshot?.calculatedAt || new Date().toISOString()}
      controls={controls}
      toolbarCenter={toolbarCenter}
      activeTab={activeTab}
      onTabChange={onActiveTabChange}
      linkingContent={<LinkingDashboard {...linkingProps} />}
      emptyStateContent={emptyStateContent}
      onDrilldown={onOverviewDrilldown}
      onNavigateToVideo={onNavigateToVideo}
      onRegenerate={onRefresh}
      compare={compare}
      scopeLabel={scopeLabel}
      getScopeRecords={getScopeRecords}
      vernacularExclusions={vernacularExclusions}
      onVernacularExclusionsChange={onVernacularExclusionsChange}
    />
  );

  return (
    <div ref={workspaceRef} className={`dashboard-reference-workspace ${isFullscreen ? 'is-workspace-fullscreen' : 'is-workspace-popover'}`}>
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
    </div>
  );
}
