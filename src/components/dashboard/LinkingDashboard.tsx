import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  detectLinkingColumnCandidates,
  profileLinkingColumnCandidates,
  type LinkingBarMetric,
  type LinkingDashboardModel,
} from '../../lib/linkingDashboard';
import { maxOf } from '../../lib/largeData';
import type { ExplorerFilterModel } from '../../lib/filterCoordinator';
import './linkingExact.css';

type Props = {
  rows: any[];
  state: any;
  sourceItems: Array<{ id: string; label: string; visible: boolean }>;
  onGenerate: (sourceColumn: string) => void;
  onSelectSource: (sourceColumn: string) => void;
  onApplyOverride: (args: { domain: string; baseBucket?: string; note?: string; revert?: boolean }) => void;
  onSaveOverrideBatch: (assignments: Array<{ domain: string; baseBucket: string }>) => Promise<void> | void;
  onApplyDrilldown: (args: { filters: ExplorerFilterModel; visibleColumns?: string[] }) => void;
};

type InfoProps = {
  label: string;
  oneLine: string;
  method: string;
  codeSnippet: string;
  codeExplanation?: string;
};

const BASE_BUCKET_OPTIONS = ['cross-platform', 'intra-platform', 'marketplace', 'crowdfunding', 'routing', 'other'] as const;

function formatCompact(value: number) {
  if (!Number.isFinite(value)) return '--';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${formatScaled(value / 1_000_000_000)}b`;
  if (abs >= 1_000_000) return `${formatScaled(value / 1_000_000)}m`;
  if (abs >= 1_000) return `${formatScaled(value / 1_000)}k`;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function formatScaled(value: number) {
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');
}

function formatPercent(value: number, digits = 1) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '--';
}

function SourceStatusStrip({
  sourceItems,
  selectedSource,
  stale,
}: {
  sourceItems: Array<{ id: string; label: string; visible: boolean }>;
  selectedSource: string | null;
  stale: boolean;
}) {
  const visibleCount = sourceItems.filter((source) => source.visible).length;
  return (
    <div className="links-source-status">
      <div><span>Visible sources</span><strong>{visibleCount}/{sourceItems.length || 0}</strong></div>
      <div><span>Selected source</span><strong>{selectedSource || 'none'}</strong></div>
      <div><span>Summary freshness</span><strong>{stale ? 'stale' : 'current'}</strong></div>
    </div>
  );
}


function MethodSections({ sections, references }: { sections: Array<{ title: string; body: string }>; references?: string[] }) {
  return (
    <div className="links-method-copy">
      {sections.map((section) => (
        <section key={section.title} className="links-method-section">
          <div className="links-method-heading">{section.title}</div>
          <p className="links-method-paragraph">{section.body}</p>
        </section>
      ))}
      {references?.length ? (
        <section className="links-method-section">
          <div className="links-method-heading">References</div>
          <ul className="links-method-references">
            {references.map((reference) => <li key={reference}><em>{reference}</em></li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function InfoHintPopover({
  label,
  oneLine,
  method,
}: {
  label: string;
  oneLine: string;
  method: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useMemo(() => `linking-hint-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, [label]);
  const sections = useMemo(() => {
    const parts = method.split(/\n\n+/).map((item) => item.trim()).filter(Boolean);
    return parts.map((body, index) => ({ title: index === 0 ? 'What this shows' : `Method note ${index}`, body }));
  }, [method]);
  return (
    <span className="info-wrap">
      <button
        type="button"
        className="info-button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`How ${label} is calculated`}
        onClick={() => setOpen((current) => !current)}
      >
        i
      </button>
      {open ? (
        <div className="info-overlay" onClick={() => setOpen(false)}>
          <div className="info-popover" id={id} role="dialog" aria-label={`${label} explanation`} onClick={(event) => event.stopPropagation()}>
            <div className="info-head">
              <div>
                <div className="info-title">{label}</div>
                <div className="info-summary">{oneLine}</div>
              </div>
              <button type="button" className="info-close" onClick={() => setOpen(false)} aria-label="Close metric explanation">×</button>
            </div>
            <MethodSections sections={sections} />
          </div>
        </div>
      ) : null}
    </span>
  );
}

type LinkingAuditDomain = {
  domain: string;
  mentions: number;
  rows: number;
  autoBaseBucket?: string;
  currentBaseBucket?: string;
  baseBucket: string;
  autoReason?: string;
  currentReason?: string;
  reason: string;
  overridden?: boolean;
  unmapped?: boolean;
  classificationSource?: 'auto' | 'manual';
  overrideNote?: string;
  updatedAt?: string;
};

function LinkingInfoAuditPopover({
  label,
  oneLine,
  domainAudit,
  onSaveOverrideBatch,
}: {
  label: string;
  oneLine: string;
  domainAudit: LinkingAuditDomain[];
  onSaveOverrideBatch: (assignments: Array<{ domain: string; baseBucket: string }>) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dragState, setDragState] = useState<{ domain: string; bucket: string } | null>(null);
  const [draftAssignments, setDraftAssignments] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const id = useMemo(() => `linking-info-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, [label]);

  const baselineAssignments = useMemo(
    () => Object.fromEntries(domainAudit.map((entry) => [entry.domain, entry.currentBaseBucket || entry.baseBucket || 'other'])) as Record<string, string>,
    [domainAudit],
  );


  useEffect(() => {
    if (!open) return;
    setDraftAssignments(baselineAssignments);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, baselineAssignments]);

  const entriesByDomain = useMemo(() => new Map(domainAudit.map((entry) => [entry.domain, entry])), [domainAudit]);

  const filteredDomainSet = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return null;
    return new Set(domainAudit.filter((entry) => entry.domain.toLowerCase().includes(query)).map((entry) => entry.domain));
  }, [domainAudit, search]);

  const groupedCards = useMemo(() => {
    const grouped = Object.fromEntries(BASE_BUCKET_OPTIONS.map((bucket) => [bucket, [] as Array<{ domain: string; mentions: number; overridden?: boolean }>])) as Record<string, Array<{ domain: string; mentions: number; overridden?: boolean }>>;
    domainAudit.forEach((entry) => {
      const bucket = (draftAssignments[entry.domain] || baselineAssignments[entry.domain] || 'other') as typeof BASE_BUCKET_OPTIONS[number];
      const target = BASE_BUCKET_OPTIONS.includes(bucket) ? bucket : 'other';
      if (filteredDomainSet && !filteredDomainSet.has(entry.domain)) return;
      grouped[target].push({
        domain: entry.domain,
        mentions: entry.mentions,
        overridden: entry.overridden || (draftAssignments[entry.domain] || baselineAssignments[entry.domain] || 'other') !== (entry.currentBaseBucket || entry.baseBucket || 'other'),
      });
    });
    BASE_BUCKET_OPTIONS.forEach((bucket) => {
      grouped[bucket].sort((a, b) => a.domain.localeCompare(b.domain));
    });
    return grouped;
  }, [baselineAssignments, domainAudit, draftAssignments, filteredDomainSet]);

  const visibleDomainCount = useMemo(
    () => BASE_BUCKET_OPTIONS.reduce((sum, bucket) => sum + (groupedCards[bucket]?.length || 0), 0),
    [groupedCards],
  );

  const dirtyCount = useMemo(
    () => Object.keys(draftAssignments).filter((domain) => (draftAssignments[domain] || 'other') !== (baselineAssignments[domain] || 'other')).length,
    [baselineAssignments, draftAssignments],
  );

  const moveDomain = (domain: string, targetBucket: string) => {
    if (!domain) return;
    const currentBucket = (draftAssignments[domain] || baselineAssignments[domain] || 'other') as string;
    const normalizedTarget = BASE_BUCKET_OPTIONS.includes(targetBucket as any) ? targetBucket : 'other';
    if (currentBucket === normalizedTarget) return;
    setDraftAssignments((current) => ({ ...current, [domain]: normalizedTarget }));
  };

  const handleReset = () => {
    setDraftAssignments(baselineAssignments);
    setSearch('');
    setDragState(null);
  };

  const handleSave = async () => {
    if (!dirtyCount || isSaving) return;
    const changed = Object.keys(draftAssignments)
      .filter((domain) => (draftAssignments[domain] || 'other') !== (baselineAssignments[domain] || 'other'))
      .map((domain) => ({ domain, baseBucket: draftAssignments[domain] || 'other' }));
    if (!changed.length) return;
    setIsSaving(true);
    try {
      await onSaveOverrideBatch(changed);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <span className="info-wrap">
      <button
        type="button"
        className="info-button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Open ${label} sorter`}
        onClick={() => setOpen((current) => !current)}
      >
        i
      </button>
      {open ? (
        <div className="info-overlay" onClick={() => setOpen(false)}>
          <div className="info-popover links-sorter-popover" id={id} role="dialog" aria-label={label} onClick={(event) => event.stopPropagation()}>
            <div className="info-head">
              <div>
                <div className="info-title">{label}</div>
                <div className="info-summary">{oneLine}</div>
              </div>
              <button type="button" className="info-close" onClick={() => setOpen(false)} aria-label="Close linking sorter">×</button>
            </div>
            <div className="links-sorter-toolbar">
              <div className="links-sorter-tabs" role="tablist" aria-label="Ecology buckets">
                <button type="button" className="is-active">Ecology</button>
              </div>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search domain" />
              <div className="links-sorter-actions">
                <button type="button" className="links-sorter-reset" onClick={handleReset} disabled={isSaving}>Reset</button>
                <button type="button" className="links-sorter-save" onClick={handleSave} disabled={!dirtyCount || isSaving}>{isSaving ? 'Saving…' : dirtyCount ? `Save ${dirtyCount}` : 'Saved'}</button>
              </div>
            </div>
            <div className="links-sorter-status">
              <span>{visibleDomainCount.toLocaleString()} domains</span>
              {dirtyCount ? <strong>{dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}</strong> : <strong>Alphabetically sorted within each bucket</strong>}
            </div>
            <div className="links-sorter-columns">
              {BASE_BUCKET_OPTIONS.map((bucket) => {
                const bucketEntries = groupedCards[bucket] || [];
                return (
                  <div
                    key={bucket}
                    className={`links-sorter-column ${dragState?.bucket === bucket ? 'is-drop-target' : ''}`}
                    onDragOver={(event: DragEvent<HTMLDivElement>) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(event: DragEvent<HTMLDivElement>) => {
                      event.preventDefault();
                      const domain = dragState?.domain || event.dataTransfer.getData('text/linking-domain') || event.dataTransfer.getData('text/plain');
                      if (!domain) return;
                      moveDomain(domain, bucket);
                      setDragState(null);
                    }}
                  >
                    <div className="links-sorter-column-head">
                      <strong>{bucket}</strong>
                      <span>{bucketEntries.length}</span>
                    </div>
                    <div className="links-sorter-chip-list">
                      {bucketEntries.map((entry) => (
                        <div
                          key={entry.domain}
                          draggable
                          className={`links-sorter-chip ${entry.overridden ? 'is-overridden' : ''} ${dragState?.domain === entry.domain ? 'is-dragging' : ''}`}
                          onDragStart={(event: DragEvent<HTMLDivElement>) => {
                            setDragState({ domain: entry.domain, bucket });
                            event.dataTransfer.setData('text/linking-domain', entry.domain);
                            event.dataTransfer.setData('text/plain', entry.domain);
                            event.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(event: DragEvent<HTMLDivElement>) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                          }}
                          onDrop={(event: DragEvent<HTMLDivElement>) => {
                            event.preventDefault();
                            const domain = dragState?.domain || event.dataTransfer.getData('text/linking-domain') || event.dataTransfer.getData('text/plain');
                            if (!domain) return;
                            moveDomain(domain, bucket);
                            setDragState(null);
                          }}
                          onDragEnd={() => setDragState(null)}
                          title={entry.domain}
                        >
                          <span className="links-sorter-chip-label">{entry.domain}</span>
                          <span className="links-sorter-chip-count">{formatCompact(entry.mentions)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </span>
  );
}

function SummaryStrip({
  model,
  onEditSource,
  stale,
  onRefresh,
}: {
  model: LinkingDashboardModel;
  onEditSource: () => void;
  stale: boolean;
  onRefresh: () => void;
}) {
  const items = [
    { label: 'linked rows', value: formatCompact(model.summary.linkedRows) },
    { label: 'total URLs', value: formatCompact(model.summary.totalUrls) },
    { label: 'unique domains', value: formatCompact(model.summary.uniqueDomains) },
    { label: 'avg URLs / row', value: model.summary.avgUrlsPerRow.toFixed(2) },
    { label: 'avg domains / row', value: model.summary.avgDomainsPerRow.toFixed(2) },
    { label: 'shortener share', value: formatPercent(model.summary.shortenerShare, 1) },
    { label: 'malformed share', value: formatPercent(model.summary.malformedShare, 1) },
  ];

  return (
    <section className="links-v1-toolbar">
      <div className="section-title section-title-row links-v1-toolbar-title">
        <span>Linking Summary</span>
        <InfoHintPopover
          label="Linking summary"
          oneLine="Summary metrics derived from parsed link mentions in the selected source column."
          method="All metrics in this strip are calculated from the currently generated linking snapshot and keep the same formulas as before."
        />
      </div>
      <div className="links-v1-toolbar-head">
        <div className="links-v1-toolbar-source">
          <span>Source column</span>
          <strong>{model.sourceColumn}</strong>
        </div>
        <div className="links-v1-toolbar-actions">
          {stale ? (
            <button type="button" className="links-refresh-pill" onClick={onRefresh}>Refresh stale data</button>
          ) : (
            <span className="links-fresh-pill">Current</span>
          )}
          <button type="button" className="links-v1-source-button" onClick={onEditSource}>Change source</button>
        </div>
      </div>
      <div className="links-v1-toolbar-grid">
        {items.map((item) => (
          <div key={item.label} className="links-v1-toolbar-item">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function BarBlock({
  title,
  metrics,
  maxShare,
  tone,
  onMetricClick,
}: {
  title: string;
  metrics: LinkingBarMetric[];
  maxShare: number;
  tone: 'base' | 'ecology';
  onMetricClick?: (metric: LinkingBarMetric) => void;
}) {
  return (
    <article className="links-v1-bars-block">
      <div className="section-title"><span>{title}</span></div>
      <div className="links-v1-bars-chart is-horizontal" role="list">
        {metrics.map((metric) => (
          <button
            key={metric.key}
            type="button"
            className="links-v1-bar-row"
            onClick={() => onMetricClick?.(metric)}
            title={`Filter explorer by ecology bucket ${metric.label}`}
          >
            <div className="links-v1-bar-row-head">
              <span className="links-v1-bar-label">{metric.label}</span>
              <span className="links-v1-bar-value">{formatPercent(metric.share, 1)}</span>
            </div>
            <div className="links-v1-bar-track is-horizontal">
              <div
                className={`links-v1-bar-fill tone-${tone}`}
                style={{ width: `${Math.max((metric.share / Math.max(maxShare, 0.0001)) * 100, metric.share > 0 ? 4 : 0)}%` }}
              />
            </div>
          </button>
        ))}
      </div>
    </article>
  );
}

function MatrixPanel({ model, onCellClick }: { model: LinkingDashboardModel; onCellClick?: (category: string, strategy: string) => void }) {
  return (
    <article className="links-v1-panel">
      <div className="section-title section-title-row">
        <span>Category x Ecology Mix</span>
        <InfoHintPopover
          label="Category x ecology mix"
          oneLine="Share per ecology bucket inside each top linked category."
          method="Each cell keeps the same current formula: ecology-bucket mentions for the category divided by total mentions in that category group."
        />
      </div>
      <div className="links-v1-subline">TOP 5 VIDEO CATEGORIES BY LINKED-ROW VOLUME</div>
      <div className="links-v1-matrix-scroll">
        <table className="links-v1-table links-v1-matrix-table">
          <colgroup>
            <col className="links-v1-matrix-col-label" />
            {model.matrixColumns.map((column) => (
              <col key={`matrix-col-${column}`} className="links-v1-matrix-col-value" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th>Category</th>
              {model.matrixColumns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.matrixRows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                {row.cells.map((cell) => {
                  const tone = cell.column === 'cross-platform'
                    ? 'social'
                    : cell.column === 'intra-platform'
                      ? 'intra'
                      : cell.column === 'marketplace'
                        ? 'market'
                        : cell.column === 'crowdfunding'
                          ? 'crowd'
                          : cell.column === 'routing'
                            ? 'routing'
                            : 'hub';
                  return (
                    <td key={`${row.label}-${cell.column}`}>
                      <button
                        type="button"
                        className={`links-v1-matrix-cell is-${tone}`}
                        style={{ ['--matrix-alpha' as any]: Math.max(0.16, cell.share) }}
                        onClick={() => onCellClick?.(row.label, cell.column)}
                        title={`Filter ${row.label} + ${cell.column}`}
                      >
                        {formatPercent(cell.share, 0)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function RecipesPanel({ model, onRecipeClick }: { model: LinkingDashboardModel; onRecipeClick?: (recipe: string) => void }) {
  const cards = model.recipes.slice(0, 4);
  return (
    <article className="links-v1-panel">
      <div className="section-title section-title-row">
        <span>Video-level Linking Strategy</span>
        <InfoHintPopover
          label="Video-level linking strategy"
          oneLine="How each video is labeled from its ecology-bucket mix in that row."
          method={[
            'Overview::Each linked video gets one strategy label from ecology buckets using fixed priority rules.',
            'social condition::A row is social when it contains cross-platform or intra-platform links.',
            'social-only::Social condition is true, with no marketplace, crowdfunding, or routing links.',
            'creator stack::Social condition + crowdfunding + routing in the same row.',
            'commerce cluster::Marketplace links span three or more unique domains (this takes priority).',
            'hub-first::Routing + intra-platform when no higher-priority rule matched.',
            'streaming relay::Social condition + marketplace + routing when commerce-cluster threshold is not met.',
            'mixed routing::Fallback when no other strategy rule matches.',
            'metrics::Share = strategy rows / linked rows. Average domains = mean unique normalized domains per row inside that strategy.',
          ].join('\n\n')}
        />
      </div>
      <div className="links-v1-recipes-grid">
        {cards.map((card, index) => {
          const chips = card.signatureDomains.split(',').map((item) => item.trim()).filter(Boolean);
          return (
            <button key={card.recipe} type="button" className={`links-v1-recipe-card tone-${(index % 4) + 1}`} onClick={() => onRecipeClick?.(card.recipe)}>
              <h4 className="links-v1-recipe-title">{card.recipe}</h4>
              <div className="links-v1-recipe-structure">{card.typicalStructure}</div>
              <div className="links-v1-recipe-stats">
                <div className="links-v1-recipe-stat">
                  <span>share</span>
                  <strong>{formatPercent(card.share, 1)}</strong>
                </div>
                <div className="links-v1-recipe-stat">
                  <span>avg domains</span>
                  <strong>{card.avgDomains.toFixed(2)}</strong>
                </div>
              </div>
              <div className="links-v1-recipe-links">
                {chips.map((chip) => <span key={`${card.recipe}-${chip}`} className="links-v1-recipe-link-chip">{chip}</span>)}
              </div>
            </button>
          );
        })}
      </div>
      <div className="links-v1-recipes-note">
        These strategy labels are assigned in fixed rule order from each video's ecology mix. Social means cross-platform or intra-platform. A single social link does not override a commerce cluster when marketplace links still span three or more unique domains. Share = rows in strategy / linked rows. Avg domains = mean unique normalized domains per row within that strategy.
      </div>
    </article>
  );
}

function TopDomainsPanel({ model, onDomainClick }: { model: LinkingDashboardModel; onDomainClick?: (domain: string) => void }) {
  return (
    <article className="links-v1-panel">
      <div className="section-title section-title-row">
        <span>Top 10 Frequent Domain Names</span>
        <InfoHintPopover
          label="Top domains"
          oneLine="The most frequently mentioned normalized domains in the current linking snapshot."
          method="This list aggregates normalized domains across all parsed mentions in the selected source. Mentions counts repeated appearances. Rows counts how many distinct rows contained the domain. Repeat rate is mentions divided by rows, which helps distinguish broad presence from repeated stacking within fewer rows."
        />
      </div>
      <div className="links-v1-domains-scroll">
        <table className="links-v1-table links-v1-domains-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Domain</th>
              <th>Mentions</th>
              <th>Rows</th>
              <th className="links-v1-repeat-col">Repeat Rate (Mentions/Rows)</th>
              <th>Ecology</th>
            </tr>
          </thead>
          <tbody>
            {model.topDomains.map((row) => (
              <tr key={row.domain}>
                <td>{String(row.rank).padStart(2, '0')}</td>
                <td>
                  <button type="button" onClick={() => onDomainClick?.(row.domain)} className="links-domain-link">
                    {row.domain}
                  </button>
                </td>
                <td>{formatCompact(row.mentions)}</td>
                <td>{formatCompact(row.rows)}</td>
                <td className="links-v1-repeat-col">{row.intensity.toFixed(2)}</td>
                <td>{row.ecology}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export default function LinkingDashboard({
  rows,
  state,
  sourceItems,
  onGenerate,
  onSelectSource,
  onApplyOverride: _onApplyOverride,
  onSaveOverrideBatch,
  onApplyDrilldown,
}: Props) {
  const candidates = useMemo(() => (
    Array.isArray(state?.sourceCandidateProfiles) && state.sourceCandidateProfiles.length
      ? state.sourceCandidateProfiles
      : profileLinkingColumnCandidates(rows)
  ), [rows, state?.sourceCandidateProfiles]);
  const fallbackCandidates = useMemo(() => detectLinkingColumnCandidates(rows), [rows]);
  const [draftColumn, setDraftColumn] = useState<string>('');
  const [isEditingSource, setIsEditingSource] = useState<boolean>(() => !(state?.snapshot && state?.selectedSourceColumn));
  const generateButtonRef = useRef<HTMLButtonElement | null>(null);

  const selectedSource = state?.selectedSourceColumn || null;
  const snapshot = state?.snapshot || null;
  const stale = Boolean(state?.stale);
  const model = (snapshot?.model || null) as LinkingDashboardModel | null;
  const domainAudit = (snapshot?.domainAudit || []) as Array<{ domain: string; mentions: number; rows: number; baseBucket: string; reason: string; overridden?: boolean }>;

  useEffect(() => {
    const candidateColumns = (candidates.length ? candidates : fallbackCandidates).map((candidate) => candidate.column);
    if (!candidateColumns.length) {
      setDraftColumn('');
      return;
    }
    if (selectedSource && candidateColumns.includes(selectedSource)) {
      setDraftColumn((current) => current || selectedSource);
      return;
    }
    if (!draftColumn || !candidateColumns.includes(draftColumn)) {
      setDraftColumn(candidateColumns[0]);
    }
  }, [candidates, draftColumn, fallbackCandidates, selectedSource]);

  const selectedCandidate = useMemo(() => (
    candidates.find((candidate) => candidate.column === draftColumn)
    || candidates[0]
    || fallbackCandidates.find((candidate) => candidate.column === draftColumn)
    || fallbackCandidates[0]
    || null
  ), [candidates, draftColumn, fallbackCandidates]);

  const maxShare = useMemo(() => {
    if (!model) return 0.0001;
    return maxOf([
      ...model.baseEcology.map((item) => item.share),
    ], 0.0001);
  }, [model]);
  const canGenerate = Boolean(draftColumn);

  useEffect(() => {
    if (!isEditingSource) return;
    const frame = window.requestAnimationFrame(() => generateButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [draftColumn, isEditingSource]);

  const handleGenerateNow = () => {
    if (!draftColumn) return;
    onSelectSource(draftColumn);
    onGenerate(draftColumn);
    setIsEditingSource(false);
  };

  if (!rows.length) {
    return (
      <main className="links-v1-frame links-frame-empty">
        <section className="exactdash-empty-tab links-empty-tab">
          <div className="links-empty-message-card">
            <div className="links-empty-message-eyebrow">Linking</div>
            <div className="exactdash-empty-card-title">No rows available for linking analysis</div>
            <p>Import and merge a links dataset first, then generate a linking summary.</p>
          </div>
        </section>
      </main>
    );
  }

  if (isEditingSource || !selectedSource || !snapshot) {
    return (
      <main className="links-v1-frame links-frame-empty">
        <section className="exactdash-empty-tab links-empty-tab">
          <div className="links-setup-card links-setup-shell links-setup-shell-clean">
            <div className="links-setup-header-clean">
              <div>
                <div className="links-setup-eyebrow">Linking workflow</div>
                <div className="links-setup-title">Choose source column</div>
                <p className="links-setup-intro">
                  Pick the field that contains URLs. The panel stays stable while you switch sources; generation only runs when you press the button below.
                </p>
              </div>
              <SourceStatusStrip sourceItems={sourceItems} selectedSource={draftColumn || selectedSource} stale={stale} />
            </div>
            <div className="links-setup-grid-clean">
              <div className="links-candidate-list">
                {(candidates.length ? candidates : fallbackCandidates).slice(0, 8).map((candidate) => (
                  <button
                    key={candidate.column}
                    type="button"
                    className={`links-candidate-row ${draftColumn === candidate.column ? 'is-active' : ''}`}
                    onClick={() => {
                      setDraftColumn(candidate.column);
                    }}
                  >
                    <div className="links-candidate-head">
                      <strong>{candidate.column}</strong>
                      <span>score {Math.round(candidate.score)}</span>
                    </div>
                    <div className="links-candidate-meta">
                      {'urlishShare' in candidate ? `${formatPercent(candidate.urlishShare, 0)} url-like rows` : candidate.reason}
                    </div>
                  </button>
                ))}
              </div>
              <div className="links-candidate-evidence links-candidate-evidence-clean">
                <h4>Selected source</h4>
                <div className="links-evidence-line"><span>column</span><strong>{selectedCandidate?.column || draftColumn || 'n/a'}</strong></div>
                <div className="links-evidence-line"><span>confidence</span><strong>{selectedCandidate ? Math.round(selectedCandidate.score) : 0}</strong></div>
                <div className="links-evidence-line"><span>reason</span><strong>{selectedCandidate?.reason || 'available column'}</strong></div>
                {'urlishRows' in (selectedCandidate || {}) ? (
                  <div className="links-evidence-line"><span>url-like rows</span><strong>{(selectedCandidate as any).urlishRows}/{(selectedCandidate as any).nonEmptyRows}</strong></div>
                ) : null}
                {Array.isArray((selectedCandidate as any)?.sampleValues) && (selectedCandidate as any).sampleValues.length ? (
                  <div className="links-evidence-samples">
                    {(selectedCandidate as any).sampleValues.slice(0, 3).map((sample: string, index: number) => <code key={`${sample}-${index}`}>{sample}</code>)}
                  </div>
                ) : null}
              </div>
            </div>
            <div className={stale ? 'links-stale-banner' : 'links-stale-banner-slot'}>
              Source visibility or dataset state changed. Refresh linking summary to keep aggregates and generated metadata current.
            </div>
            <div className="links-setup-footer-clean">
              <button
                ref={generateButtonRef}
                type="button"
                className="exactdash-tab is-active links-setup-generate-button"
                onClick={handleGenerateNow}
                disabled={!canGenerate}
              >
                {snapshot ? 'Refresh linking summary' : 'Generate linking summary'}
              </button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!model?.hasLinkedRows) {
    return (
      <main className="links-v1-frame links-frame-empty">
        <section className="exactdash-empty-tab links-empty-tab">
          <div className="links-empty-message-card">
            <div className="links-empty-message-eyebrow">Linking</div>
            <div className="exactdash-empty-card-title">No parsed links found in {selectedSource}</div>
            <p>The summary ran successfully, but no parseable URLs/domains were found in the selected source column.</p>
            <div className="links-setup-actions">
              <button type="button" className="exactdash-tab is-active" onClick={() => setIsEditingSource(true)}>Choose different source</button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="links-v1-frame">
      <SummaryStrip
        model={model}
        onEditSource={() => setIsEditingSource(true)}
        stale={stale}
        onRefresh={() => onGenerate(selectedSource)}
      />

      <section className="links-v1-main-grid">
        <MatrixPanel
          model={model}
          onCellClick={(category, strategy) => {
            onApplyDrilldown({
              filters: {
                videoCategoryLabel: { values: [category], matchMode: 'only' },
                linking_base_labels: { values: [strategy], matchMode: 'only' },
              } as ExplorerFilterModel,
              visibleColumns: ['videoCategoryLabel', 'linking_base_labels', 'linking_recipe'],
            });
          }}
        />
        <article className="links-v1-panel">
          <div className="section-title section-title-row">
            <span>Ecology Fingerprint</span>
            <LinkingInfoAuditPopover
              label="Ecology fingerprint"
              oneLine="Audit and edit how domains are bucketed across the ecology system."
              domainAudit={domainAudit}
              onSaveOverrideBatch={onSaveOverrideBatch}
            />
          </div>
          <div className="links-v1-bars-grid links-v1-bars-grid-single">
            <BarBlock
              title="Ecology buckets"
              metrics={model.baseEcology}
              maxShare={maxShare}
              tone="base"
              onMetricClick={(metric) => onApplyDrilldown({
                filters: { linking_base_labels: { values: [metric.key], matchMode: 'only' } } as ExplorerFilterModel,
                visibleColumns: ['linking_base_labels', 'linking_recipe', 'linking_top_domains'],
              })}
            />
          </div>
        </article>
      </section>

      <section className="links-v1-lower-grid">
        <RecipesPanel
          model={model}
          onRecipeClick={(recipe) => onApplyDrilldown({
            filters: { linking_recipe: { values: [recipe], matchMode: 'only' } } as ExplorerFilterModel,
            visibleColumns: ['linking_recipe', 'linking_base_labels', 'linking_top_domains'],
          })}
        />
        <TopDomainsPanel
          model={model}
          onDomainClick={(domain) => onApplyDrilldown({
            filters: { linking_raw_domains: { values: [domain], matchMode: 'only' } } as ExplorerFilterModel,
            visibleColumns: ['linking_raw_domains', 'linking_raw_links', 'linking_recipe'],
          })}
        />
      </section>
    </main>
  );
}

