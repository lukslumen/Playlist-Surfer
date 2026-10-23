import type { DashboardTemplateCountStat, DashboardTemplateSnapshot } from '../../../lib/dashboardTemplateTypes';
import { InfoPopover, InfoProps, MetricHeader } from './InfoPopover';
import { formatPercent } from './format';
import { KeywordCloud } from './KeywordCloud';

export type ContentFilterKind = 'category' | 'topic' | 'duration' | 'intent';

type CountListProps = {
  title: string;
  items: DashboardTemplateCountStat[];
  tone?: 'video' | 'channel' | 'engagement';
  info: InfoProps;
  onItemSelect?: (label: string) => void;
};

function CountList({ title, items, tone = 'video', info, onItemSelect }: CountListProps) {
  return (
    <div className="content-list-block">
      <MetricHeader title={title} info={info} />
      <div className="content-list">
        {items.map((item, index) => {
          const isClickable = Boolean(onItemSelect);
          const itemBody = (
            <>
              <div className="content-list-topline">
                <div className="content-list-label" title={item.label}>{item.label}</div>
                <div className="content-list-values"><strong>{item.count}</strong><span>{formatPercent(item.share, 1)}</span></div>
              </div>
              <div className="content-bar-track"><div className={`content-bar-fill tone-${tone}`} style={{ width: `${Math.max(item.share * 100, item.share > 0 ? 2 : 0)}%` }} /></div>
            </>
          );
          return isClickable ? (
            <button
              key={`${title}-${item.label}-${index}`}
              type="button"
              className="content-list-item w-full text-left transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_7%,transparent)]"
              onClick={() => onItemSelect?.(item.label)}
              title={`Filter by ${item.label}`}
            >
              {itemBody}
            </button>
          ) : (
            <div className="content-list-item" key={`${title}-${item.label}-${index}`}>
              {itemBody}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShortsEstimateBox({ snapshot }: { snapshot: DashboardTemplateSnapshot }) {
  const estimate = snapshot.content.shortsEstimate;
  const shortAngle = estimate.shortShare * 360;
  const donutBackground = `conic-gradient(
    var(--accent-engagement) 0deg ${shortAngle}deg,
    color-mix(in srgb, var(--accent-channel) 82%, #233425 18%) ${shortAngle}deg 360deg
  )`;

  return (
    <div className="shorts-estimate">
      <div className="section-title section-title-row">
        <span>estimated shorts share</span>
        <InfoPopover
          label="Estimated shorts share"
          oneLine="Heuristic estimate of shorts versus long-form videos."
          method="Each video accumulates a shorts score from hashtag, tag, keyword, and duration signals. A strong hashtag signal immediately classifies the row as shorts; otherwise the accumulated score must cross the threshold."
          codeSnippet={`const hasHashtagSignal = /#shorts?\\b/i.test(title + ' ' + description);

const hasTagSignal = tags.some((tag) => /^(short|shorts|ytshorts)$/i.test(tag));

const hasKeywordSignal = /\\b(yt\\s*shorts?|short-form|vertical video|60s|one minute|1 minute)\\b/i.test(title + ' ' + description);

const hasDurationSignal = durationSec <= 70;

let score = 0;
if (hasHashtagSignal) score += 3;
if (hasTagSignal) score += 2;
if (hasDurationSignal) score += 2;
if (hasKeywordSignal) score += 1;
if (/^\\s*#shorts?\\b/i.test(title)) score += 1;

const isEstimatedShort = hasHashtagSignal || score >= 3;`}
          codeExplanation="This is intentionally explainable rather than model-based. You can inspect each signal and understand why the estimate moved up or down, which makes the donut suitable for exploratory analysis instead of opaque scoring."
        />
      </div>
      <div className="shorts-pie-wrap">
        <div className="shorts-pie" style={{ background: donutBackground }} aria-label="Estimated shorts share pie chart">
          <div className="shorts-pie-core"><div className="shorts-pie-value">{formatPercent(estimate.shortShare, 0)}</div></div>
        </div>
      </div>
      <div className="shorts-footnote">n short={estimate.shortCount} / long={estimate.longCount}</div>
    </div>
  );
}

export function ContentTab({ snapshot, onApplyContentFilter }: { snapshot: DashboardTemplateSnapshot; onApplyContentFilter?: (kind: ContentFilterKind, label: string) => void; }) {
  return (
    <main className="dashboard-frame content-unified-frame content-final-layout">
      <section className="content-left-grid">
        <div className="content-cell content-cell-top-left">
          <CountList
            title="Top categories"
            items={snapshot.content.categories}
            tone="channel"
            onItemSelect={(label) => onApplyContentFilter?.('category', label)}
            info={{
              label: 'Top categories',
              oneLine: 'Most frequent video category labels in the dataset.',
              method: 'Each row contributes one resolved category label. Missing categories are retained as unknown so the chart still reflects metadata sparsity instead of silently dropping incomplete rows.',
              codeSnippet: `const categoryItems = rows.map((row) => row.videoCategoryLabel || 'unknown');\ncategories: countBy(categoryItems, 6);`,
              codeExplanation: 'The categories chart is row-based rather than view-weighted. It tells you what kinds of videos are present, not which categories dominate by attention.',
            }}
          />
        </div>
        <div className="content-cell content-cell-top-right">
          <CountList
            title="Top topics"
            items={snapshot.content.topics}
            tone="engagement"
            onItemSelect={(label) => onApplyContentFilter?.('topic', label)}
            info={{
              label: 'Top topics',
              oneLine: 'Most frequent topic category tokens after flattening topic arrays.',
              method: 'Rows can carry multiple topic categories. The dashboard flattens those arrays into one token stream, keeps unknown when topic metadata is missing, and normalizes by total topic observations.',
              codeSnippet: `const topicItems = rows.flatMap((row) => (\n  row.topicCategories.length ? row.topicCategories : ['unknown']\n));\ntopics: countBy(topicItems, 6);`,
              codeExplanation: 'Because rows can contribute more than one topic, this panel reads as share of topic tokens, not share of videos.',
            }}
          />
        </div>
        <div className="content-cell content-cell-bottom-left content-split-cell">
          <div className="content-split-left">
            <CountList
              title="Duration buckets"
              items={snapshot.content.durations}
              tone="channel"
              onItemSelect={(label) => onApplyContentFilter?.('duration', label)}
              info={{
                label: 'Duration buckets',
                oneLine: 'Runtime distribution in fixed editorial bins.',
                method: 'Duration values are normalized into stable, human-readable ranges such as under one minute, one to five minutes, and fifteen to thirty minutes. Missing or invalid durations remain visible as unknown.',
                codeSnippet: `function durationBucket(seconds: number | null): string {\n  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return 'unknown';\n  if (seconds < 60) return '<1m';\n  if (seconds < 300) return '1-5m';\n  if (seconds < 900) return '5-15m';\n  if (seconds < 1800) return '15-30m';\n  return '30m+';\n}`,
                codeExplanation: 'The buckets are intentionally coarse so the distribution is legible at a glance and directly comparable across exports.',
              }}
            />
          </div>
          <div className="content-split-right"><ShortsEstimateBox snapshot={snapshot} /></div>
        </div>
        <div className="content-cell content-cell-bottom-right">
          <CountList
            title="Intent cues"
            items={snapshot.content.intent}
            tone="video"
            onItemSelect={(label) => onApplyContentFilter?.('intent', label)}
            info={{
              label: 'Intent cues',
              oneLine: 'Rule-based editorial intent inferred from title and description text.',
              method: 'Intent is assigned with deterministic first-match-wins regex rules applied in order: tutorial/explainer, review/comparison, news/update, opinion/reaction, interview/talk, then fallback to other. If a title/description matches multiple patterns, only the first matching bucket is used.',
              codeSnippet: `const INTENT_PATTERNS = [
  { label: 'tutorial / explainer', pattern: /\\b(how\\s+to|tutorial|guide|explained|what\\s+is|basics?)\\b/i },
  { label: 'review / comparison', pattern: /\\b(review|vs\\.?|versus|comparison|top\\s+\\d+|best|worst|rating)\\b/i },
  { label: 'news / update', pattern: /\\b(news|update|breaking|latest|today)\\b/i },
  { label: 'opinion / reaction', pattern: /\\b(opinion|reaction|responds?|debunk|rant|hot\\s+take)\\b/i },
  { label: 'interview / talk', pattern: /\\b(interview|podcast|conversation|talk|debate)\\b/i },
];

function inferIntent(text: string): string {
  for (const candidate of INTENT_PATTERNS) {
    if (candidate.pattern.test(text)) return candidate.label;
  }
  return 'other';
}`,
              codeExplanation: 'The regex stack is explicit and ordered, so buckets are reproducible and auditable instead of opaque.',
            }}
          />
        </div>
      </section>

      <section className="content-right-column">
        <div className="content-right-box">
          <KeywordCloud
            title="Title keywords"
            items={snapshot.content.keywords.titleKeywords}
            tone="video"
            info={{
              label: 'Title keywords',
              oneLine: 'Keyword prominence by title-level document frequency.',
              method: 'Titles are normalized and tokenized, stopwords are removed, and each token counts at most once per video so repeated words in a single title do not inflate the cloud.',
              codeSnippet: `const titleTexts = rows.map((row) => row.title).filter(Boolean);\ntitleKeywords: keywordDocumentFrequency(titleTexts, 48);`,
              codeExplanation: 'Document frequency answers how widespread a term is across the dataset, not how many times it repeats inside the same item. That makes the cloud more robust as a topical summary.',
            }}
          />
        </div>
        <div className="content-right-box">
          <KeywordCloud
            title="Description keywords"
            items={snapshot.content.keywords.descriptionKeywords}
            tone="engagement"
            info={{
              label: 'Description keywords',
              oneLine: 'Keyword prominence by description-level document frequency.',
              method: 'Descriptions are normalized, tokenized, filtered for stopwords, and then counted once per row. This often surfaces framing phrases, calls to action, and recurring contextual language.',
              codeSnippet: `const descriptionTexts = rows.map((row) => row.description).filter(Boolean);\ndescriptionKeywords: keywordDocumentFrequency(descriptionTexts, 48);`,
              codeExplanation: 'Because descriptions are longer than titles, this cloud is often better for editorial framing than for concise topic names.',
            }}
          />
        </div>
        <div className="content-right-box">
          <KeywordCloud
            title="Tag keywords"
            items={snapshot.content.keywords.tagKeywords}
            tone="channel"
            info={{
              label: 'Tag keywords',
              oneLine: 'Keyword prominence by tag-level document frequency.',
              method: 'Tags are joined per video before tokenization. The resulting document-frequency count surfaces the vocabulary that creators explicitly attached to their uploads.',
              codeSnippet: `const tagTexts = rows.map((row) => row.tags.join(' ')).filter(Boolean);\ntagKeywords: keywordDocumentFrequency(tagTexts, 48);`,
              codeExplanation: 'Tags often reveal explicit self-labeling, which can differ from what is visible in titles or descriptions alone.',
            }}
          />
        </div>
      </section>
    </main>
  );
}
