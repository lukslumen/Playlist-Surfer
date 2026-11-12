import { describe, expect, test } from 'vitest';
import type { ResearchHistoryEvent } from '../../types';
import { buildResearchLogExport, type ResearchLogExportInput } from '../researchLogExport';
import { netTimeline } from '../researchLogTimeline';

const events: ResearchHistoryEvent[] = [
  { id: 'a', type: 'videos_excluded', createdAt: '2026-11-12T09:00:00.000Z', summary: '', affectedIds: ['v1', 'v2'], meta: { selectionMode: 'filtered_bulk', filterSummary: 'views under 100' }, note: 'Too little reach to matter.' },
  { id: 'b', type: 'videos_restored', createdAt: '2026-11-12T09:05:00.000Z', summary: '', affectedIds: ['v2'] },
  { id: 'c', type: 'videos_excluded', createdAt: '2026-11-12T09:10:00.000Z', summary: '', affectedIds: ['v3'], meta: { selectionMode: 'manual' } },
  { id: 'd', type: 'videos_restored', createdAt: '2026-11-12T09:11:00.000Z', summary: '', affectedIds: ['v3'] },
  { id: 'e', type: 'note', createdAt: '2026-11-12T10:00:00.000Z', summary: 'Channels cluster around two topics.', note: 'Channels cluster around two topics.' },
];

function input(overrides: Partial<ResearchLogExportInput> = {}): ResearchLogExportInput {
  return {
    projectName: 'Climate Shorts',
    overview: 'How do climate Shorts frame activism?',
    entries: netTimeline(events),
    describeVideo: (id) => ({ title: `Video ${id}`, channel: 'Some channel', url: `https://www.youtube.com/watch?v=${id}` }),
    corpus: { included: 120, excluded: 1, sources: ['search.csv'], savedViews: [{ name: 'Activism', filterSummary: 'title contains protest', videoCount: 14 }], settings: ['Terms hidden from vernacular analysis: lol.'] },
    dashboards: [{ label: 'Whole corpus', text: 'Top channels: …', stale: true }],
    videoNotes: [{ title: 'Video v1', channel: 'Some channel', url: 'https://www.youtube.com/watch?v=v1', tags: ['protest'], notes: 'Strong framing.', timestamps: ['0:42'], quotes: ['we act now'] }],
    includeDashboards: true,
    includeVideoNotes: true,
    generatedAt: new Date('2026-11-12T12:00:00.000Z'),
    ...overrides,
  };
}

describe('buildResearchLogExport', () => {
  test('contains the net timeline with notes, the corpus and the appendix', () => {
    const markdown = buildResearchLogExport(input());
    expect(markdown).toContain('# Research log: Climate Shorts');
    expect(markdown).toContain('How do climate Shorts frame activism?');
    expect(markdown).toContain('Excluded 1 video matching: views under 100');
    expect(markdown).toContain('Videos: Video v1 (Some channel)');
    expect(markdown).toContain('*Note:* Too little reach to matter.');
    expect(markdown).toContain('✎ Channels cluster around two topics.');
    expect(markdown).not.toContain('v3');
    expect(markdown).not.toContain('Restored');
    expect(markdown).toContain('**120 videos** in the corpus, 1 excluded.');
    expect(markdown).toContain('“Activism”: title contains protest (14 videos)');
    expect(markdown).toContain('### Whole corpus (out of date');
    expect(markdown).toContain('## Appendix: notes by video');
    expect(markdown).toContain('> “we act now”');
  });

  test('leaves out optional sections and says when nothing is written', () => {
    const markdown = buildResearchLogExport(input({ overview: '', entries: [], includeDashboards: false, includeVideoNotes: false }));
    expect(markdown).toContain('_Not written yet._');
    expect(markdown).toContain('Nothing recorded yet.');
    expect(markdown).not.toContain('Dashboard write-ups');
    expect(markdown).not.toContain('Appendix');
  });
});
