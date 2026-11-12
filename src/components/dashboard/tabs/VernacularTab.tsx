import { useMemo, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { compareShares } from '../../../lib/compareShares';
import { saveText, slugify } from '../../../lib/exportImage';
import { languageName } from '../../../lib/overviewProfile';
import { buildCooccurrence, countTermVideos, toGexf, type VernacularTerm, type VernacularUnit } from '../../../lib/vernacularProfile';
import { DashPanel, Segmented } from '../DashPanel';
import type { DashboardTabProps } from '../TemplateDashboard';
import { NetworkGraph, WordCloud } from './charts';
import { CompareTable } from './CompareTable';
import { percent, whole } from './format';

const UNITS: Array<{ value: VernacularUnit; label: string; noun: string; plural: string }> = [
  { value: 'words', label: 'Title words', noun: 'title word', plural: 'title words' },
  { value: 'phrases', label: 'Phrases', noun: 'title phrase', plural: 'title phrases' },
  { value: 'hashtags', label: 'Hashtags', noun: 'hashtag', plural: 'hashtags' },
  { value: 'tags', label: 'Tags', noun: 'tag', plural: 'tags' },
  { value: 'topics', label: 'Topics', noun: 'topic', plural: 'topics' },
];

const UNIT_METHOD: Record<VernacularUnit, string> = {
  words: 'Words in video titles, lower-cased; numbers, single letters and stopwords removed.',
  phrases: 'Two- and three-word sequences in titles that neither start nor end with a stopword, used by at least 2 videos.',
  hashtags: 'Hashtags (#…) in titles and descriptions, compared case-insensitively.',
  tags: 'The creator-set tags field, compared case-insensitively; shown in their most common spelling.',
  topics: "YouTube's topic categories (Wikipedia-based labels YouTube assigns automatically).",
};

function TermList({ terms, onSelect, limit, onMore }: { terms: VernacularTerm[]; onSelect?: (term: VernacularTerm) => void; limit: number; onMore: () => void }) {
  if (!terms.length) return <div className="dash-empty">None in this scope.</div>;
  const max = Math.max(...terms.map((term) => term.share), 0.0001);
  return (
    <>
      <div className="dash-table-wrap">
        <table className="dash-table">
          <thead>
            <tr>
              <th className="is-text">Term</th>
              <th>Videos</th>
              <th>Share</th>
              <th title="Share of all views that went to videos using the term">Of views</th>
            </tr>
          </thead>
          <tbody>
            {terms.slice(0, limit).map((term) => (
              <tr key={term.key} className={onSelect ? 'is-interactive' : undefined} onClick={onSelect ? () => onSelect(term) : undefined} title={onSelect ? 'Show these videos in the explorer' : undefined}>
                <td className="is-text is-title">
                  <span className="dash-term-bar" style={{ width: `${(term.share / max) * 100}%` }} />
                  <span className="dash-term-label">{term.label}</span>
                </td>
                <td>{whole.format(term.videos)}</td>
                <td>{percent(term.share, 1)}</td>
                <td>{percent(term.viewShare, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {terms.length > limit ? <button type="button" className="dash-link-button" onClick={onMore}>Show more ({whole.format(terms.length - limit)} left)</button> : null}
    </>
  );
}

function ExclusionEditor({ exclusions, onChange }: { exclusions: string[]; onChange?: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const added = draft.split(',').map((term) => term.trim()).filter(Boolean);
    if (!added.length || !onChange) return;
    onChange([...new Set([...exclusions, ...added])]);
    setDraft('');
  };
  return (
    <div className="dash-exclusions" data-export-ignore>
      <span className="dash-note">Hidden terms (saved with the project):</span>
      {exclusions.map((term) => (
        <span key={term} className="dash-chip">
          {term}
          {onChange ? <button type="button" aria-label={`Show "${term}" again`} onClick={() => onChange(exclusions.filter((existing) => existing !== term))}><X size={11} /></button> : null}
        </span>
      ))}
      {onChange ? (
        <form onSubmit={submit} className="dash-exclusion-form">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Hide a term, e.g. natgeo" aria-label="Term to hide from vernacular lists" />
          <button type="submit" className="dash-button is-small" disabled={!draft.trim()}>Hide</button>
        </form>
      ) : null}
    </div>
  );
}

export function VernacularTab({ snapshot, compare, scopeLabel, onDrilldown, getScopeRecords, exclusions, onExclusionsChange }: DashboardTabProps & {
  exclusions: string[];
  onExclusionsChange?: (next: string[]) => void;
}) {
  const vernacular = snapshot.vernacular!;
  const compareVernacular = compare?.snapshot.vernacular;
  const [unit, setUnit] = useState<VernacularUnit>(() => (vernacular.terms.hashtags.length ? 'hashtags' : 'words'));
  const [limit, setLimit] = useState(20);
  const unitInfo = UNITS.find((entry) => entry.value === unit)!;
  const terms = vernacular.terms[unit];
  const top = terms[0];
  const coverage = vernacular.videos ? vernacular.coverage[unit] / vernacular.videos : 0;

  // Compare the union of both top lists. With the rows at hand, count those terms exactly on both sides;
  // otherwise a term outside one side's top list would wrongly count as zero there.
  const compared = useMemo(() => {
    if (!compareVernacular) return null;
    const otherTerms = compareVernacular.terms[unit];
    const labels = new Map<string, string>([...otherTerms, ...terms].map((term) => [term.key, term.label]));
    const keys = new Set(labels.keys());
    const exact = getScopeRecords && compare?.getRecords;
    const countsA = exact ? countTermVideos(getScopeRecords(), unit, keys, vernacular.exclusions) : new Map<string, number>(terms.map((term) => [term.key, term.videos]));
    const countsB = exact ? countTermVideos(compare.getRecords!(), unit, keys, vernacular.exclusions) : new Map<string, number>(otherTerms.map((term) => [term.key, term.videos]));
    const toShares = (counts: Map<string, number>) => [...keys].map((key) => ({ key, label: labels.get(key) ?? key, count: counts.get(key) ?? 0 }));
    return compareShares(toShares(countsA), vernacular.videos, toShares(countsB), compareVernacular.videos);
  }, [compare, compareVernacular, getScopeRecords, terms, unit, vernacular.exclusions, vernacular.videos]);

  const drill = (term: { key: string; label: string; raw?: string }) => onDrilldown?.({ kind: 'term', unit, value: unit === 'topics' ? (term.raw ?? term.label) : term.label });
  const termByKey = new Map<string, VernacularTerm>(terms.map((term) => [term.key, term]));

  const stopwordNote = `Stopwords removed for ${vernacular.stopwordLanguages.map((code) => languageName(code)).join(', ')}.${vernacular.exclusions.length ? ` Hidden by the project: ${vernacular.exclusions.join(', ')}.` : ''}`;
  const strongest = vernacular.network.edges[0];
  const nodeLabel = new Map(vernacular.network.nodes.map((node) => [node.id, node.label]));

  return (
    <main className="dash">
      <DashPanel
        title={`Most used ${unitInfo.plural}`}
        context={scopeLabel}
        headline={top
          ? <>{percent(coverage)} of videos have {unitInfo.plural}. The most common is <strong>{top.label}</strong>, in {percent(top.share)} of videos{compared?.find((row) => !row.isNoise && row.ratio > 1) ? <>; most over-represented compared with {compare!.label}: <strong>{compared.find((row) => !row.isNoise && row.ratio > 1)!.label}</strong></> : null}.</>
          : `No ${unitInfo.plural} in this scope.`}
        controls={<Segmented label="Unit" value={unit} onChange={(next) => { setUnit(next); setLimit(20); }} options={UNITS.map((entry) => ({ value: entry.value, label: entry.label }))} />}
        method={{
          computed: `${UNIT_METHOD[unit]} Each term counts once per video (document frequency): "Videos" is how many videos use it, "Share" that number as a share of the ${whole.format(vernacular.videos)} videos, "Of views" the share of all views that went to those videos. ${unit === 'words' || unit === 'phrases' ? stopwordNote : vernacular.exclusions.length ? `Hidden by the project: ${vernacular.exclusions.join(', ')}.` : ''} The cloud sizes words by the square root of their share. ${compared ? 'In comparison mode, the table shows each term\'s share here and in the comparison set, the ratio of the two, and greys out differences that are not significant (log-likelihood G² < 3.84) or rest on fewer than 3 videos.' : ''}`,
          read: 'High "Share" means the term is part of the shared vocabulary of this set; a high "Of views" relative to "Share" means videos using it get more attention than average. Click a term to see its videos.',
          caveats: [
            'Hashtag and title-word drill-downs search the title or description text, so the explorer can match a few more videos (e.g. "war" inside "warning").',
            'Tags are invisible to viewers and often reused from templates; they describe how creators file videos, not what viewers see.',
            'Topic categories are assigned by YouTube, not by creators.',
          ],
        }}
        csv={() => ({
          columns: compared ? ['term', 'videos_here', 'share_here', 'videos_comparison', 'share_comparison', 'ratio', 'log_likelihood', 'significant'] : ['term', 'videos', 'share_of_videos', 'share_of_views'],
          rows: compared
            ? compared.map((row) => [row.label, row.countA, row.shareA.toFixed(4), row.countB, row.shareB.toFixed(4), row.ratio.toFixed(3), row.logLikelihood.toFixed(2), row.isNoise ? 'no' : 'yes'])
            : terms.map((term) => [term.label, term.videos, term.share.toFixed(4), term.viewShare.toFixed(4)]),
        })}
      >
        <div className="dash-row is-2">
          <div>
            {compared ? (
              <CompareTable
                rows={compared}
                labelA={scopeLabel}
                labelB={compare!.label}
                itemLabel={unitInfo.label}
                onSelect={onDrilldown ? (row) => drill(termByKey.get(row.key) ?? { key: row.key, label: row.label }) : undefined}
              />
            ) : (
              <TermList terms={terms} limit={limit} onMore={() => setLimit((current) => current + 30)} onSelect={onDrilldown ? drill : undefined} />
            )}
          </div>
          <WordCloud terms={terms} onSelect={onDrilldown ? (key) => { const term = termByKey.get(key); if (term) drill(term); } : undefined} />
        </div>
        <ExclusionEditor exclusions={exclusions} onChange={onExclusionsChange} />
      </DashPanel>

      <DashPanel
        title="Tags and hashtags that appear together"
        context={scopeLabel}
        headline={strongest
          ? <>The strongest pair: <strong>{nodeLabel.get(strongest.source)}</strong> and <strong>{nodeLabel.get(strongest.target)}</strong>, together in {whole.format(strongest.weight)} videos.</>
          : 'Too few shared tags or hashtags to draw a network.'}
        method={{
          computed: `Nodes are the ${vernacular.network.nodes.length} most used tags and hashtags (used by at least 2 videos), sized by how many videos use them. A line joins two terms used on the same video; thicker lines mean more videos. Hashtags and tags are separate nodes even when spelled alike. The GEXF and CSV exports contain the full network of every tag and hashtag used by 2 or more videos, for analysis in Gephi.`,
          read: 'Clusters of tightly connected terms are vocabularies used together, often a sub-topic or a set of channels with shared tag templates. Hover a term to highlight its neighbours; click it to see its videos.',
          caveats: [
            'Co-occurrence is not meaning: channels that paste the same tag block on every video create dense clusters.',
            'Large channels dominate the network because each of their videos counts.',
            'The layout is a force simulation: distances are approximate, and positions carry no meaning beyond proximity.',
          ],
        }}
        csv={() => {
          const network = getScopeRecords ? buildCooccurrence(getScopeRecords(), { exclusions: vernacular.exclusions, minVideos: 2 }) : vernacular.network;
          const labels = new Map(network.nodes.map((node) => [node.id, node.label]));
          return { columns: ['source', 'target', 'videos_together'], rows: network.edges.map((edge) => [labels.get(edge.source), labels.get(edge.target), edge.weight]) };
        }}
        extraActions={[{
          label: 'Download GEXF (Gephi)',
          run: () => {
            const network = getScopeRecords ? buildCooccurrence(getScopeRecords(), { exclusions: vernacular.exclusions, minVideos: 2 }) : vernacular.network;
            saveText(toGexf(network, `Tag and hashtag co-occurrence, ${scopeLabel}, ${snapshot.datasetLabel}`), `${slugify(`cooccurrence-${scopeLabel}`)}.gexf`, 'application/gexf+xml');
          },
        }]}
      >
        <NetworkGraph
          nodes={vernacular.network.nodes}
          edges={vernacular.network.edges}
          onSelect={onDrilldown ? (node) => onDrilldown({ kind: 'term', unit: node.kind === 'tag' ? 'tags' : 'hashtags', value: node.label }) : undefined}
        />
        <div className="dash-legend">
          <span><i className="dash-swatch is-tag" />tag</span>
          <span><i className="dash-swatch is-hashtag" />hashtag</span>
        </div>
      </DashPanel>
    </main>
  );
}
