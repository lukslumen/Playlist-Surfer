# Playlist Surfer

Playlist Surfer is a React + Vite + TypeScript research workspace for inspecting CSV-based video and channel datasets, especially YouTube collections assembled for digital methods work. It is intended for researchers who move between quantitative distant reading and qualitative close reading: you can filter, sort, annotate, inspect thumbnails and transcripts, jump from aggregate views into subsets, and export the full project state as a reproducible archive with both machine-generated structure and human interpretation. Conceptually, it is closer to the Amsterdam school of digital methods and to quali-quantitative approaches than to a generic dashboard app: platform-native traces are repurposed for analysis, while notes, saved views, and project exports keep the interpretive and procedural chain inspectable.

## Features

- CSV import for video datasets, channel metadata, and merge/enrichment workflows
- Automatic schema detection for common YouTube Data Tools exports, with friendly display names layered over raw source fields
- Spreadsheet-style exploration with AG Grid, column visibility controls, sort/filter state, saved views, and resettable defaults
- Include/exclude workflows for curating subsets without destroying the source dataset
- Video and channel views with linked navigation between rows, detail panels, and dashboards
- Notes, tags, transcript quotes, description quotes, and channel-level annotations for close reading alongside quantitative analysis
- Linking analysis that extracts and classifies URLs/domains from source columns, supports domain overrides, and produces ecology-focused summaries
- Overview, attention, content, linking, and thumbnail dashboards that can switch between whole-dataset and filtered scopes
- Thumbnail loading, zooming, and browsing for both filtered subsets and whole-dataset views
- Channel metadata aggregation, channel age timelines, and channel-level batch actions
- Research log and project history tracking so analytic steps, comments, and exports remain auditable
- Project export/import as a zip archive for reproducibility, sharing, and later restoration

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+

### Install dependencies

```bash
npm install
```

### Run the development server

```bash
npm run dev
```

The Vite dev server starts on port `3000` by default.

## Tech Stack

- React 19
- TypeScript
- Vite
- AG Grid
- DuckDB WASM
- Motion
- Lucide React
- Tailwind CSS via `@tailwindcss/vite`
