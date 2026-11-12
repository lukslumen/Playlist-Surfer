# Dashboard redesign for digital methods research

Status: built (see REFACTOR_PLAN item 28).

Decided with the project owner on 2026-11-12, in four rounds of questions. The overview tab was already redesigned (see REFACTOR_PLAN item 27); this covers the other tabs.

## Principles

- **One research question per tab, no overlap.** If the overview shows something, no other tab repeats it.
- **Accessible but useful:** every panel has a plain-language headline sentence before any chart.
- **Reproducible:** every panel has a `⋯` menu with Download CSV, Save PNG, Save SVG, Copy method note. An `i` popover has the full method note: how it is computed, how to read it, and what to watch out for.
- **Comparable:** a Compare control shows the current scope against the whole dataset, or against any saved view, in every tab. Differences are shown side by side with an over/under-representation ratio, sorted by the biggest differences. Small counts are greyed out, so noise doesn't read as a finding.
- **One style:** the app's fonts and theme colours across the tab bar, the toolbar and every tab.

## Tabs

| Tab | Question | Panels |
| --- | --- | --- |
| Overview | What is in the set? | Done: summary, headline numbers, uploads, length, views, categories, languages, data health |
| Attention | Who and what gets seen? | 1. Concentration curve (videos or channels; views, likes or comments), with "top 10% get X%" and Gini. 2. Views vs engagement scatter (log views; likes and comments per 1K views), with outliers coloured. 3. One ranked table, sortable by views, engagement, or × channel median (this replaces the separate top lists and outlier list) |
| Vernacular | How is the space named? | Unit switch: title words and phrases, hashtags, video tags, topic categories. Ranked list plus a cleaned-up word cloud. A co-occurrence network of the top tags and hashtags, with GEXF and CSV export of the full network. Stopwords for the detected languages, plus a project-level exclusion list that is saved with the project and printed in the method note |
| Time | When, and how does it change? | Publishing rhythm (weekday × hour, UTC with a local toggle). Views by publish date, as a log scatter with a rolling median. Channel activity lanes for the top channels. Vernacular over time (top terms × period) |
| Links | Where does the space point outside YouTube? | Keep the ecology model and domain overrides. Show a summary sentence, bucket shares, top domains with their bucket, and per-video strategy. The audit and sorter move into an "Edit buckets" panel |

Removed as redundant with the overview: the content tab's categories, duration buckets and Shorts estimate, and the attention tab's views box plot. The heuristic "intent cues" are dropped: their keyword rules aren't defensible in a methods section.

## Build notes

- New pure libraries with tests: `attentionProfile`, `vernacularProfile` (plus `stopwords`), `timeProfile`, `compareShares`.
- Snapshots keep small, display-ready data, including the UTC and local heatmaps computed when the snapshot is made. Full-size exports (the GEXF network, complete lists) are computed on demand from the scope's rows.
- Image export uses a small exporter of our own (`lib/exportImage.ts`): the panel is cloned with inlined styles into an SVG `<foreignObject>`, and drawn to a canvas for PNG. Adding `html-to-image` was not allowed in this environment.
