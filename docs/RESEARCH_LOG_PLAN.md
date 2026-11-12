# Research log redesign

Planned with the project owner on 2026-11-12, in three rounds of questions. Built the same day (see item 30 in [REFACTOR_PLAN.md](REFACTOR_PLAN.md)).

## Goal

One place that is both a methods record (what was done to the data, reproducibly) and a working journal (the researcher's thinking), with no fluff, no jargon and no repetition.

## Structure: three tabs

1. **Project**
   - Research question and notes: one editable text that replaces "Overview".
   - Watch summary:
     - Per video, show the title and channel only (no video IDs). Show "watched" as unique playback time: each part of the video counts once, however often it is replayed. Do not count the time until playback was stopped.
     - One absolute total watch time.
2. **Timeline**: one chronological feed, grouped by day, with times.
   - A quick note box at the top: Enter adds a timestamped entry, Shift+Enter adds a new line. Entries can be edited and deleted, and Markdown is allowed.
   - Recorded actions, as one plain sentence each, expandable to the exact filter and the affected video titles (click to open):
     - imports and merges;
     - exclusions and restores;
     - saved views and filters;
     - analysis runs and settings: dashboards, link summaries, bucket overrides, hidden terms, deleted or remapped columns.
   - Notes can be attached to any recorded action ("why I excluded these"), shown inline and in the export. This replaces the per-section "researcher comment" boxes.
   - Filters: All · My notes · Data changes · Views · Analysis.
   - **Net effect:**
     - Fully undone actions disappear (exclude 5, then restore those 5 = nothing).
     - Partly undone ones show the net (exclude 12, restore 3 = "excluded 9").
     - Repeated changes to the same thing collapse to the final state.
     - A "show all steps" toggle reveals the raw steps in the timeline. The export is always netted.
   - Watching does not appear in the timeline.
3. **Export**: Markdown (.md) download and copy to clipboard. It contains:
   - research question and notes;
   - the net timeline, with attached notes;
   - a final corpus summary: videos included and excluded, sources, saved views with their filters, analysis settings;
   - the dashboard write-up for each generated scope;
   - an appendix by video: title, channel and link, with that video's notes, timestamps and quotes.

## Removed

- **Old tabs:** the nine-tab layout and the separate Diary, Corpus & Processing, Saved Views, Watch History, Research Actions, Notes Appendix, Dashboard and Export Preview tabs.
- **Repetition:** imports listed twice, the full dashboard dump in the log, and an export preview that repeated everything.
- **Jargon:** "durable deleted columns", "registered sources" and similar.

## Build notes

- **Watch coverage:**
  - `useYouTubePlayer` already knows each segment's start and end in the video (`segmentStartedPlayerSeconds` to the current time). Record those as intervals per video, and store merged intervals in `WatchHistoryEntry`. Unique time is then the length of their union.
  - Keep the old `totalWatchSeconds` as the absolute total.
  - Fix the bug where 7 s were watched but 0 sessions were counted.
- **Netting:** a pure, tested `netResearchHistory(events)`.
  - Exclude and restore events carry `affectedIds`, so per-video sets cancel out.
  - View create, update and delete events collapse by view ID.
  - Override changes collapse by domain.
- **Migration:** convert the old diary (`projectNotes` with date headings) into timeline note entries, and the old section comments into notes on a pinned entry.
- **Missing records:** add event types not yet recorded, such as saved-view updates, hidden-term changes and dashboard generation per scope. Replace the `as any` event types in `useLinkingActions`.
