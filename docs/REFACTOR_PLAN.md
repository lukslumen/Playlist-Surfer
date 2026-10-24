# Playlist Surfer: analysis and refactor plan

Status: draft v3 for review. Exclude fails through both the shortcut and the multi-select button. Target size: **optimize for up to 100k rows** (usually fewer); 1M is an edge case that should degrade gracefully, not crash. The project is on GitHub (`lukslumen/Playlist-Surfer`) and deployed on Vercel.

## Progress (branch `refactor/phase0-safety-net`)

**Root cause of "exclude does nothing":** the last commit ("fixed thumbnails") left `clearAllThumbnailCaches` referring to `hydratedSessionCounter`, a variable that only exists inside project hydration. Every include/exclude action threw a `ReferenceError` before changing any state. `tsc` reported it, but nothing ran `tsc`. Fixed, and confirmed in the browser with the 61-row sample: the bug reproduces with the old code and is gone with the fix.

Done:
- **Phase 0:**
  - Vitest, with the 7 existing tests converted.
  - ESLint (`react-hooks`), with 0 errors and 57 warnings left to work through.
  - `npm run check`.
  - Playwright e2e suite on the sample CSV.
  - GitHub Actions CI.
  - Perf fixture generator and an opt-in perf spec.
- **Phase 1:**
  - Pure `src/lib/inclusion.ts` with 9 unit tests.
  - Undo only reverses the videos that actually changed.
  - Exclude/restore follows the current view.
  - Backspace works as Delete.
  - Cmd+Delete no longer fires while typing.
  - The grid passes its current selection to shortcuts.
  - The batch tag input no longer steals focus on multi-select. This was a second reason shortcuts failed with several rows selected.

Still open from phase 1:
- Defect C: rows without a recognised video ID. This needs stable row IDs (phase 2).
- On-screen feedback when nothing moved. There's no toast system yet (phase 3).
- A Shift-click right after switching to the Excluded view was ignored once. Seen manually, not reproduced since.

## Progress, phase 2 (branch `refactor/phase2-pipeline`, stacked on phase 0/1)

**Measurement correction.** The first baseline was taken on the dev server. In development, React 19 diffs every component prop for its profiler, including the 100k-row arrays, which made everything about 6× slower. It also counted uncollected garbage as heap. Perf runs now use an unminified production build (`playwright.perf.config.ts`) and time interactions inside the page, from keydown to the first painted frame, taking the median of 5 runs.

| Production build | 10k before | 10k after | 100k before | 100k after | Target 10k / 100k |
|---|---|---|---|---|---|
| Import (parse + to grid) | 0.9 s + 0.6 s | 0.8 s + 0.5 s | 4.1 s + 4.5 s | 3.4 s + 2.9 s | – |
| Exclude 1 row | 173 ms* | **40 ms** | 1.4 s* | **64 ms** | 50 / 100 ms |
| Undo | 207 ms* | **14 ms** | 1.5 s* | **60 ms** | |
| Select all | 283 ms* | 11 ms | **tab crashed** | 145 ms | |
| Exclude all | 69 ms* | 19 ms | – | 130 ms | |

\* Measured with Playwright polling, which adds up to about 100 ms. The trend is right but the numbers aren't exact.

What made the difference:
1. **Tag-filter option lists are built on demand**, per column, when a filter opens. Before, every tag column's values were rebuilt over all rows on every change: about 60% of an exclude at 100k. Saved-view filtering also no longer builds them.
2. **Grid column definitions stay stable.** The column-type props keep their identity while unchanged (`useStableValue`), width samples are taken once per schema, and two misspelled grid options are fixed: they made AG Grid fuzzy-match option names on every update.
3. **Batched, diff-based grid selection** (`setNodesSelected`). Selecting rows one at a time fired 100k events and crashed the tab on select-all.
4. **Row objects stay stable across include/exclude.** The overlays run before the inclusion split, so AG Grid skips rows it already has.

**Two data-loss bugs found and fixed while measuring:**
- **Curation lost on reload from about 30k rows.** All app state (exclusions, notes, tags, views, lineage) went to localStorage, whose roughly 5 MB quota was exceeded. The write threw silently and nothing was saved. It now lives in IndexedDB, with a one-time migration from localStorage.
- **Dataset lost on reload from about 20k rows.** The row autosave was a single IndexedDB value. Chromium rejects values above about 133 MB, and 100k rows serialize to 610 MB. Rows are now stored in 1,000-row chunks within one transaction.

Both are verified at 10k and 100k: the data and the exclusions come back after a reload (`e2e/profile/storage.profile.ts`).

Memory: about 760 MB of live heap at 100k rows (301 MB CSV), mostly the text itself. That's acceptable for the 100k target. A 1M-row file would need the long text kept out of the grid rows (the plan's 1M safety valve).

Run: `node scripts/generate-perf-fixture.mjs 100000`, then `PERF=1 PERF_ROWS=10000,100000 npx playwright test --config playwright.perf.config.ts e2e/perf.spec.ts`.

## Progress, phase 3 (branch `refactor/phase3-structure`, stacked on phase 2)

App.tsx: **7,256 → 5,880 lines**. Every step is behaviour-preserving and was checked with typecheck, lint, 31 unit tests and 12 e2e tests, plus the perf run after the include/exclude move (unchanged: 40 ms / 68 ms at 10k / 100k).

Done:
1. **Helpers into `lib/`.** 79 top-level functions, constants and types moved with TypeScript's "Move to file" refactor into `projectSourceState`, `columnDefaults`, `fingerprints`, `thumbnailCache`, `projectNotes`, `keyboard`, `browser`, `researchHistory` and `navigation`, plus additions to `inclusion` and `selectionState`, and a `LongTaskOverlay` component.
2. **One shortcut registry.** `lib/shortcuts.ts` (`APP_SHORTCUTS`) and the `useShortcuts` hook replace App's 175-line keydown handler. The help dialog is generated from the registry, so it now also lists Esc, the arrow keys, Ctrl+←/→ and Delete/Backspace.
3. **State slices as hooks** in `src/state/`:
   - `useDialogs`: dialog flags and Esc order.
   - `useResearchHistory`.
   - `useInclusion`: `useInclusionState` plus `useInclusionActions`. The research-log entry builder is now a pure, tested function.
4. **`Dialogs.tsx` split** into `components/dialogs/`, one file per dialog plus `shared.tsx`.

**Why hooks, not Zustand (yet):** the include/exclude update runs in a React transition so the grid stays responsive, and external stores can't be updated inside a transition. Hooks keep React's semantics while grouping the state by domain. Switching a slice to a store later is a small step if prop drilling becomes the main pain.

Continued (same branch):
5. **Import flow.** The import decisions are pure functions in `lib/importPlan.ts`: `planReplaceImport`, `planMergeImport`, and `buildMergedSourceState` for row/column lineage. `state/useImportFlow.ts` owns the import dialog, the pending file, errors, progress and cleanup. `handleImportConfirm` went from about 380 to about 150 lines. A new e2e test merges a second CSV.
6. **Persistence.** `state/usePersistence.ts` saves one `persistedAppState` object whenever any of its fields changes. That replaces a 45-entry dependency list. It also stopped re-serializing all rows on every tab hide (about 600 MB at 100k rows) and now re-saves rows after a special-field mapping change, which used to be missed.
7. **Layout.** `components/layout/` holds `StatusFooter`, `RightPanelShell` and `ChannelMetadataEmptyState`.

8. **Navigation history.** It's now pure (`lib/navigation.ts`) with the `useNavigationHistory` hook. This fixed three bugs:
   - **Forward never worked after Back:** the restore spans several renders and the intermediate locations were recorded.
   - **The restore ran inside a state updater.**
   - **An off-by-one at the 120-entry cap.**
9. **Thumbnails.** There are pure entry transitions in `lib/thumbnailCache.ts` and a `useThumbnailCaches` hook. Fixed: the loaded/failed counter could get stuck, because it was read from a lazily run updater. Progress is now derived from the cache.
10. **Channel metadata.** There are pure helpers in `lib/channelMetadata.ts`, plus `useChannelAnnotations` (notes and tags) and `useChannelRows` (the derived table).
11. **Linking.** There are pure helpers in `lib/linkingState.ts` and a `useLinkingActions` hook, and one override path replaces three copies of the same logic. Fixed: channel link aggregates were stamped with the wrong fingerprint format and showed as stale after every reload.
12. **Restore.** `lib/projectRestore.ts` holds the autosave restore and the backup unpack/restore as pure functions.
13. **DetailPanel.** Its helpers moved out (`lib/youtubeApi.ts`, `lib/detailNotes.ts`, `components/detail/*`), and the multi-selection screen is now `BatchSelectionPanel`. DetailPanel went from 1,703 to 1,014 lines.

New tests:
- e2e for back/forward, the channels view, linking, merging, and a backup export → restore in a fresh browser.
- Every e2e test now fails on an uncaught page error (`e2e/test.ts`).

Totals: 68 unit tests and 17 e2e tests.

**App.tsx: 7,256 → 4,251 lines.** Domain logic now lives in 20+ pure, tested `lib/` modules and 14 `state/` hooks.

**Perf correction:** repeated runs show exclude at 100k rows is bimodal, at about 60 ms or about 125 ms (GC and scheduling). The median is about 100 ms, right around the target; the 64 ms figure in the phase 2 table was a lucky run. The code at the end of phase 2 measures the same (97–120 ms), so phase 3 introduced no regression. At 10k rows it's about 36 ms.

14. **Toasts** (`components/toast/ToastProvider`, with wording in `lib/feedbackMessages.ts`). They cover:
   - a failed backup restore;
   - an unreadable CSV;
   - a failed reopen of the last project;
   - failed saves in the browser;
   - an exclude/restore that moved nothing or only part of the selection;
   - clicking a row without a video ID.

   Rows without a video ID also get unique grid IDs now (before, they all shared `''`).
15. **TemplateDashboard: 1,274 → 85 lines.** Split into `dashboard/template/*`.
16. **ChannelSummaryPanel: 1,172 → 745 lines.** Helpers moved to `lib/channelFieldFormatting.ts` and `lib/channelThumbnails.ts` (tested), and a duplicate quote helper was removed.
17. **Lint: 48 → 8 warnings.**
   - Dead code removed.
   - Fixed unstable empty defaults. A fresh `[]` made seven memos recompute on every render in the channels view.
   - 14 missing `useCallback`/`useMemo` dependencies added.
18. **Startup.** The UI no longer waits for DuckDB-WASM to load; only CSV parsing does. Reopening a 10k-row project now takes 0.4 s instead of 4.2 s. At 100k it's about 3 s, bound by reading the rows back from IndexedDB.

19. **ChannelSummaryPanel: 727 → 556 lines.** The batch view is now `components/channel/ChannelBatchPanel.tsx`. The unreachable batch branches in the single-channel view are gone.
20. **Lint is clean** (0 warnings), and `exhaustive-deps` and `no-unused-vars` are now errors, so CI keeps it that way. The last fixes found two real stale-value bugs:
    - the grid's channel-name button called a handler captured when the columns were last built;
    - the import dialog's merge preview ignored a switch to a channel-metadata import.

21. **YouTube player → `components/detail/useYouTubePlayer.ts`.** The hook covers the player lifecycle, its state and duration, and watch-session tracking. The "counts as watched" rule is now a pure, tested `qualifiesAsWatched`. DetailPanel went from 1,014 to 836 lines. Checked by hand in the browser: the embed loads, play and pause are tracked, a 5.7 s session is recorded with the correct duration, and switching videos rebuilds the player.

Tests: 79 unit and 22 e2e. Lint: 0 problems, with hook dependencies and unused code enforced as errors.

Still open:
- **The 1M-row safety valve:** keep long text out of the grid rows. Not needed for the 100k target.
- **Push the three branches and open the PRs** (needs a GitHub login on this Mac).

## 1. Verdict: refactor step by step; slim the in-memory pipeline instead of rebuilding the data layer

- **UI and domain logic → refactor step by step.** `src/lib/` (linking, dashboards, archive and manifest, timestamp notes, selection) is mostly pure and worth keeping. The mess sits in the app shell: `App.tsx` and a few oversized components.
- **Data layer → keep rows in memory, but make the pipeline efficient.** At 100k rows × ~35 columns, keeping the data in JS is fine (roughly 100–300 MB) and gives the snappiest UI: synchronous, no scroll flicker, AG Grid's client-side model with full sort and filter. The problem today isn't the approach, it's the waste. Rows are copied about 6 times through a chain of `useMemo`s, and every exclusion recomputes the whole chain, including text inference over every row. Fixing that is a refactor, not a rebuild. **Confirmed by phase 2:** with in-memory rows, exclude and undo now run in 40–64 ms up to 100k rows, so a DuckDB-backed engine isn't needed for the 100k target.
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
