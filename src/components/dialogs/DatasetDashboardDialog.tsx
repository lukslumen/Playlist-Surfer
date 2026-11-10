import type { ExplorerFilterModel } from '../../lib/filterCoordinator';
import { DashboardScope, DashboardTemplateTab, DatasetDashboardSnapshot } from '../../types';
import DashboardWorkspace from '../dashboard/DashboardWorkspace';

export interface DatasetDashboardDialogProps {
  isOpen: boolean;
  onClose: () => void;
  scope: DashboardScope;
  onScopeChange: (scope: DashboardScope) => void;
  onRefresh: () => void;
  snapshot?: DatasetDashboardSnapshot;
  stale: boolean;
  activeTab: DashboardTemplateTab;
  onActiveTabChange: (tab: DashboardTemplateTab) => void;
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
}

export function DatasetDashboardDialog({
  isOpen,
  onClose,
  scope,
  onScopeChange,
  onRefresh,
  snapshot,
  stale,
  activeTab,
  onActiveTabChange,
  onNavigateToVideo,
  onNavigateToChannel,
  onApplyContentFilter,
  allChannelIds = [],
  linkingProps,
}: DatasetDashboardDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="dialog-shell flex h-screen w-screen max-h-screen max-w-screen flex-col overflow-hidden bg-transparent p-0 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: '100vw',
          height: '100vh',
        }}
      >
        <DashboardWorkspace
          isOpen={isOpen}
          scope={scope}
          onScopeChange={onScopeChange}
          onRefresh={onRefresh}
          onClose={onClose}
          snapshot={snapshot}
          stale={stale}
          activeTab={activeTab}
          onActiveTabChange={onActiveTabChange}
          onNavigateToVideo={onNavigateToVideo}
          onNavigateToChannel={onNavigateToChannel}
          onApplyContentFilter={onApplyContentFilter}
          allChannelIds={allChannelIds}
          linkingProps={linkingProps}
        />
      </div>
    </div>
  );
}
