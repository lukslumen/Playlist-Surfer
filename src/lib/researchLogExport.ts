import { groupByDay, type TimelineEntry } from './researchLogTimeline';

// The research log as Markdown: research question and notes, the net timeline, what the final corpus
// is, the dashboard write-ups, and the researcher's notes per video.

export interface VideoLabel {
  title: string;
  channel: string;
  url: string;
}

export interface ResearchLogExportInput {
  projectName: string;
  overview: string;
  entries: TimelineEntry[];
  describeVideo: (videoId: string) => VideoLabel | null;
  corpus: {
    included: number;
    excluded: number;
    sources: string[];
    savedViews: Array<{ name: string; filterSummary: string; videoCount: number }>;
    settings: string[];
  };
  dashboards: Array<{ label: string; text: string; stale: boolean }>;
  videoNotes: Array<VideoLabel & { tags: string[]; notes: string; timestamps: string[]; quotes: string[] }>;
  includeDashboards: boolean;
  includeVideoNotes: boolean;
  generatedAt?: Date;
}

const MAX_LISTED_VIDEOS = 10;
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const indent = (value: string, prefix = '  ') => value.split('\n').map((line) => `${prefix}${line}`).join('\n');

function timelineMarkdown(input: ResearchLogExportInput): string[] {
  if (!input.entries.length) return ['Nothing recorded yet.'];
  const lines: string[] = [];
  groupByDay(input.entries, input.generatedAt).reverse().forEach((group) => {
    lines.push(`### ${new Date(group.entries[0].createdAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`, '');
    [...group.entries].reverse().forEach((entry) => {
      if (entry.category === 'note' && entry.title === entry.note) {
        lines.push(`- **${timeOf(entry.createdAt)}** ✎ ${entry.note!.split('\n').join('\n  ')}`);
        return;
      }
      lines.push(`- **${timeOf(entry.createdAt)}** ${entry.title}`);
      entry.details.forEach((detail) => lines.push(`  - ${detail}`));
      if (entry.videoIds.length && entry.category === 'data') {
        const listed = entry.videoIds.slice(0, MAX_LISTED_VIDEOS).map((videoId) => {
          const video = input.describeVideo(videoId);
          return video ? `${video.title} (${video.channel})` : videoId;
        });
        lines.push(`  - Videos: ${listed.join('; ')}${entry.videoIds.length > MAX_LISTED_VIDEOS ? `; and ${(entry.videoIds.length - MAX_LISTED_VIDEOS).toLocaleString('en-US')} more` : ''}`);
      }
      if (entry.note) lines.push(`  - *Note:* ${entry.note.split('\n').join('\n    ')}`);
    });
    lines.push('');
  });
  return lines;
}

export function buildResearchLogExport(input: ResearchLogExportInput): string {
  const generatedAt = input.generatedAt ?? new Date();
  const lines: string[] = [
    `# Research log: ${input.projectName}`,
    '',
    `Exported ${generatedAt.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })}. Undone and superseded steps are left out; each entry shows the net effect.`,
    '',
    '## Research question and notes',
    '',
    input.overview.trim() || '_Not written yet._',
    '',
    '## Timeline',
    '',
    ...timelineMarkdown(input),
    '## Final corpus',
    '',
    `- **${input.corpus.included.toLocaleString('en-US')} videos** in the corpus, ${input.corpus.excluded.toLocaleString('en-US')} excluded.`,
    `- Sources: ${input.corpus.sources.length ? input.corpus.sources.join(', ') : 'none'}.`,
  ];
  if (input.corpus.savedViews.length) {
    lines.push('- Saved views:');
    input.corpus.savedViews.forEach((view) => lines.push(`  - “${view.name}”: ${view.filterSummary || 'no filters'} (${view.videoCount.toLocaleString('en-US')} videos)`));
  }
  input.corpus.settings.forEach((setting) => lines.push(`- ${setting}`));
  lines.push('');

  if (input.includeDashboards && input.dashboards.length) {
    lines.push('## Dashboard write-ups', '');
    input.dashboards.forEach((dashboard) => {
      lines.push(`### ${dashboard.label}${dashboard.stale ? ' (out of date: the data changed since it was generated)' : ''}`, '', '```text', dashboard.text.trim(), '```', '');
    });
  }

  if (input.includeVideoNotes && input.videoNotes.length) {
    lines.push('## Appendix: notes by video', '');
    input.videoNotes.forEach((video) => {
      lines.push(`### ${video.title}`, '', `${video.channel} · ${video.url}`, '');
      if (video.tags.length) lines.push(`Tags: ${video.tags.join(', ')}`, '');
      if (video.notes.trim()) lines.push(video.notes.trim(), '');
      if (video.timestamps.length) lines.push('Timestamps:', ...video.timestamps.map((stamp) => `- ${stamp}`), '');
      if (video.quotes.length) lines.push('Quotes:', ...video.quotes.map((quote) => indent(`“${quote}”`, '> ')), '');
    });
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
