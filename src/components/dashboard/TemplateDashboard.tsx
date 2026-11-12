import { useState, type ReactNode } from 'react';
import type { DashboardTemplateSnapshot, DashboardTemplateVideoRecord, OverviewDrilldown } from '../../lib/dashboardTemplateTypes';
import type { DashboardTemplateTab } from '../../types';
import './templateExact.css';
import './dashboard.css';
import { OverviewTab } from './template/OverviewTab';
import { AttentionTab } from './tabs/AttentionTab';
import { VernacularTab } from './tabs/VernacularTab';
import { TimeTab } from './tabs/TimeTab';

export interface DashboardCompare {
  snapshot: DashboardTemplateSnapshot;
  /** e.g. "whole dataset" or "saved view: Cartels". */
  label: string;
  /** The comparison set's rows as dashboard records, for exact comparisons (computed on demand). */
  getRecords?: () => DashboardTemplateVideoRecord[];
}

/** What every analysis tab receives. */
export interface DashboardTabProps {
  snapshot: DashboardTemplateSnapshot;
  compare?: DashboardCompare;
  /** Label of the current scope, for exports and comparison headers. */
  scopeLabel: string;
  onDrilldown?: (drilldown: OverviewDrilldown) => void;
  onNavigateToVideo?: (videoId: string) => void;
  onRegenerate?: () => void;
  /** The scope's rows as dashboard records, for full-size exports (computed on demand). */
  getScopeRecords?: () => DashboardTemplateVideoRecord[];
}

const TABS: Array<{ id: DashboardTemplateTab; label: string; question: string }> = [
  { id: 'overview', label: 'Overview', question: 'What is in this set?' },
  { id: 'attention', label: 'Attention', question: 'Who and what gets seen?' },
  { id: 'vernacular', label: 'Vernacular', question: 'How is this space named?' },
  { id: 'time', label: 'Time', question: 'When, and how does it change?' },
  { id: 'linking', label: 'Links', question: 'Where does it point outside YouTube?' },
];

type Props = Omit<DashboardTabProps, 'snapshot'> & {
  snapshot?: DashboardTemplateSnapshot;
  calculatedAt: string;
  controls?: ReactNode;
  toolbarCenter?: ReactNode;
  activeTab?: DashboardTemplateTab;
  onTabChange?: (tab: DashboardTemplateTab) => void;
  linkingContent?: ReactNode;
  emptyStateContent?: ReactNode;
  vernacularExclusions: string[];
  onVernacularExclusionsChange?: (exclusions: string[]) => void;
};

/** Snapshots made before the redesign lack the per-tab profiles; they need regenerating once. */
function OutdatedSnapshot({ onRegenerate }: { onRegenerate?: () => void }) {
  return (
    <main className="dash">
      <section className="dash-card dash-outdated">
        <strong>This snapshot was made by an earlier version of the dashboards.</strong>
        <span>Regenerate it to see this tab.</span>
        {onRegenerate ? <button type="button" className="dash-button" onClick={onRegenerate}>Regenerate</button> : null}
      </section>
    </main>
  );
}

export default function TemplateDashboard({
  snapshot,
  calculatedAt,
  controls,
  toolbarCenter,
  activeTab,
  onTabChange,
  linkingContent,
  emptyStateContent,
  vernacularExclusions,
  onVernacularExclusionsChange,
  ...tabProps
}: Props) {
  const [internalActiveTab, setInternalActiveTab] = useState<DashboardTemplateTab>('overview');
  const resolvedActiveTab = TABS.some((tab) => tab.id === activeTab) ? (activeTab as DashboardTemplateTab) : internalActiveTab;
  const setTab = (tab: DashboardTemplateTab) => {
    if (onTabChange) onTabChange(tab);
    if (activeTab === undefined) setInternalActiveTab(tab);
  };
  const needsSnapshot = resolvedActiveTab !== 'linking';

  const body = (() => {
    if (resolvedActiveTab === 'linking') return linkingContent;
    if (!snapshot) return <main className="exactdash-empty-tab">{emptyStateContent}</main>;
    if (resolvedActiveTab === 'overview') {
      return <OverviewTab snapshot={snapshot} calculatedAt={calculatedAt} compare={tabProps.compare} onDrilldown={tabProps.onDrilldown} onRegenerate={tabProps.onRegenerate} />;
    }
    const props = { ...tabProps, snapshot };
    if (resolvedActiveTab === 'attention') return snapshot.attention ? <AttentionTab {...props} /> : <OutdatedSnapshot onRegenerate={tabProps.onRegenerate} />;
    if (resolvedActiveTab === 'vernacular') {
      return snapshot.vernacular
        ? <VernacularTab {...props} exclusions={vernacularExclusions} onExclusionsChange={onVernacularExclusionsChange} />
        : <OutdatedSnapshot onRegenerate={tabProps.onRegenerate} />;
    }
    return snapshot.time ? <TimeTab {...props} /> : <OutdatedSnapshot onRegenerate={tabProps.onRegenerate} />;
  })();

  return (
    <div className={`exactdash-shell dash-shell ${needsSnapshot && !snapshot ? 'is-empty-view' : ''}`}>
      <div className="dash-shell-header">
        <div className="dash-tabs" role="tablist" aria-label="Dashboard sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={resolvedActiveTab === tab.id}
              className={`dash-tab ${resolvedActiveTab === tab.id ? 'is-active' : ''}`}
              onClick={() => setTab(tab.id)}
            >
              <span title={tab.question}>{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="dash-shell-center">{toolbarCenter}</div>
        {controls ? <div className="dash-shell-controls" aria-label="Dashboard tools">{controls}</div> : null}
      </div>
      {tabProps.compare && needsSnapshot && snapshot ? (
        <div className="dash-compare-banner" role="status">
          Comparing <strong>{tabProps.scopeLabel}</strong> with <strong>{tabProps.compare.label}</strong>
        </div>
      ) : null}
      {body}
    </div>
  );
}
