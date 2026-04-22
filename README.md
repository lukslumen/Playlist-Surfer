# Playlist Surfer

Playlist Surfer is a React/TS research tool for analyzing CSV-based video and channel datasets. Built for the "Amsterdam school" of digital methods, it bridges the gap between distant and close reading through a workflow of repurposed platform traces and human interpretation.

## What you can do

- Import video and channel list CSV files, ideally from [Youtube Data Tools](https://ytdt.digitalmethods.net/)
- Merge with metadata from your own analysis' CSV files, for example generated with [4CAT](https://4cat.digitalmethods.net/create-dataset/)
- Filter, sort, and compare rows quickly
- Switch between video view and channel view
- Open dashboards for overview, content, attention, linking, and thumbnails
- Add notes, tags, and quotes while reviewing data
- Review links, domains, and channel metadata
- Save your work and export the project as a zip archive

## Quick start

1. Start the app and import your main video CSV.
2. Add channel metadata if you have it.
3. Use the table filters to narrow the dataset.
4. Switch between **Videos** and **Channels** to inspect the data from different angles.
5. Open the dashboards to get a quick visual overview.
6. Add notes, tags, and exclusions as you review.
7. Export the project when you want to save or share your analysis.

## Typical workflow

A common workflow looks like this:

- import a dataset
- scan the overview dashboards
- filter to a subset of interest
- inspect videos or channels in detail
- add notes and tags
- export the project for later reuse

## An antidote to trust me bro metrics

Misleading impressions from statistical summaries persist longer when they are frictionful to check. Have you ever looked up a faraway country's social structure or climate table (GDP per capita, median age, days with precipitation, and so on) only to be surprised that the feel of the particular place you went to, that little beach town, did not match how you imagined a country with those demographics and climate metrics would look or feel? It is like the contrast between Humboldt and Gauß in Daniel Kehlmann’s (2006) Measuring the World: one ventures out to see it up close, while the other calculates away in his office. Both have a valid perspective, but they see different things, and neither acquires an intuition for the "translations" (Latour 2005) that happen when moving from generating summary statistics to taking a close-up look and back again.

Digital methods research can have a whiff of a similar detachment from the real world, like an armchair anthropologist who only reads summaries instead of developing a feel for the context. Admittedly, how could you get a feel for the data if you first need to merge a couple of CSVs in a Colab notebook, filter through various columns to create your subset, and then start copy-pasting individual video IDs into the second half of YouTube URLs just to see the actual content? Who could blame you for keeping that checking to a minimum? Still, this is problematic for two reasons. First, it slows creative iteration and deep exploration of your data, delaying your understanding of it. Second, it facilitates “trust me bro metrics,” for example when nobody ever checks what a subset of videos labeled by an LLM as “masculinity_themes_present,” or a category created by link extraction such as “commercial_hub,” actually looks like at the content level. So how do we nudge our research community to adopt better practices for familiarizing themselves with data and metrics?

How about surfing? Platforms like YouTube entice us to surf and get lost in the flow of content, and their design does a pretty good job of recommending the next dopamine hit. At the same time, however, it discourages reflection and conscious choice about what to watch next, since a large proportion of YouTube content is suggested or automatically delivered through recommendation systems, and visibility on the platform is shaped by recommendation and ranking mechanisms (Matamoros-Fernández et al. 2021; Rieder, Matamoros-Fernández, and Coromina 2018). As researchers, we do not want to follow the platform’s flow blindly but to query it systematically (Rogers 2017). But there is no reason why systematic searching should have to break up the flow with many small, unnecessary clicks. This is especially true when moving from Colab to spreadsheet to video platform (with ads in between!) is so painful that it stops being fun. The problem gets worse when you introduce LLM annotation and begin to dread checking the data because the vibe tells you, “trust me bro.” What if, instead, you were excited to get a machine-filtered playlist based on the annotations so you could check what a particular feature looks like in practice? What if, instead of counting labels and visualizing their share, creating playlists as filtered subsets of the sample became the starting point for an exciting close reading; and curating the perfect playlist for others to understand became a valid research goal?

Enter Playlist Surfer, a lightweight browser application for inspecting CSV-based video and channel datasets from YouTube Data Tools (Rieder 2015), filtering them, and assembling collections for digital methods research. It is intended to nudge researchers to move between quantitative distant reading and qualitative close reading: you can filter, sort, annotate, inspect thumbnails and transcripts, jump from aggregate views into subsets, and export the full project state as a reproducible archive containing both machine-generated structure and human interpretation. Conceptually, it is closer to the Amsterdam school of digital methods and to quali-quantitative approaches than to a generic dashboard app: platform-native traces are repurposed for analysis (Rogers 2013), while notes, saved views, and project exports keep the interpretive and procedural chain inspectable (Venturini and Latour 2010).

### Upcoming

And the best part, for you the reader, is that you can watch our playlists. You can download a ZIP of our full project, get a feel for the data, audit our analysis, build on it further, or repurpose the research tool for your own purposes; and perhaps even find the side hustle that suits you best ;)

### References

*Kehlmann, Daniel. 2006. Measuring the World: A Novel. Translated by Carol Brown Janeway. New York: Pantheon Books.*

*Latour, Bruno. 2005. Reassembling the Social: An Introduction to Actor-Network-Theory. Oxford: Oxford University Press.*

*Matamoros-Fernández, Ariadna, Joanne E. Gray, Louisa Bartolo, Jean Burgess, and Nicolas Suzor. 2021. “What’s ‘Up Next’? Investigating Algorithmic Recommendations on YouTube Across Issues and Over Time.” Media and Communication 9 (4): 234–249.*

*Rieder, Bernhard. 2015. YouTube Data Tools [Software]. Available from ytdt.digitalmethods.net.*

*Rieder, Bernhard, Ariadna Matamoros-Fernández, and Òscar Coromina. 2018. “From Ranking Algorithms to ‘Ranking Cultures’: Investigating the Modulation of Visibility in YouTube Search Results.” Convergence 24 (1): 50–68.*

*Rogers, Richard. 2013. Digital Methods. Cambridge, MA: MIT Press.*

*Rogers, Richard. 2017. “Foundations of Digital Methods: Query Design.” In The Datafied Society: Studying Culture through Data, edited by Mirko Tobias Schäfer and Karin van Es, 75–94. Amsterdam: Amsterdam University Press.*

*Venturini, Tommaso, and Bruno Latour. 2010. “The Social Fabric: Digital Traces and Quali-quantitative Methods.” In Proceedings of Future En Seine 2009, 87–101. Paris: Editions Future en Seine.*

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
