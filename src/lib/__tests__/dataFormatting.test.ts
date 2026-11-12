import { describe, expect, test } from 'vitest';
import type { ColumnSchema } from '../../types';
import {
  cleanupAutoSeededResearchDiary,
  createProjectManifest,
  deleteColumnFromProject,
  ensureResearchDiaryDateSection,
  findManagedSectionEntryPosition,
  formatDateDisplay,
  formatDurationDisplay,
  formatTimestampLabel,
  isDateLikeColumn,
  isDurationColumn,
  parseDurationToSeconds,
  sanitizeFileName,
  syncManagedNotes,
} from '../data';

const shortDate = (date: Date) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);

describe('parseDurationToSeconds', () => {
  test('accepts plain numbers and numeric strings', () => {
    expect(parseDurationToSeconds(90)).toBe(90);
    expect(parseDurationToSeconds(90.6)).toBe(91);
    expect(parseDurationToSeconds('125')).toBe(125);
    expect(parseDurationToSeconds('12.4')).toBe(12);
  });

  test('parses ISO 8601 durations', () => {
    expect(parseDurationToSeconds('PT1H2M3S')).toBe(3723);
    expect(parseDurationToSeconds('PT4M')).toBe(240);
    expect(parseDurationToSeconds('pt30s')).toBe(30);
  });

  test('parses clock notation', () => {
    expect(parseDurationToSeconds('3:05')).toBe(185);
    expect(parseDurationToSeconds('1:02:03')).toBe(3723);
  });

  test('parses verbose durations', () => {
    expect(parseDurationToSeconds('1h 30m')).toBe(5400);
    expect(parseDurationToSeconds('2 hours 5 minutes 10 seconds')).toBe(7510);
    expect(parseDurationToSeconds('45s')).toBe(45);
  });

  test('rejects empty, negative and unparseable values', () => {
    expect(parseDurationToSeconds(null)).toBeNull();
    expect(parseDurationToSeconds('')).toBeNull();
    expect(parseDurationToSeconds('   ')).toBeNull();
    expect(parseDurationToSeconds(-5)).toBeNull();
    expect(parseDurationToSeconds('abc')).toBeNull();
    expect(parseDurationToSeconds('1:2:3:4')).toBeNull();
  });
});

describe('formatDurationDisplay', () => {
  test('formats as mm:ss or hh:mm:ss', () => {
    expect(formatDurationDisplay(65)).toBe('01:05');
    expect(formatDurationDisplay('PT1H2M3S')).toBe('01:02:03');
    expect(formatDurationDisplay(0)).toBe('00:00');
  });

  test('passes through unparseable values and blanks nullish ones', () => {
    expect(formatDurationDisplay('n/a')).toBe('n/a');
    expect(formatDurationDisplay(null)).toBe('');
    expect(formatDurationDisplay(undefined)).toBe('');
  });
});

describe('formatTimestampLabel', () => {
  test('uses minutes:seconds for short videos', () => {
    expect(formatTimestampLabel(75)).toBe('[01:15]');
    expect(formatTimestampLabel(75.9)).toBe('[01:15]');
  });

  test('uses hours when the time or the video duration reaches an hour', () => {
    expect(formatTimestampLabel(3725)).toBe('[01:02:05]');
    expect(formatTimestampLabel(75, 3600)).toBe('[00:01:15]');
  });

  test('clamps negative seconds to zero', () => {
    expect(formatTimestampLabel(-10)).toBe('[00:00]');
  });
});

describe('isDurationColumn / isDateLikeColumn', () => {
  test('recognises duration column names', () => {
    expect(isDurationColumn('duration')).toBe(true);
    expect(isDurationColumn('durationSec')).toBe(true);
    expect(isDurationColumn('Video_Duration_ISO')).toBe(true);
    expect(isDurationColumn('views')).toBe(false);
  });

  test('recognises date-like columns by name or type', () => {
    expect(isDateLikeColumn('publishedAt')).toBe(true);
    expect(isDateLikeColumn('upload_date')).toBe(true);
    expect(isDateLikeColumn('created_at')).toBe(true);
    expect(isDateLikeColumn('event_timestamp')).toBe(true);
    expect(isDateLikeColumn('anything', 'TIMESTAMP')).toBe(true);
    expect(isDateLikeColumn('views', 'BIGINT')).toBe(false);
  });
});

describe('formatDateDisplay', () => {
  test('formats ISO strings and unix timestamps (seconds or ms) the same way', () => {
    const expected = shortDate(new Date('2024-03-05T12:00:00Z'));
    expect(formatDateDisplay('2024-03-05T12:00:00Z')).toBe(expected);
    expect(formatDateDisplay(Date.parse('2024-03-05T12:00:00Z') / 1000)).toBe(expected);
    expect(formatDateDisplay(Date.parse('2024-03-05T12:00:00Z'))).toBe(expected);
    expect(formatDateDisplay(String(Date.parse('2024-03-05T12:00:00Z') / 1000))).toBe(expected);
  });

  test('returns empty for blanks and the raw text for invalid dates', () => {
    expect(formatDateDisplay('')).toBe('');
    expect(formatDateDisplay(null)).toBe('');
    expect(formatDateDisplay('not a date')).toBe('not a date');
    expect(formatDateDisplay({})).toBe('[object Object]');
  });
});

describe('sanitizeFileName', () => {
  test('drops the extension and replaces unsafe characters', () => {
    expect(sanitizeFileName('My Videos (2024).csv')).toBe('My_Videos_2024');
    expect(sanitizeFileName('keep-this_name.json')).toBe('keep-this_name');
  });

  test('uses the fallback for empty or fully unsafe names', () => {
    expect(sanitizeFileName(null)).toBe('project');
    expect(sanitizeFileName('', 'ytde')).toBe('ytde');
    expect(sanitizeFileName('***.csv', 'fallback')).toBe('fallback');
  });
});

describe('managed notes', () => {
  const quotes = [
    { id: 'q2', text: 'second "quoted"', startIndex: 20, endIndex: 30, createdAt: 2 },
    { id: 'q1', text: 'first', startIndex: 5, endIndex: 10, createdAt: 1 },
  ] as any[];
  const timestamps = [
    { id: 't2', seconds: 90, label: '[01:30] later', createdAt: 2 },
    { id: 't1', seconds: 10, label: '[00:10] early', createdAt: 1 },
  ] as any[];

  test('syncManagedNotes appends sorted quote and timestamp sections after plain notes', () => {
    expect(syncManagedNotes('My notes', quotes, timestamps)).toBe([
      'My notes',
      '',
      '## Transcript Quotes',
      '- "first"',
      '- "second \\"quoted\\""',
      '',
      '## Timestamps',
      '- [00:10] early',
      '- [01:30] later',
    ].join('\n'));
  });

  test('syncManagedNotes replaces previously generated sections instead of duplicating them', () => {
    const once = syncManagedNotes('My notes', quotes, timestamps);
    expect(syncManagedNotes(once, quotes, timestamps)).toBe(once);
    expect(syncManagedNotes(once, [], [])).toBe('My notes');
  });

  test('findManagedSectionEntryPosition locates an entry line by index', () => {
    const notes = syncManagedNotes('Intro', quotes, timestamps);
    const position = findManagedSectionEntryPosition(notes, 'Timestamps', 1);
    expect(position).not.toBeNull();
    expect(notes.slice(position!.lineStart, position!.lineEnd)).toBe('- [01:30] later');
    expect(position!.cursorStart).toBe(position!.lineEnd);
    expect(findManagedSectionEntryPosition(notes, 'Timestamps', 5)).toBeNull();
    expect(findManagedSectionEntryPosition(notes, 'Timestamps', -1)).toBeNull();
  });
});

describe('research diary helpers', () => {
  const date = new Date(2026, 9, 24);

  test('seeds an empty diary with a dated heading', () => {
    expect(ensureResearchDiaryDateSection('', date)).toEqual({
      notes: '## October 24, 2026\n',
      inserted: true,
      cursorPosition: '## October 24, 2026\n'.length,
    });
  });

  test('appends a heading once and does not insert it twice', () => {
    const first = ensureResearchDiaryDateSection('Earlier entry', date);
    expect(first.notes).toBe('Earlier entry\n\n## October 24, 2026\n');
    const second = ensureResearchDiaryDateSection(first.notes, date);
    expect(second.inserted).toBe(false);
    expect(second.notes).toBe(first.notes);
  });

  test('cleanupAutoSeededResearchDiary removes a lone auto-seeded heading only', () => {
    expect(cleanupAutoSeededResearchDiary('## October 24, 2026\n')).toBe('');
    expect(cleanupAutoSeededResearchDiary('## October 24, 2026\nwrote something')).toBe('## October 24, 2026\nwrote something');
    expect(cleanupAutoSeededResearchDiary('   ')).toBe('');
  });
});

describe('deleteColumnFromProject', () => {
  test('removes the column from visible columns, saved views and special mappings', () => {
    const result = deleteColumnFromProject({
      deletedColumns: [],
      column: 'views',
      visibleColumns: ['title', 'views'],
      savedViews: [{ id: 'v', name: 'V', createdAt: 0, columnState: [{ colId: 'views' }, { colId: 'title' }], filterModel: { views: {}, title: {} } }],
      specialMappings: { transcriptColumn: 'views', tagColumn: 'tags' },
    });
    expect(result.nextDeletedColumns).toEqual(['views']);
    expect(result.nextVisibleColumns).toEqual(['title']);
    expect(result.nextSavedViews[0].columnState).toEqual([{ colId: 'title' }]);
    expect(result.nextSavedViews[0].filterModel).toEqual({ title: {} });
    expect(result.nextSpecialMappings).toEqual({ transcriptColumn: undefined, tagColumn: 'tags' });
  });

  test('does not record an already deleted column twice', () => {
    const result = deleteColumnFromProject({ deletedColumns: ['x'], column: 'x', visibleColumns: [], savedViews: [] });
    expect(result.nextDeletedColumns).toEqual(['x']);
  });
});

describe('createProjectManifest', () => {
  const schema: ColumnSchema[] = [{ column_name: 'videoId', column_type: 'VARCHAR' }, { column_name: 'transcript', column_type: 'VARCHAR' }];
  const base = {
    fileName: 'My Data.csv',
    projectName: '',
    schema,
    visibleColumns: ['videoId'],
    savedViews: [],
    activeViewId: null,
    annotations: {},
    projectNotes: 'notes',
    theme: 'dark' as const,
    isRightPanelCollapsed: true,
  };

  test('builds a version 10 manifest with defaults for optional fields', () => {
    const manifest = createProjectManifest(base);
    expect(manifest.version).toBe(10);
    expect(manifest.projectName).toBe('My_Data');
    expect(manifest.originalFileName).toBe('My Data.csv');
    expect(manifest.sourceSchema).toBe(schema);
    expect(manifest.transcriptColumn).toBe('transcript');
    expect(manifest.excluded_videos).toEqual([]);
    expect(manifest.deletedColumns).toEqual([]);
    expect(manifest.viewScope).toBe('videos');
    expect(manifest.savedViewsVersion).toBe(0);
    expect(manifest.channelMetadataSnapshot).toBeNull();
    expect(manifest.importedChannelMetadata).toBeNull();
    expect(manifest.uiState).toEqual({ theme: 'dark', isRightPanelCollapsed: true });
    expect(Number.isNaN(Date.parse(manifest.exportedAt))).toBe(false);
  });

  test('keeps an explicit project name and passes through provided state', () => {
    const manifest = createProjectManifest({
      ...base,
      projectName: 'Study',
      schema: [{ column_name: 'videoId', column_type: 'VARCHAR' }],
      excludedVideoIds: ['a'],
      viewScope: 'channels',
      savedViewsVersion: 3,
    });
    expect(manifest.projectName).toBe('Study');
    expect(manifest.transcriptColumn).toBeUndefined();
    expect(manifest.excluded_videos).toEqual(['a']);
    expect(manifest.viewScope).toBe('channels');
    expect(manifest.savedViewsVersion).toBe(3);
  });

  test('falls back to a default project name without a file name', () => {
    expect(createProjectManifest({ ...base, fileName: null }).projectName).toBe('ytde_project');
  });
});
