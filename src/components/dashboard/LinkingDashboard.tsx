import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  detectLinkingColumnCandidates,
  profileLinkingColumnCandidates,
  type LinkingDashboardModel,
} from '../../lib/linkingDashboard';
import type { ExplorerFilterModel } from '../../lib/filterCoordinator';
import { DashPanel } from './DashPanel';
import { compact as compactFormat, percent, whole } from './tabs/format';
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

const BASE_BUCKET_OPTIONS = ['cross-platform', 'intra-platform', 'marketplace', 'crowdfunding', 'routing', 'other'] as const;

/** What each ecology bucket means, in plain words. */
const BUCKET_INFO: Record<string, { label: string; examples: string }> = {
  'cross-platform': { label: 'Other platforms', examples: 'Instagram, TikTok, X, Facebook, Reddit, Discord' },
  'intra-platform': { label: 'YouTube itself', examples: 'other videos, channels and playlists' },
  marketplace: { label: 'Shops and affiliate links', examples: 'Amazon, Etsy, Spotify, Gumroad' },
  crowdfunding: { label: 'Crowdfunding and tips', examples: 'Patreon, Ko-fi, Buy Me a Coffee, GoFundMe' },
  routing: { label: 'Link routers', examples: 'link-in-bio pages and URL shorteners' },
  other: { label: 'Other websites', examples: 'news sites, organisations, personal sites' },
};

const bucketLabel = (bucket: string) => BUCKET_INFO[bucket]?.label ?? bucket;
const formatCompact = (value: number) => (Number.isFinite(value) ? compactFormat.format(value) : '—');

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

/** The bucket sorter: drag domains between ecology buckets and save the overrides. */
function BucketEditor({
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
        className="dash-button is-small"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        Edit buckets
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
  // Ranked live from a 300-row sample (cheap), so improvements to the ranking apply to saved projects too.
  const candidates = useMemo(() => profileLinkingColumnCandidates(rows), [rows]);
  const fallbackCandidates = useMemo(() => detectLinkingColumnCandidates(rows), [rows]);
  const [draftColumn, setDraftColumn] = useState<string>('');
  const [isEditingSource, setIsEditingSource] = useState<boolean>(() => !(state?.snapshot && state?.selectedSourceColumn));
  const generateButtonRef = useRef<HTMLButtonElement | null>(null);

  const selectedSource = state?.selectedSourceColumn || null;
  const snapshot = state?.snapshot || null;
  const stale = Boolean(state?.stale);
  const model = (snapshot?.model || null) as LinkingDashboardModel | null;
  const domainAudit = (snapshot?.domainAudit || []) as LinkingAuditDomain[];
  const visibleSources = sourceItems.filter((source) => source.visible).length;

  useEffect(() => {
    const candidateColumns = (candidates.length ? candidates : fallbackCandidates).map((candidate: { column: string }) => candidate.column);
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
    candidates.find((candidate: { column: string }) => candidate.column === draftColumn)
    || candidates[0]
    || fallbackCandidates.find((candidate) => candidate.column === draftColumn)
    || fallbackCandidates[0]
    || null
  ), [candidates, draftColumn, fallbackCandidates]);

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
      <main className="dash">
        <section className="dash-card dash-outdated">
          <strong>No videos to analyse</strong>
          <span>Import a dataset first, then generate a linking summary.</span>
        </section>
      </main>
    );
  }

  if (isEditingSource || !selectedSource || !snapshot) {
    const list = (candidates.length ? candidates : fallbackCandidates).slice(0, 8);
    return (
      <main className="dash">
        <DashPanel
          title="Where should links be read from?"
          headline="Pick the column whose links you want to analyse, usually the video descriptions. Nothing is computed until you press Generate."
          method={{
            computed: 'Columns are ranked by how link-like their values are in the first 300 videos (URL patterns, column names such as "urls" or "description"). Columns that only hold each video\'s own YouTube address or thumbnail are ranked last.',
            read: 'The score is only a suggestion; check the sample values on the right before generating.',
            caveats: [`${visibleSources} of ${sourceItems.length || 0} data sources are visible; hidden sources are not analysed.`],
          }}
        >
          <div className="dash-row is-2">
            <ul className="dash-choice-list">
              {list.map((candidate: any) => (
                <li key={candidate.column}>
                  <button type="button" className={`dash-choice ${draftColumn === candidate.column ? 'is-active' : ''}`} onClick={() => setDraftColumn(candidate.column)} aria-pressed={draftColumn === candidate.column}>
                    <strong>{candidate.column}</strong>
                    <span className="dash-note">{'urlishShare' in candidate ? `${percent(candidate.urlishShare)} of values contain links` : candidate.reason}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="dash-evidence">
              <h4>{selectedCandidate?.column || draftColumn || 'No column'}</h4>
              <p className="dash-note">{selectedCandidate?.reason || 'available column'}</p>
              {Array.isArray((selectedCandidate as any)?.sampleValues) && (selectedCandidate as any).sampleValues.length ? (
                <ul className="dash-samples">
                  {(selectedCandidate as any).sampleValues.slice(0, 3).map((sample: string, index: number) => <li key={`${sample}-${index}`}><code>{sample}</code></li>)}
                </ul>
              ) : null}
            </div>
          </div>
          {stale ? <p className="dash-note dash-warning">The data changed since the last summary. Generate again to update it.</p> : null}
          <div className="dash-actions">
            {snapshot ? <button type="button" className="dash-button is-quiet" onClick={() => setIsEditingSource(false)}>Back to the summary</button> : null}
            <button ref={generateButtonRef} type="button" className="dash-button" onClick={handleGenerateNow} disabled={!draftColumn}>
              {snapshot ? 'Generate again' : 'Generate linking summary'}
            </button>
          </div>
        </DashPanel>
      </main>
    );
  }

  if (!model?.hasLinkedRows) {
    return (
      <main className="dash">
        <section className="dash-card dash-outdated">
          <strong>No links found in {selectedSource}</strong>
          <span>The summary ran, but no web addresses were found in that column.</span>
          <button type="button" className="dash-button" onClick={() => setIsEditingSource(true)}>Choose another column</button>
        </section>
      </main>
    );
  }

  const summary = model.summary;
  const linkedShare = rows.length ? summary.linkedRows / rows.length : 0;
  const buckets = [...model.baseEcology].sort((a, b) => b.share - a.share);
  const topBucket = buckets[0];
  const maxBucketShare = Math.max(...buckets.map((bucket) => bucket.share), 0.0001);
  const recipes = model.recipes;
  const drillBucket = (bucket: string) => onApplyDrilldown({
    filters: { linking_base_labels: { values: [bucket], matchMode: 'only' } } as ExplorerFilterModel,
    visibleColumns: ['linking_base_labels', 'linking_recipe', 'linking_top_domains'],
  });

  return (
    <main className="dash">
      <DashPanel
        title={`Links in ${model.sourceColumn}`}
        headline={<>
          <strong>{percent(linkedShare)}</strong> of videos link out: {whole.format(summary.totalUrls)} links to {whole.format(summary.uniqueDomains)} different sites.
          {topBucket ? <> Most point to <strong>{bucketLabel(topBucket.key).toLowerCase()}</strong> ({percent(topBucket.share)} of links).</> : null}
        </>}
        controls={(
          <>
            {stale ? <button type="button" className="dash-button is-small" onClick={() => onGenerate(selectedSource)}>Refresh (data changed)</button> : null}
            <button type="button" className="dash-button is-small is-quiet" onClick={() => setIsEditingSource(true)}>Change column</button>
          </>
        )}
        method={{
          computed: `Web addresses are extracted from "${model.sourceColumn}", normalised to their domain (www. removed, known short links expanded where possible) and each domain is assigned an ecology bucket by a built-in rule list, which you can override. A video "links out" when it has at least one address.`,
          read: `On average a linking video has ${summary.avgUrlsPerRow.toFixed(1)} links to ${summary.avgDomainsPerRow.toFixed(1)} sites. ${percent(summary.shortenerShare, 1)} of links are shorteners and ${percent(summary.malformedShare, 1)} could not be parsed.`,
          caveats: [
            'Descriptions can be edited after publication; the links are those present when the data was collected.',
            'Shortened links hide their destination: their share is shown so you can judge how much is unknown.',
          ],
        }}
      >
        <div className="dash-kpis is-compact">
          <div className="dash-kpi"><span className="dash-kpi-label">Videos with links</span><strong className="dash-kpi-value">{whole.format(summary.linkedRows)}</strong></div>
          <div className="dash-kpi"><span className="dash-kpi-label">Links</span><strong className="dash-kpi-value">{formatCompact(summary.totalUrls)}</strong></div>
          <div className="dash-kpi"><span className="dash-kpi-label">Different sites</span><strong className="dash-kpi-value">{formatCompact(summary.uniqueDomains)}</strong></div>
          <div className="dash-kpi"><span className="dash-kpi-label">Shorteners</span><strong className="dash-kpi-value">{percent(summary.shortenerShare, 1)}</strong></div>
        </div>
      </DashPanel>

      <div className="dash-row is-2">
        <DashPanel
          title="Where links point"
          headline="The share of all links that goes to each kind of destination. Click a row to see those videos."
          controls={<BucketEditor label="Edit ecology buckets" oneLine="Drag domains to another bucket, then save. Your changes are kept with the project and used from then on." domainAudit={domainAudit} onSaveOverrideBatch={onSaveOverrideBatch} />}
          method={{
            computed: 'Each link is assigned one bucket by its domain: a built-in list of platforms, shops, crowdfunding and link services, plus your overrides. Shares are of all links (not videos), so a video with many shop links counts more than one with a single link.',
            read: 'A space dominated by "other platforms" is cross-promoting itself across social media; a high share of shops points to monetisation through affiliate marketing.',
            caveats: ['Domains not in the rule list fall into "Other websites" until you sort them with Edit buckets.'],
          }}
          csv={() => ({ columns: ['bucket', 'label', 'share_of_links'], rows: buckets.map((bucket) => [bucket.key, bucketLabel(bucket.key), bucket.share.toFixed(4)]) })}
        >
          <ul className="dash-bar-list">
            {buckets.map((bucket) => (
              <li key={bucket.key}>
                <button type="button" className="dash-bar-row is-interactive is-tall" onClick={() => drillBucket(bucket.key)} title={BUCKET_INFO[bucket.key]?.examples}>
                  <span className="dash-bar-label">
                    {bucketLabel(bucket.key)}
                    <span className="dash-note dash-bar-sub">{BUCKET_INFO[bucket.key]?.examples}</span>
                  </span>
                  <span className="dash-bar-track"><span className="dash-bar-fill" style={{ width: `${(bucket.share / maxBucketShare) * 100}%` }} /></span>
                  <span className="dash-bar-value"><strong>{percent(bucket.share)}</strong></span>
                </button>
              </li>
            ))}
          </ul>
        </DashPanel>

        <DashPanel
          title="Most linked sites"
          headline={model.topDomains[0] ? <><strong>{model.topDomains[0].domain}</strong> is linked from {whole.format(model.topDomains[0].rows)} videos.</> : 'No sites.'}
          method={{
            computed: '"Videos" counts the videos that link to the site at least once; "Links" counts every mention, so a site repeated in one description counts several times. The CSV has every site with its bucket and why it was put there.',
            read: 'Sites linked from many videos are the infrastructure of this space; sites with many links but few videos are repeated by a few creators.',
          }}
          csv={() => ({
            columns: ['domain', 'videos', 'links', 'bucket', 'reason', 'manual_override'],
            rows: domainAudit.map((entry) => [entry.domain, entry.rows, entry.mentions, entry.currentBaseBucket || entry.baseBucket, entry.currentReason || entry.reason, entry.overridden ? 'yes' : 'no']),
          })}
        >
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th className="is-text">Site</th>
                  <th>Videos</th>
                  <th>Links</th>
                  <th className="is-text">Bucket</th>
                </tr>
              </thead>
              <tbody>
                {model.topDomains.map((row) => (
                  <tr
                    key={row.domain}
                    className="is-interactive"
                    onClick={() => onApplyDrilldown({
                      filters: { linking_raw_domains: { values: [row.domain], matchMode: 'only' } } as ExplorerFilterModel,
                      visibleColumns: ['linking_raw_domains', 'linking_raw_links', 'linking_recipe'],
                    })}
                  >
                    <td className="is-text is-title">{row.domain}</td>
                    <td>{whole.format(row.rows)}</td>
                    <td>{whole.format(row.mentions)}</td>
                    <td className="is-text">{bucketLabel(row.ecology)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DashPanel>
      </div>

      <DashPanel
        title="Linking strategy per video"
        headline={recipes[0] ? <>The most common strategy is <strong>{recipes[0].recipe}</strong>, used by {percent(recipes[0].share)} of videos that link out.</> : 'No strategies.'}
        method={{
          computed: 'Each video that links out gets one strategy from the mix of buckets in its own links, by fixed rules in this order: "commerce cluster" (shop links to 3 or more different sites), "creator stack" (social + crowdfunding + link router), "streaming relay" (social + shop + router), "hub-first" (router + YouTube), "social-only" (only social or YouTube links), otherwise "mixed routing". Social means other platforms or YouTube itself.',
          read: 'Strategies describe how creators use the description box: as a pointer to their other accounts, as a storefront, or as a funding appeal. Click a row to see its videos.',
          caveats: ['The rules are a typology for exploration, not a validated classification; check examples before reporting shares.'],
        }}
        csv={() => ({ columns: ['strategy', 'typical_structure', 'share_of_linking_videos', 'average_sites', 'signature_sites'], rows: recipes.map((recipe) => [recipe.recipe, recipe.typicalStructure, recipe.share.toFixed(4), recipe.avgDomains.toFixed(2), recipe.signatureDomains]) })}
      >
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th className="is-text">Strategy</th>
                <th className="is-text">Typical mix</th>
                <th>Videos</th>
                <th>Sites per video</th>
                <th className="is-text">Typical sites</th>
              </tr>
            </thead>
            <tbody>
              {recipes.map((recipe) => (
                <tr
                  key={recipe.recipe}
                  className="is-interactive"
                  onClick={() => onApplyDrilldown({
                    filters: { linking_recipe: { values: [recipe.recipe], matchMode: 'only' } } as ExplorerFilterModel,
                    visibleColumns: ['linking_recipe', 'linking_base_labels', 'linking_top_domains'],
                  })}
                >
                  <td className="is-text"><strong>{recipe.recipe}</strong></td>
                  <td className="is-text is-title" title={recipe.typicalStructure}>{recipe.typicalStructure}</td>
                  <td>{percent(recipe.share)}</td>
                  <td>{recipe.avgDomains.toFixed(1)}</td>
                  <td className="is-text is-title" title={recipe.signatureDomains}>{recipe.signatureDomains}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DashPanel>
    </main>
  );
}
