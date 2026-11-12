import type { DashboardTemplateVideoRecord } from './dashboardTemplateTypes';
import { normalizeLanguage, UNKNOWN_LANGUAGE } from './overviewProfile';
import { buildStopwordSet } from './stopwords';

// The vernacular tab: the words, phrases, hashtags, tags and topics a set of videos uses, counted as the
// number of videos that use them (document frequency), and which tags and hashtags appear together.

export type VernacularUnit = 'words' | 'phrases' | 'hashtags' | 'tags' | 'topics';

export interface VernacularTerm {
  /** Normalized form, used for counting and comparing. */
  key: string;
  /** How it is shown: the most common original spelling. */
  label: string;
  videos: number;
  share: number;
  /** Share of all views that went to videos using the term. */
  viewShare: number;
  /** For topics: the value as stored in the data (often a Wikipedia URL), used for drill-downs. */
  raw?: string;
}

export interface CooccurrenceNode {
  id: string;
  label: string;
  kind: 'tag' | 'hashtag';
  videos: number;
}

export interface CooccurrenceEdge {
  source: string;
  target: string;
  weight: number;
}

export interface VernacularProfile {
  videos: number;
  terms: Record<VernacularUnit, VernacularTerm[]>;
  /** Videos that have at least one term of the unit. */
  coverage: Record<VernacularUnit, number>;
  network: { nodes: CooccurrenceNode[]; edges: CooccurrenceEdge[] };
  stopwordLanguages: string[];
  exclusions: string[];
}

export const TERM_LIMIT = 150;
export const NETWORK_NODES = 40;
const MIN_PHRASE_VIDEOS = 2;

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

export function tokenize(text: string): string[] {
  return (String(text || '').toLowerCase().match(WORD_RE) ?? [])
    .map((token) => token.replace(/['’-]+$/g, ''))
    .filter((token) => token.length > 1 && !/^\d+$/.test(token));
}

export function extractHashtags(text: string): string[] {
  const value = String(text || '');
  // Most descriptions have no hashtag; skip the Unicode regex for them.
  if (!value.includes('#')) return [];
  return (value.match(HASHTAG_RE) ?? []).filter((tag) => !/^#\d+$/.test(tag));
}

/** "https://en.wikipedia.org/wiki/Television_program" -> "Television program". */
export function topicLabel(raw: string): string {
  const value = String(raw || '').trim();
  const fromUrl = value.match(/\/wiki\/([^/?#]+)/);
  const name = fromUrl ? decodeURIComponent(fromUrl[1]) : value;
  return name.replace(/_/g, ' ').trim();
}

/** Two- and three-word phrases that neither start nor end with a stopword. */
export function phrases(tokens: string[], stopwords: Set<string>): string[] {
  const result: string[] = [];
  for (let size = 2; size <= 3; size += 1) {
    for (let start = 0; start + size <= tokens.length; start += 1) {
      const slice = tokens.slice(start, start + size);
      if (stopwords.has(slice[0]) || stopwords.has(slice[slice.length - 1])) continue;
      result.push(slice.join(' '));
    }
  }
  return result;
}

class TermCounter {
  private videos = new Map<string, number>();
  private views = new Map<string, number>();
  private spellings = new Map<string, Map<string, number>>();

  /** Counts each key once per video, remembering how it was spelled when that differs from the key. */
  addVideo(terms: Array<string | { key: string; label: string }>, views: number) {
    const seen = new Set<string>();
    terms.forEach((term) => {
      const key = typeof term === 'string' ? term : term.key;
      if (!key) return;
      if (typeof term !== 'string' && term.label !== key) {
        const spelling = this.spellings.get(key) ?? new Map<string, number>();
        spelling.set(term.label, (spelling.get(term.label) ?? 0) + 1);
        this.spellings.set(key, spelling);
      }
      if (seen.has(key)) return;
      seen.add(key);
      this.videos.set(key, (this.videos.get(key) ?? 0) + 1);
      this.views.set(key, (this.views.get(key) ?? 0) + views);
    });
    return seen;
  }

  top(totalVideos: number, totalViews: number, limit: number, minVideos = 1): VernacularTerm[] {
    return [...this.videos.entries()]
      .filter(([, count]) => count >= minVideos)
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([key, count]) => {
        // The most common original spelling; a key that was always spelled like itself has no entry.
        const spellings = this.spellings.get(key);
        const sameAsKey = (this.videos.get(key) ?? 0) - [...(spellings?.values() ?? [])].reduce((sum, value) => sum + value, 0);
        const best = spellings ? [...spellings.entries()].sort((a, b) => b[1] - a[1])[0] : undefined;
        const spelling = best && best[1] > sameAsKey ? best[0] : key;
        return {
          key,
          label: spelling,
          videos: count,
          share: totalVideos ? count / totalVideos : 0,
          viewShare: totalViews ? (this.views.get(key) ?? 0) / totalViews : 0,
        };
      });
  }
}

export interface VernacularOptions {
  exclusions?: string[];
  /** Terms already extracted with termIndex(), so several profiles don't extract them again. */
  index?: TermIndex;
}

export type VideoTerms = ReturnType<typeof videoTerms>;

export interface TermIndex {
  perVideo: VideoTerms[];
  languages: string[];
  exclusions: string[];
}

/** Every video's terms, extracted once for the vernacular, network and time profiles. */
export function termIndex(records: DashboardTemplateVideoRecord[], exclusions: string[] = []): TermIndex {
  const cleaned = exclusions.map((term) => term.trim()).filter(Boolean);
  const { stopwords, excluded, languages } = datasetStopwords(records, cleaned);
  return { perVideo: records.map((record) => videoTerms(record, stopwords, excluded)), languages, exclusions: cleaned };
}

/** Per video, the normalized terms of each unit; shared by the profile, the network export and the time tab. */
export function videoTerms(record: DashboardTemplateVideoRecord, stopwords: Set<string>, excluded: Set<string>) {
  const keep = (key: string) => key && !excluded.has(key.replace(/^#/, ''));
  // Words and phrases are lower-cased already, so they are plain strings (their own key and label).
  const tokens = tokenize(record.title);
  const words = tokens.filter((token) => !stopwords.has(token) && keep(token));
  const titlePhrases = phrases(tokens, stopwords).filter((phrase) => keep(phrase));
  const hashtags = extractHashtags(`${record.title}\n${record.description}`)
    .map((tag) => ({ key: tag.toLowerCase(), label: tag }))
    .filter((term) => keep(term.key));
  const tags = record.tags
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .map((tag) => ({ key: tag.toLowerCase(), label: tag }))
    .filter((term) => keep(term.key));
  // Topics keep their stored form as the label, so drill-downs can filter on the exact value.
  const topics = record.topicCategories
    .map((topic) => ({ key: topicLabel(topic).toLowerCase(), label: String(topic).trim() }))
    .filter((term) => term.key);
  return { words, phrases: titlePhrases, hashtags, tags, topics };
}

export function datasetStopwords(records: DashboardTemplateVideoRecord[], exclusions: string[] = []) {
  const counts = new Map<string, number>();
  records.forEach((record) => {
    const code = normalizeLanguage(record.defaultAudioLanguage || record.defaultLanguage);
    if (code !== UNKNOWN_LANGUAGE) counts.set(code, (counts.get(code) ?? 0) + 1);
  });
  const shares = [...counts.entries()].map(([code, count]) => ({ code, share: records.length ? count / records.length : 0 }));
  const { words, languages } = buildStopwordSet(shares, exclusions);
  const excluded = new Set(exclusions.map((term) => term.trim().toLowerCase().replace(/^#/, '')).filter(Boolean));
  return { stopwords: words, excluded, languages };
}

/** Tag and hashtag co-occurrence over all videos: nodes used by at least `minVideos` videos. */
export function buildCooccurrence(records: DashboardTemplateVideoRecord[], options: VernacularOptions & { maxNodes?: number; minVideos?: number } = {}) {
  const index = options.index ?? termIndex(records, options.exclusions);
  const perVideo = index.perVideo.map((terms) => {
    const nodes = new Map<string, { label: string; kind: 'tag' | 'hashtag' }>();
    terms.tags.forEach((term) => nodes.set(term.key, { label: term.label, kind: 'tag' }));
    terms.hashtags.forEach((term) => { if (!nodes.has(term.key)) nodes.set(term.key, { label: term.label, kind: 'hashtag' }); });
    return nodes;
  });
  const counts = new Map<string, { label: string; kind: 'tag' | 'hashtag'; videos: number }>();
  perVideo.forEach((nodes) => nodes.forEach((node, key) => {
    const entry = counts.get(key) ?? { ...node, videos: 0 };
    entry.videos += 1;
    counts.set(key, entry);
  }));
  const minVideos = options.minVideos ?? 1;
  const selected = [...counts.entries()]
    .filter(([, entry]) => entry.videos >= minVideos)
    .sort((a, b) => (b[1].videos - a[1].videos) || a[0].localeCompare(b[0]))
    .slice(0, options.maxNodes ?? Infinity);
  // Pair counts keyed by number (i * n + j). Videos often carry 30 tags, so this runs tens of millions of
  // times: a dense matrix for the display network, a Map when the full export has thousands of nodes.
  const indexByKey = new Map(selected.map(([key], index) => [key, index]));
  const n = selected.length;
  const dense = n <= 2000 ? new Uint32Array(n * n) : null;
  const sparse = dense ? null : new Map<number, number>();
  perVideo.forEach((nodes) => {
    const ids: number[] = [];
    nodes.forEach((_, key) => {
      const id = indexByKey.get(key);
      if (id !== undefined) ids.push(id);
    });
    ids.sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const edge = ids[i] * n + ids[j];
        if (dense) dense[edge] += 1;
        else sparse!.set(edge, (sparse!.get(edge) ?? 0) + 1);
      }
    }
  });
  const pairs: Array<[number, number]> = [];
  if (dense) dense.forEach((weight, edge) => { if (weight) pairs.push([edge, weight]); });
  else sparse!.forEach((weight, edge) => pairs.push([edge, weight]));
  const ids = selected.map(([key]) => key);
  return {
    nodes: selected.map(([key, entry]) => ({ id: key, label: entry.label, kind: entry.kind, videos: entry.videos })),
    edges: pairs
      .map(([edge, weight]) => ({ source: ids[Math.floor(edge / n)], target: ids[edge % n], weight }))
      .sort((a, b) => (b.weight - a.weight) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target)),
  };
}

export function buildVernacularProfile(records: DashboardTemplateVideoRecord[], options: VernacularOptions = {}): VernacularProfile {
  const index = options.index ?? termIndex(records, options.exclusions);
  const { exclusions, languages } = index;
  const counters: Record<VernacularUnit, TermCounter> = {
    words: new TermCounter(), phrases: new TermCounter(), hashtags: new TermCounter(), tags: new TermCounter(), topics: new TermCounter(),
  };
  const coverage: Record<VernacularUnit, number> = { words: 0, phrases: 0, hashtags: 0, tags: 0, topics: 0 };
  let totalViews = 0;
  records.forEach((record, position) => {
    const views = record.viewCount ?? 0;
    totalViews += views;
    const terms = index.perVideo[position];
    (Object.keys(counters) as VernacularUnit[]).forEach((unit) => {
      if (counters[unit].addVideo(terms[unit], views).size) coverage[unit] += 1;
    });
  });
  const total = records.length;
  const network = buildCooccurrence(records, { index, maxNodes: NETWORK_NODES, minVideos: 2 });
  return {
    videos: total,
    terms: {
      words: counters.words.top(total, totalViews, TERM_LIMIT),
      phrases: counters.phrases.top(total, totalViews, TERM_LIMIT, MIN_PHRASE_VIDEOS),
      hashtags: counters.hashtags.top(total, totalViews, TERM_LIMIT),
      tags: counters.tags.top(total, totalViews, TERM_LIMIT),
      topics: counters.topics.top(total, totalViews, TERM_LIMIT).map((term) => ({ ...term, raw: term.label, label: topicLabel(term.label) })),
    },
    coverage,
    network: { nodes: network.nodes, edges: network.edges.filter((edge) => edge.weight >= 2 || network.nodes.length < 15).slice(0, 400) },
    stopwordLanguages: languages,
    exclusions,
  };
}

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The network as GEXF 1.3 for Gephi: nodes carry kind and video count, edges their co-occurrence count. */
export function toGexf(network: { nodes: CooccurrenceNode[]; edges: CooccurrenceEdge[] }, description: string): string {
  const nodes = network.nodes.map((node) => (
    `      <node id="${escapeXml(node.id)}" label="${escapeXml(node.label)}"><attvalues><attvalue for="kind" value="${node.kind}"/><attvalue for="videos" value="${node.videos}"/></attvalues></node>`
  ));
  const edges = network.edges.map((edge, index) => (
    `      <edge id="${index}" source="${escapeXml(edge.source)}" target="${escapeXml(edge.target)}" weight="${edge.weight}"/>`
  ));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gexf xmlns="http://gexf.net/1.3" version="1.3">',
    `  <meta><creator>Playlist Surfer</creator><description>${escapeXml(description)}</description></meta>`,
    '  <graph defaultedgetype="undirected">',
    '    <attributes class="node"><attribute id="kind" title="kind" type="string"/><attribute id="videos" title="videos" type="integer"/></attributes>',
    '    <nodes>',
    ...nodes,
    '    </nodes>',
    '    <edges>',
    ...edges,
    '    </edges>',
    '  </graph>',
    '</gexf>',
  ].join('\n');
}

/** Exact video counts for the given term keys, so comparisons don't depend on each side's top list. */
export function countTermVideos(records: DashboardTemplateVideoRecord[], unit: VernacularUnit, keys: Set<string>, exclusions: string[] = []): Map<string, number> {
  const { stopwords, excluded } = datasetStopwords(records, exclusions);
  const counts = new Map<string, number>();
  records.forEach((record) => {
    const seen = new Set<string>();
    (videoTerms(record, stopwords, excluded)[unit] as Array<string | { key: string }>).forEach((term) => {
      const key = typeof term === 'string' ? term : term.key;
      if (!keys.has(key) || seen.has(key)) return;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  });
  return counts;
}
