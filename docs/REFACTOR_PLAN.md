# Playlist Surfer: analysis and refactor plan

Status: draft v3 for review. Exclude fails through both the shortcut and the multi-select button. Target size: **optimize for up to 100k rows** (usually fewer); 1M is an edge case that should degrade gracefully, not crash. The project is on GitHub (`lukslumen/Playlist-Surfer`) and deployed on Vercel. Nothing in `src/` has been changed yet.

## 1. Verdict: refactor step by step; slim the in-memory pipeline instead of rebuilding the data layer

- **UI and domain logic → refactor step by step.** `src/lib/` (linking, dashboards, archive and manifest, timestamp notes, selection) is mostly pure and worth keeping. The mess sits in the app shell: `App.tsx` and a few oversized components.
- **Data layer → keep rows in memory, but make the pipeline efficient.** At 100k rows × ~35 columns, keeping the data in JS is fine (roughly 100–300 MB) and gives the snappiest UI: synchronous, no scroll flicker, AG Grid's client-side model with full sort and filter. The problem today isn't the approach, it's the waste. Rows are copied about 6 times through a chain of `useMemo`s, and every exclusion recomputes the whole chain, including text inference over every row. Fixing that is a refactor, not a rebuild.
- **1M rows → graceful degradation.** Show a warning on import, load long text columns (transcripts, descriptions) on demand, and run heavy passes in the worker. Moving to a DuckDB-backed data engine stays an option, decided by the Phase 0 performance tests rather than now.
- **DuckDB:** it's currently only a CSV parser, and a heavy download. Phase 0 measures it against PapaParse on 100k rows and keeps whichever is better overall (start-up time, parse time, memory).

## 2. What is messy (by severity)

### 2.1 `App.tsx` is the whole application (7,209 lines)
- Lines 161–1134 hold about 80 loose helper functions: fingerprints, archive helpers, column finders, shortcut matchers, clipboard code and so on.
- One component has **70 `useState`, 88 `useMemo`, 105 `useCallback`, 29 `useEffect`** and about 340 lines of JSX props wiring.
- Every concern lives here: import, merging, lineage, inclusion, filters, sort, saved views, selection, notes and tags, channel metadata, linking, thumbnails, dashboards, research history, navigation history, undo/redo, keyboard shortcuts, persistence and export.
- `flushSync` and `startTransition` are mixed with effects that have large dependency arrays, so the order of updates is hard to predict. There's also no `react-hooks/exhaustive-deps` lint rule checking about 220 hand-written dependency arrays.

### 2.2 Include/exclude: spread across files, partly broken

The state lives in `App.tsx`. Two separate keyboard handlers (a `window` listener in App and `onKeyDownCapture` in `MetadataGrid`) both react to Delete, and the buttons are threaded through four components.

| # | Defect | Where | Breaks |
|---|--------|-------|--------|
| A | The Mac delete key sends `Backspace`, but the handlers only check `'Delete'`. | `MetadataGrid.tsx:507,547`, `App.tsx:3604,3614` | shortcut |
| B | `handleExcludeSelectedVideos` always sends `'exclude'`, so it does nothing in the Excluded view. | `App.tsx:3279` | shortcut **and button** |
| C | Rows without a video ID that `resolveVideoId` recognises (`videoId/video_id/id/Video_ID/videoID`) can't be excluded. Their grid row ID is `''`, so AG Grid sees duplicate IDs and selection breaks. They're dropped silently. | `data.ts:433`, `App.tsx:815`, `MetadataGrid.tsx:729` | shortcut **and button** |
| D | Large datasets: each exclusion clears the thumbnail caches and recomputes the whole row chain inside a `startTransition`. The old UI stays on screen with no feedback, so the action looks like a no-op. | `App.tsx:3146–3260`, `1344–1440` | shortcut **and button** |
| E | Any failure is silent: no toast or count telling you what was or wasn't moved. | `App.tsx:3148` | all |

The sample CSV you sent (`videolist_playlist61_…csv`: 61 rows, a YTDT export, clean and unique `videoId`s) **rules out C and D** for this failure. So it's a logic bug in the selection → action → render chain: B, or something only visible at runtime. **The first job once Node is installed is to reproduce it in the browser** with that file, which also becomes the regression fixture.

### 2.3 Performance bottlenecks (matter at 100k, critical at 1M)
- The full dataset is cloned from the DuckDB worker into the main thread (`READ_CSV` → `postMessage`), then copied again through `stripDeletedColumns → sourceMasked → partition → overlayGenerated → buildDisplayRows → filter`.
- Expensive full passes run on every change. One example is `inferIntentFromText` over every title and description (`App.tsx:1364`). There's also column-type detection and building the tag index.
- localStorage writes happen in an idle callback with **no try/catch** (`App.tsx:1853`), and the project autosave writes to IndexedDB as well, so there are two stores with different shapes.
- `largeData.ts` (a loop-based `maxOf`/`minOf`) shows large data has already caused stack overflows from `Math.max(...rows)`.

### 2.4 Oversized components
- `Dialogs.tsx` (2,424 lines) holds 6 dialogs in one file; `ImportDialog` alone is about 775 lines.
- `DetailPanel.tsx` (1,700), `ChannelSummaryPanel.tsx` (1,172), `TemplateDashboard.tsx` (1,274) and `LinkingDashboard.tsx` (854) mix layout, state and data logic.
- There are three styling systems: Tailwind, `index.css` (1,559 lines) and about 5,000 lines of "exact" dashboard CSS.

### 2.5 Types and tooling
- 223 uses of `any`. Rows are `any[]`, so column-name guessing is repeated across files instead of happening once at import.
- 7 tests are hand-run node scripts (3 are wired into npm). There's no test runner, ESLint or CI.
- Leftovers from the AI Studio template: name `react-example`, version `40.0.0`, `metadata.json`, an unused `dotenv`, and build tools listed under `dependencies`.

## 3. Plan

Every phase ends green (typecheck, lint, unit, e2e, build) and goes in as its own PR, each getting a Vercel preview deployment.

### Performance targets
| Action | 10k rows | 100k rows | 1M rows (edge case) |
|---|---|---|---|
| Exclude/restore: visible result | < 50 ms | < 100 ms | < 1 s, with a busy indicator |
| Change a filter | < 50 ms | < 150 ms | < 2 s, with progress |
| Scrolling | no blank rows | no blank rows | no blank rows |
| Import | < 2 s | < 8 s, with progress | completes without crashing, with a warning |

### Phase 0: safety net
1. Work in the GitHub clone (`Coding Projects/Playlist-Surfer`) on a branch. Install Node 20 LTS.
2. Run a baseline `npm ci`, `tsc` and `vite build`. **Reproduce the exclude bug** with the 61-row sample.
3. Add Vitest and convert the existing 7 tests. Add ESLint with `react-hooks` and `@typescript-eslint`.
4. Add Playwright smoke flows on the sample fixture: import → exclude (button, shortcut, context menu) → Excluded view → restore → undo → export zip → re-import.
5. Generate synthetic **10k, 100k and 1M-row** fixtures in YTDT format. Add a perf script that measures the targets above, plus a DuckDB vs PapaParse parse comparison.
6. Add a GitHub Actions workflow running lint, typecheck, unit, e2e and build on every PR. The perf script runs on demand, not on every PR.

### Phase 1: fix include/exclude (on the current architecture)
1. Extract a pure `src/lib/inclusion.ts` reducer (exclude, restore, toggle, undo, redo, meta, and history entries as data). Unit-test it fully.
2. Fixes:
   - Accept `Backspace` as well as `Delete`.
   - Make the actions direction-aware.
   - Assign a **stable row ID at import** and key everything by it.
   - Add one shortcut handler.
   - Show a busy state and a toast ("12 videos excluded / 3 could not be moved").
3. Add e2e tests for each defect.

### Phase 2: slim the data pipeline (in memory)
1. **Normalize once at import.** Each row gets `rowId`, `videoId` and `channelId`, plus a precomputed lowercase search text. Intent inference, column-type detection and the list/boolean-map column scan run once per import (in the worker), not on every change.
2. **One row array, no copies.** Exclusions, tags, notes and generated metadata live in `Map`s/`Set`s keyed by `rowId`. Views read them through AG Grid `valueGetter`s and an external filter, instead of rebuilding row objects.
3. **Exclusion becomes a set change.** Excluding updates the `Set` and calls `api.onFilterChanged()`. Nothing upstream recomputes.
4. **Filtering:** compile the filter model once into a predicate function. Let AG Grid's client-side model do sorting. Debounce text filters.
5. **Persistence:** use one versioned IndexedDB store with migrations, and handle errors. Keep only UI preferences in localStorage.
6. **1M safety valve:** warn on import above about 300k rows, keep transcripts and long descriptions out of the grid rows (loaded when a video's details open), and move heavy dashboard aggregates into the worker.
7. **Checkpoint:** rerun the perf script. If 100k meets the targets, the data layer is done. If not, the DuckDB-engine route comes back on the table, with numbers to judge it by.

### Phase 3: state architecture and component split
1. A **Zustand** store with slices:
   - `dataset`
   - `curation`
   - `view`: filters, sort, saved views, columns
   - `ui`
   - `dashboards`
   - `history`
2. Move App's ~80 helpers into `lib/` modules by domain. Add a single `useShortcuts` registry. Target: `App.tsx` under 300 lines.
3. Split `Dialogs.tsx` into one file per dialog, with `ImportDialog` broken into steps. Split `DetailPanel`, `ChannelSummaryPanel` and the dashboards into containers that read the store plus presentational parts. Add React Testing Library tests for key interactions. Guideline: no file over about 600 lines.

### Phase 4: types and cleanup
- `VideoRow`/`ChannelRow` types. Remove the `any` from rows and enable stricter TS options.
- Pick one styling approach (Tailwind + tokens) and shrink the "exact" CSS.
- Remove dead code (`knip`), fix `package.json` metadata, move build tools to `devDependencies`, and drop `dotenv`. Drop DuckDB if PapaParse wins the Phase 0 comparison.
