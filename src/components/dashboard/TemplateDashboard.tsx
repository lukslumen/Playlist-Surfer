import { useState, type ReactNode } from 'react';
import type { DashboardTemplateColumn, DashboardTemplateSnapshot } from '../../lib/dashboardTemplateTypes';
import type { DashboardTemplateTab } from '../../types';
import './templateExact.css';
import { ContentFilterKind, ContentTab } from './template/ContentTab';
import { OverviewTab } from './template/OverviewTab';
import { InequalityColumn } from './template/InequalityColumn';

type Props = {
  snapshot?: DashboardTemplateSnapshot;
  calculatedAt: string;
  controls?: ReactNode;
  toolbarCenter?: ReactNode;
  activeTab?: DashboardTemplateTab;
  onTabChange?: (tab: DashboardTemplateTab) => void;
  linkingContent?: ReactNode;
  emptyStateContent?: ReactNode;
  onNavigateToItem?: (item: DashboardTemplateColumn['ranking'][number]) => void;
  onApplyContentFilter?: (kind: ContentFilterKind, label: string) => void;
  allChannelIds?: string[];
};

export default function TemplateDashboard({
  snapshot,
  calculatedAt,
  controls,
  toolbarCenter,
  activeTab,
  onTabChange,
  linkingContent,
  emptyStateContent,
  onNavigateToItem,
  onApplyContentFilter,
  allChannelIds = [],
}: Props) {
  const [internalActiveTab, setInternalActiveTab] = useState<DashboardTemplateTab>('overview');
  const resolvedActiveTab = activeTab ?? internalActiveTab;
  const setTab = (tab: DashboardTemplateTab) => {
    if (onTabChange) onTabChange(tab);
    if (activeTab === undefined) setInternalActiveTab(tab);
  };

  const shellClassName = [
    'exactdash-shell',
    resolvedActiveTab === 'linking' ? 'is-linking-view' : '',
    resolvedActiveTab !== 'linking' && !snapshot ? 'is-empty-view' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={shellClassName}>
      <div className="exactdash-header">
        <div className="exactdash-tabs" role="tablist" aria-label="Dashboard sections">
          {(['overview', 'attention', 'content', 'linking'] as DashboardTemplateTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={resolvedActiveTab === tab}
              className={`exactdash-tab ${resolvedActiveTab === tab ? 'is-active' : ''}`}
              onClick={() => setTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="exactdash-toolbar-center">{toolbarCenter}</div>
        {controls ? <div className="exactdash-controls" aria-label="Dashboard tools">{controls}</div> : null}
      </div>
      {resolvedActiveTab !== 'linking' && !snapshot ? (
        <main className="exactdash-empty-tab">{emptyStateContent}</main>
      ) : null}
      {resolvedActiveTab === 'overview' && snapshot ? <OverviewTab snapshot={snapshot} calculatedAt={calculatedAt} allChannelIds={allChannelIds} /> : null}
      {resolvedActiveTab === 'attention' && snapshot ? <main className="dashboard-frame">{snapshot.columns.map((column) => <InequalityColumn key={column.key} column={column} onNavigateToItem={onNavigateToItem} />)}</main> : null}
      {resolvedActiveTab === 'content' && snapshot ? <ContentTab snapshot={snapshot} onApplyContentFilter={onApplyContentFilter} /> : null}
      {resolvedActiveTab === 'linking' ? linkingContent : null}
    </div>
  );
}
