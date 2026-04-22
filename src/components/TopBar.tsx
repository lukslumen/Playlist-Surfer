import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Upload,
  PanelRightClose,
  PanelRightOpen,
  Save,
  Trash2,
  ChevronDown,
  Download,
  Eye,
  Notebook,
  LayoutDashboard,
  X,
  Check,
  Moon,
  Sun,
  Video,
  UserRound,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { InclusionView, SavedView, ThemeMode, ViewScope } from '../types';
import { cn } from '../lib/utils';

interface TopBarProps {
  fileName: string | null;
  onFileUpload: (file: File) => void;
  isIngesting: boolean;
  savedViews: SavedView[];
  activeViewId: string | null;
  onSaveView: (name: string) => void;
  onApplyView: (view: SavedView | null) => void;
  onDeleteView: (id: string) => void;
  isRightPanelCollapsed: boolean;
  onToggleRightPanel: () => void;
  onExport: () => void;
  onToggleColumns: () => void;
  onOpenResearchLog: () => void;
  onOpenDashboard: () => void;
  inclusionView: InclusionView;
  onInclusionViewChange: (view: InclusionView) => void;
  includedCount: number;
  excludedCount: number;
  theme: ThemeMode;
  onToggleTheme: () => void;
  hasLoadedData: boolean;
  viewScope: ViewScope;
  onViewScopeChange: (scope: ViewScope) => void;
  hasChannelMetadata: boolean;
  saveViewRequestKey?: number;
  importRequestKey?: number;
  onRenameProject?: (name: string) => void;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
}

export default function TopBar({
  fileName,
  onFileUpload,
  isIngesting,
  savedViews,
  activeViewId,
  onSaveView,
  onApplyView,
  onDeleteView,
  isRightPanelCollapsed,
  onToggleRightPanel,
  onExport,
  onToggleColumns,
  onOpenResearchLog,
  onOpenDashboard,
  inclusionView,
  onInclusionViewChange,
  includedCount,
  excludedCount,
  theme,
  onToggleTheme,
  hasLoadedData,
  viewScope,
  onViewScopeChange,
  hasChannelMetadata,
  saveViewRequestKey = 0,
  importRequestKey = 0,
  onRenameProject,
  onNavigateBack,
  onNavigateForward,
  canNavigateBack = false,
  canNavigateForward = false,
}: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [isRenamingProject, setIsRenamingProject] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const clickedAnchor = !!anchorRef.current && anchorRef.current.contains(target);
      const clickedDropdown = !!dropdownRef.current && dropdownRef.current.contains(target);
      if (!clickedAnchor && !clickedDropdown) {
        setIsMenuOpen(false);
        setShowSaveInput(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!showSaveInput || !saveInputRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      saveInputRef.current?.focus();
      saveInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showSaveInput, saveViewRequestKey]);

  useEffect(() => {
    if (!saveViewRequestKey || !hasLoadedData) return;
    setIsMenuOpen(true);
    setShowSaveInput(true);
    const frame = window.requestAnimationFrame(() => {
      saveInputRef.current?.focus();
      saveInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasLoadedData, saveViewRequestKey]);

  useEffect(() => {
    if (!importRequestKey || isIngesting) return;
    fileInputRef.current?.click();
  }, [importRequestKey, isIngesting]);

  useEffect(() => {
    if (!isMenuOpen) return;

    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.left + rect.width / 2,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isMenuOpen]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onFileUpload(file);
      event.target.value = '';
    }
  };

  const handleSaveViewSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (newViewName.trim()) {
      onSaveView(newViewName.trim());
      setNewViewName('');
      setShowSaveInput(false);
    }
  };

  const handleToggleMenu = () => {
    setIsMenuOpen((current) => !current);
    if (isMenuOpen) setShowSaveInput(false);
  };

  const handleTriggerSave = () => {
    setIsMenuOpen(true);
    setShowSaveInput(true);
  };

  useEffect(() => {
    if (!isRenamingProject) return;
    setProjectNameDraft(fileName || 'ytde_project');
  }, [fileName, isRenamingProject]);

  const commitProjectRename = () => {
    const trimmed = projectNameDraft.trim();
    if (!onRenameProject || !trimmed) {
      setIsRenamingProject(false);
      return;
    }
    onRenameProject(trimmed);
    setIsRenamingProject(false);
  };

  const handleProjectRenameStart = () => {
    if (!hasLoadedData || !onRenameProject) return;
    setIsMenuOpen(false);
    setShowSaveInput(false);
    setProjectNameDraft(fileName || 'ytde_project');
    setIsRenamingProject(true);
  };

  const isPinkMode = theme === 'pink-pop';

  const renderIcon = (defaultIcon: React.ReactNode, pinkEmoji: string, label: string) =>
    isPinkMode ? (
      <span aria-hidden="true" className="pink-emoji-icon" title={label}>
        {pinkEmoji}
      </span>
    ) : (
      defaultIcon
    );

  const renderPanelToggleIcon = () => {
    if (isPinkMode) {
      return <img src="/pink-ui/panel-toggle-pink.svg" alt="" className="h-[18px] w-[18px] object-contain" aria-hidden="true" />;
    }
    return isRightPanelCollapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />;
  };

  const dropdown = isMenuOpen && menuPosition && createPortal(
    <div
      ref={dropdownRef}
      className="fixed z-[120] w-72 border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
      style={{ top: menuPosition.top, left: menuPosition.left, transform: 'translateX(-50%)' }}
    >
      <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-2">
        <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Saved Project Views</span>
      </div>

      <div className="border-b border-[var(--border-color)] p-2">
        {showSaveInput ? (
          <form onSubmit={handleSaveViewSubmit} className="flex flex-col gap-2 p-1">
            <input
              ref={saveInputRef}
              type="text"
              placeholder="Enter view name..."
              value={newViewName}
              onChange={(event) => setNewViewName(event.target.value)}
              className="w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              onKeyDown={(event) => event.key === 'Escape' && setShowSaveInput(false)}
            />
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setShowSaveInput(false)} className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]">
                {renderIcon(<X size={10} />, '💔', 'Cancel')} Cancel
              </button>
              <button type="submit" disabled={!newViewName.trim()} className="flex items-center gap-1.5 bg-[var(--accent)] px-3 py-1 text-[10px] font-bold text-white transition-colors hover:opacity-90 disabled:opacity-50">
                {renderIcon(<Check size={10} />, '✨', 'Save New View')} Save New View
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowSaveInput(true)}
            className="group flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-primary)]"
          >
            {renderIcon(<Save size={12} className="text-[var(--accent)] transition-transform group-hover:scale-110" />, '💘', 'Save View')}
            Save Current Configuration as View...
          </button>
        )}
      </div>

      <div className="custom-scrollbar max-h-64 overflow-y-auto p-1">
        <div
          className={cn(
            'flex cursor-pointer items-center px-3 py-2 text-xs transition-colors',
            !activeViewId ? 'bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] font-bold text-[var(--accent)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-main)]',
          )}
          onClick={() => {
            onApplyView(null);
            setIsMenuOpen(false);
          }}
        >
          <span className="flex-1">Default Grid (Reset)</span>
        </div>

        {savedViews.map((view) => (
          <div
            key={view.id}
            className={cn(
              'group/item flex items-center gap-2 px-3 py-2 text-xs transition-colors',
              activeViewId === view.id
                ? 'bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] font-bold text-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-main)]',
            )}
          >
            <button
              onClick={() => {
                onApplyView(view);
                setIsMenuOpen(false);
              }}
              className="min-w-0 flex-1 truncate text-left"
              title={view.name}
            >
              {view.name}
            </button>
            <button
              onClick={() => onDeleteView(view.id)}
              className="p-1 opacity-0 transition-opacity hover:text-[var(--accent)] group-hover/item:opacity-100"
              title="Delete View"
            >
              {renderIcon(<Trash2 size={12} />, '🗑️', 'Delete View')}
            </button>
          </div>
        ))}

        {savedViews.length === 0 && !showSaveInput && (
          <div className="px-3 py-6 text-center text-[11px] italic text-[var(--text-muted)]">
            No custom views saved yet.<br />Use the Save button to capture your current layout.
          </div>
        )}
      </div>
    </div>,
    document.body,
  );

  return (
    <header className="topbar-shell relative z-30 flex h-[52px] flex-shrink-0 items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-4">
      <div className="z-10 flex items-center gap-2 md:gap-3">
        <div className="inline-flex h-8 items-center overflow-hidden rounded-sm border border-[var(--border-color)] bg-[var(--bg-primary)]" role="group" aria-label="Navigation history">
          <button
            type="button"
            onClick={onNavigateBack}
            disabled={!canNavigateBack}
            className="topbar-view-segment h-full border-r border-[var(--border-color)] px-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--grid-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40"
            title="Back (Ctrl + Left Arrow)"
            aria-label="Back"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={onNavigateForward}
            disabled={!canNavigateForward}
            className="topbar-view-segment h-full px-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--grid-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40"
            title="Forward (Ctrl + Right Arrow)"
            aria-label="Forward"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isIngesting}
          className={cn(
            'topbar-action-button flex items-center gap-2 border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50',
            !fileName
              ? 'border-[var(--accent)] bg-[var(--accent)] text-white hover:opacity-90'
              : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-main)] hover:bg-[var(--grid-hover)]',
          )}
        >
          {renderIcon(<Upload size={16} />, '🌸', 'Import')}
          <span>{isIngesting ? 'Ingesting...' : 'Import'}</span>
        </button>
        <input ref={fileInputRef} type="file" accept=".csv,.zip" onChange={handleFileChange} className="hidden" />

        <button
          onClick={onOpenResearchLog}
          className="topbar-icon-button p-1.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]"
          title="Research Log"
        >
          {renderIcon(<Notebook size={18} />, '💌', 'Research Log')}
        </button>

        <button
          onClick={onOpenDashboard}
          className="topbar-icon-button p-1.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]"
          title="Dataset Dashboard"
        >
          {renderIcon(<LayoutDashboard size={18} />, '📊', 'Dataset Dashboard')}
        </button>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-36">
        <div className="pointer-events-auto relative w-full max-w-[430px]" ref={anchorRef}>
          <div className="topbar-view-box relative flex h-8 items-center overflow-visible border border-[var(--border-color)] bg-[var(--bg-primary)]">
            <button
              onClick={onToggleColumns}
              className="topbar-view-segment h-full border-r border-[var(--border-color)] px-2.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--grid-hover)] hover:text-[var(--text-main)]"
              title="Toggle Columns"
            >
              {renderIcon(<Eye size={14} />, '👁️', 'Toggle Columns')}
            </button>

            <div className="relative h-full min-w-0 flex-1">
              {isRenamingProject ? (
                <div className="flex h-full items-center px-2">
                  <input
                    autoFocus
                    type="text"
                    value={projectNameDraft}
                    onChange={(event) => setProjectNameDraft(event.target.value)}
                    onBlur={commitProjectRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitProjectRename();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setIsRenamingProject(false);
                      }
                    }}
                    className="w-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-[11px] font-mono text-[var(--text-main)] focus:outline-none"
                    aria-label="Rename project"
                  />
                </div>
              ) : (
                <button
                  onClick={handleToggleMenu}
                  onDoubleClick={handleProjectRenameStart}
                  className={cn(
                    'topbar-view-name flex h-full w-full items-center justify-center gap-2 px-4 text-center transition-colors',
                    isMenuOpen ? 'bg-[var(--grid-hover)]' : 'hover:bg-[var(--grid-hover)]',
                  )}
                  title={activeViewId ? 'Double-click to rename the project. Click to manage saved views.' : 'Click to manage saved views. Double-click to rename the project.'}
                >
                  {activeViewId ? (
                    <span className="truncate font-mono text-[11px] font-medium text-[var(--text-main)]">{savedViews.find((view) => view.id === activeViewId)?.name || fileName || 'Playlist Surfer'}</span>
                  ) : fileName ? (
                    <span className="truncate font-mono text-[11px] font-medium text-[var(--text-main)]">{fileName}</span>
                  ) : (
                    <span className="truncate text-[11px] italic text-[var(--text-muted)]">Playlist Surfer</span>
                  )}
                  <ChevronDown size={10} className={cn('shrink-0 transition-transform duration-200', isMenuOpen && 'rotate-180')} />
                </button>
              )}
            </div>

            <button
              onClick={handleTriggerSave}
              className="topbar-view-segment h-full border-l border-[var(--border-color)] px-2.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--grid-hover)] hover:text-[var(--text-main)]"
              title="Save Current View"
            >
              {renderIcon(<Save size={14} />, '💖', 'Save Current View')}
            </button>
          </div>
        </div>
      </div>

      <div className="z-10 ml-auto flex items-center gap-2 md:gap-3">
        {hasLoadedData && (
          <div
            className="inline-flex h-8 items-center overflow-hidden rounded-sm border border-[var(--border-color)] bg-[var(--bg-primary)]"
            title={hasChannelMetadata
              ? 'Switch between video and channel exploration scopes.'
              : 'Switch between video and channel exploration scopes. Generate channel metadata in Channels view first.'}
          >
            <button
              type="button"
              onClick={() => onViewScopeChange('videos')}
              className={cn(
                'inline-flex h-full w-9 items-center justify-center border-r border-[var(--border-color)] text-[var(--text-muted)] transition-colors',
                viewScope === 'videos'
                  ? 'bg-[color-mix(in_oklab,var(--accent)_12%,var(--bg-primary))] text-[var(--text-main)]'
                  : 'bg-[var(--bg-primary)] hover:bg-[var(--grid-hover)] hover:text-[var(--text-main)]',
              )}
              title="Show videos table and video detail workflow"
              aria-label="Show videos scope"
            >
              {renderIcon(<Video size={14} />, '🎬', 'Videos')}
              <span className="sr-only">Videos</span>
            </button>
            <button
              type="button"
              onClick={() => onViewScopeChange('channels')}
              className={cn(
                'inline-flex h-full w-9 items-center justify-center text-[var(--text-muted)] transition-colors',
                viewScope === 'channels'
                  ? 'bg-[color-mix(in_oklab,var(--accent)_12%,var(--bg-primary))] text-[var(--text-main)]'
                  : 'bg-[var(--bg-primary)] hover:bg-[var(--grid-hover)] hover:text-[var(--text-main)]',
              )}
              title="Show generated channel metadata table"
              aria-label={hasChannelMetadata ? 'Show channels scope' : 'Show channels scope (metadata not generated yet)'}
            >
              {renderIcon(<UserRound size={14} />, '👤', 'Channels')}
              <span className="sr-only">Channels</span>
            </button>
          </div>
        )}

        {hasLoadedData && (
          <div
            className="inline-flex h-8 items-center overflow-hidden rounded-sm border border-[var(--border-color)] bg-[var(--bg-primary)]"
            title="Tip: select rows in the grid, then press Delete to move them between Included and Excluded."
          >
            <button
              type="button"
              onClick={() => onInclusionViewChange('included')}
              className={cn(
                'inline-flex h-full w-9 items-center justify-center border-r border-[var(--border-color)] text-[var(--text-muted)] transition-colors',
                inclusionView === 'included'
                  ? 'bg-[color-mix(in_oklab,var(--accent)_12%,var(--bg-primary))] text-[var(--text-main)]'
                  : 'bg-[var(--bg-primary)] hover:bg-[var(--grid-hover)] hover:text-[var(--text-main)]',
              )}
              title={`Show included videos (${includedCount.toLocaleString()}). Tip: select rows and press Delete to move them to the other list.`}
              aria-label={`Show included videos. ${includedCount.toLocaleString()} videos. Tip: select rows and press Delete to move them to the other list.`}
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={() => onInclusionViewChange('excluded')}
              className={cn(
                'inline-flex h-full w-9 items-center justify-center text-[var(--text-muted)] transition-colors',
                inclusionView === 'excluded'
                  ? 'bg-[color-mix(in_oklab,var(--accent)_12%,var(--bg-primary))] text-[var(--text-main)]'
                  : 'bg-[var(--bg-primary)] hover:bg-[var(--grid-hover)] hover:text-[var(--text-main)]',
              )}
              title={`Show excluded videos (${excludedCount.toLocaleString()}). Tip: select rows and press Delete to move them to the other list.`}
              aria-label={`Show excluded videos. ${excludedCount.toLocaleString()} videos. Tip: select rows and press Delete to move them to the other list.`}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {hasLoadedData && (
          <button
            onClick={onToggleRightPanel}
            className="topbar-icon-button p-1.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]"
            title={isRightPanelCollapsed ? 'Show viewer panel' : 'Hide viewer panel'}
          >
            {renderPanelToggleIcon()}
          </button>
        )}

        <button
          onClick={onToggleTheme}
          className="topbar-icon-button p-1.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]"
          title={theme === 'warm-light' ? 'Switch to black mode' : 'Switch to light mode'}
        >
          {theme === 'warm-light'
            ? renderIcon(<Moon size={18} />, '🖤', 'Switch to black mode')
            : renderIcon(<Sun size={18} />, '☀️', 'Switch to light mode')}
        </button>

        <button
          onClick={onExport}
          className={cn(
            'topbar-action-button flex items-center gap-2 border px-3 py-1.5 text-[13px] font-medium transition-colors',
            fileName
              ? 'border-[var(--accent)] bg-[var(--accent)] text-white hover:opacity-90'
              : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-muted)] hover:bg-[var(--grid-hover)]',
          )}
          title="Export"
        >
          {renderIcon(<Download size={16} />, '🎁', 'Export')}
          <span>Export</span>
        </button>
      </div>
      {dropdown}
    </header>
  );
}
