import { describe, expect, test } from 'vitest';
import {
  bar,
  box,
  center,
  compactNumber,
  compactPercent,
  ellipsis,
  padLeft,
  padRight,
  renderDashboardDocument,
  spark,
  truncateLabel,
} from '../dashboardDocument';
import { buildDatasetDashboardStats } from '../datasetDashboard';
import type { DashboardTabId, DatasetDashboardSnapshot } from '../../types';

const TABS: DashboardTabId[] = ['overview', 'temporal', 'inequality', 'content', 'locale', 'reliability'];

function rows() {
  return [
    { videoId: 'v1', videoTitle: 'Guitar basics', channelTitle: 'Alpha', viewCount: 9000, commentCount: 90, publishedAt: '2024-01-01T00:00:00Z', videoCategoryLabel: 'Music', defaultLanguage: 'en' },
    { videoId: 'v2', videoTitle: 'Piano basics', channelTitle: 'Beta', viewCount: 500, commentCount: 5, publishedAt: '2024-06-01T00:00:00Z', videoCategoryLabel: 'Music', defaultLanguage: 'en' },
    { videoId: 'v3', videoTitle: 'Drum basics', channelTitle: 'Gamma', viewCount: 300, commentCount: 3, publishedAt: '2025-01-01T00:00:00Z', videoCategoryLabel: 'Science & Technology', defaultLanguage: 'de' },
    { videoId: 'v4', videoTitle: 'Bass basics', channelTitle: 'Alpha', viewCount: 200, commentCount: 2, publishedAt: '2025-06-01T00:00:00Z', videoCategoryLabel: 'Education', defaultLanguage: 'en' },
  ];
}

function snapshotFor(data: any[], scope: 'full' | 'filtered' = 'full'): DatasetDashboardSnapshot {
  return {
    scope,
    stats: buildDatasetDashboardStats(data),
    rowCount: data.length,
    calculatedAt: '2026-01-01T00:00:00.000Z',
    datasetVersionAtCalculation: 1,
  };
}

describe('compactNumber', () => {
  test('renders a dash for missing or NaN values', () => {
    expect(compactNumber(null)).toBe('—');
    expect(compactNumber(undefined)).toBe('—');
    expect(compactNumber(Number.NaN)).toBe('—');
  });

  test('keeps small numbers as rounded integers', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(999)).toBe('999');
    expect(compactNumber(12.4)).toBe('12');
  });

  test('abbreviates thousands, millions and billions with adaptive precision', () => {
    expect(compactNumber(1500)).toBe('1.5K');
    expect(compactNumber(15_000)).toBe('15K');
    expect(compactNumber(2_500_000)).toBe('2.5M');
    expect(compactNumber(25_000_000)).toBe('25M');
    expect(compactNumber(1_200_000_000)).toBe('1.2B');
    expect(compactNumber(15_000_000_000)).toBe('15B');
    expect(compactNumber(-2500)).toBe('-2.5K');
  });
});

describe('compactPercent', () => {
  test('formats shares as whole percentages and marks tiny shares', () => {
    expect(compactPercent(null)).toBe('—');
    expect(compactPercent(0)).toBe('0%');
    expect(compactPercent(0.004)).toBe('<1%');
    expect(compactPercent(0.456)).toBe('46%');
    expect(compactPercent(1)).toBe('100%');
  });
});

describe('label helpers', () => {
  test('ellipsis abbreviates known category labels before truncating', () => {
    expect(ellipsis('Science & Technology', 30)).toBe('Science + Tech');
    expect(ellipsis('abcdef', 3)).toBe('ab…');
    expect(ellipsis('abcdef', 1)).toBe('…');
    expect(ellipsis('abcdef', 0)).toBe('');
    expect(truncateLabel('short', 10)).toBe('short');
  });

  test('padRight and padLeft produce fixed-width cells', () => {
    expect(padRight('ab', 4)).toBe('ab  ');
    expect(padRight('abcdef', 4)).toBe('abc…');
    expect(padLeft(42, 5)).toBe('   42');
    expect(padLeft('abcdef', 3)).toBe('def');
  });

  test('center places text in the middle, favouring the right for odd padding', () => {
    expect(center('ab', 6)).toBe('  ab  ');
    expect(center('abc', 6)).toBe(' abc  ');
    expect(center('abcdefgh', 4)).toBe('abc…');
  });
});

describe('bar', () => {
  test('fills proportionally to value / max', () => {
    expect(bar(0.5, 1, 8)).toBe('▓▓▓▓░░░░');
    expect(bar(0, 1, 4)).toBe('░░░░');
    expect(bar(3, 4, 4)).toBe('▓▓▓░');
  });

  test('clamps out-of-range values', () => {
    expect(bar(2, 1, 4)).toBe('▓▓▓▓');
    expect(bar(-1, 1, 4)).toBe('░░░░');
  });

  test('renders blanks for missing values or a non-positive max', () => {
    expect(bar(null)).toBe(' '.repeat(8));
    expect(bar(Number.NaN, 1, 3)).toBe('   ');
    expect(bar(1, 0, 4)).toBe('    ');
  });
});

describe('spark', () => {
  test('renders blanks for empty input', () => {
    expect(spark([], 5)).toBe('     ');
  });

  test('scales values to block characters relative to the largest bin', () => {
    expect(spark([1, 2, 3, 4], 4)).toBe('▃▅▆█');
  });

  test('renders the lowest block for all-zero series', () => {
    expect(spark([0, 0], 4)).toBe('▁▁▁▁');
  });

  test('aggregates more values than width into the requested number of bins', () => {
    const result = spark(Array.from({ length: 100 }, () => 1), 10);
    expect(result).toHaveLength(10);
    expect(result).toBe('█'.repeat(10));
  });
});

describe('box', () => {
  test('pads the body to the requested height and width', () => {
    const result = box({ title: 'Test', lines: ['hello'], width: 20, bodyHeight: 3 });
    const lines = result.text.split('\n');
    expect(result.height).toBe(5);
    expect(lines).toHaveLength(5);
    expect(lines[0].startsWith('╭─ TEST ')).toBe(true);
    expect(lines[1]).toBe(`│ ${'hello'.padEnd(16)} │`);
    expect(lines[2]).toBe(`│ ${' '.repeat(16)} │`);
    expect(lines[4]).toBe(`╰${'─'.repeat(18)}╯`);
  });

  test('truncates overflowing body lines and long line content', () => {
    const result = box({ title: 'T', lines: ['a', 'b', 'c', 'x'.repeat(50)], width: 12, bodyHeight: 2 });
    const lines = result.text.split('\n');
    expect(lines).toHaveLength(4);
    expect(result.text).not.toContain('c');
  });

  test('registers panel and section hotspots with help text', () => {
    const result = box({ title: 'Overview', lines: [], action: 'overview', helpId: 'overview.overview', width: 30, bodyHeight: 2 });
    const panel = result.hotspots.find((hotspot) => hotspot.kind === 'panel');
    const section = result.hotspots.find((hotspot) => hotspot.kind === 'section');
    expect(panel).toMatchObject({ id: 'panel-overview.overview', line: 0, lineEnd: 4, colStart: 0, colEnd: 30, helpTitle: 'Overview' });
    expect(panel?.helpBody).toContain('Dataset footprint');
    expect(section).toMatchObject({ id: 'section-overview', action: 'overview', colStart: 3, colEnd: 11 });
  });

  test('falls back to the panel title when the help id is unknown', () => {
    const result = box({ title: 'Mystery', lines: [], helpId: 'nope.nope' });
    expect(result.hotspots[0].helpTitle).toBe('Mystery');
    expect(result.hotspots[0].helpBody).toBeUndefined();
  });

  test('omits hotspots without help id or action', () => {
    expect(box({ title: 'Plain', lines: [] }).hotspots).toEqual([]);
  });
});

describe('renderDashboardDocument without a snapshot', () => {
  test('renders the intro document with a not-calculated scope line', () => {
    const result = renderDashboardDocument(undefined, 'overview');
    const lines = result.text.split('\n');
    expect(lines[0]).toBe('Dataset Dashboard');
    expect(lines[1]).toBe('scope: not calculated yet');
    expect(lines[2]).toContain('[Overview]');
    expect(result.text).toContain('│ No dashboard snapshot calculated ye… │');
    expect(result.height).toBe(lines.length);
  });

  test('marks the requested preset as active', () => {
    const result = renderDashboardDocument(undefined, 'locale');
    expect(result.text.split('\n')[2]).toContain('[Locale]');
    expect(result.text.split('\n')[2]).not.toContain('[Overview]');
  });

  test('exposes clickable preset hotspots on the preset line and section hotspots for each panel', () => {
    const result = renderDashboardDocument(undefined, 'overview');
    const presets = result.hotspots.filter((hotspot) => hotspot.kind === 'preset');
    expect(presets.map((hotspot) => hotspot.action)).toEqual(TABS);
    expect(presets.every((hotspot) => hotspot.line === 2)).toBe(true);
    const presetLine = result.text.split('\n')[2];
    expect(presetLine.slice(presets[0].colStart, presets[0].colEnd)).toBe('[Overview]');
    expect(presetLine.slice(presets[1].colStart, presets[1].colEnd)).toBe('Temporal');
    const sections = result.hotspots.filter((hotspot) => hotspot.kind === 'section');
    expect(sections.map((hotspot) => hotspot.action).sort()).toEqual([...TABS].sort());
    expect(sections.every((hotspot) => hotspot.line >= 4)).toBe(true);
  });
});

describe('renderDashboardDocument with a snapshot', () => {
  test('renders every tab for an empty dataset without NaN, undefined or Infinity', () => {
    const snapshot = snapshotFor([]);
    TABS.forEach((tab) => {
      const result = renderDashboardDocument(snapshot, tab);
      expect(result.text).not.toMatch(/NaN|undefined|Infinity/);
      expect(result.height).toBe(result.text.split('\n').length);
    });
  });

  test('renders every tab for a populated dataset without NaN, undefined or Infinity', () => {
    const snapshot = snapshotFor(rows());
    TABS.forEach((tab) => {
      const result = renderDashboardDocument(snapshot, tab);
      expect(result.text).not.toMatch(/NaN|undefined|Infinity/);
      expect(result.text.split('\n')[2]).toContain(`[${tab[0].toUpperCase()}${tab.slice(1)}]`);
    });
  });

  test('shows the overview footprint numbers and dominant category', () => {
    const text = renderDashboardDocument(snapshotFor(rows()), 'overview').text;
    expect(text).toMatch(/videos\s+4 /);
    expect(text).toMatch(/channels\s+3 /);
    expect(text).toMatch(/comments\s+100 /);
    expect(text).toMatch(/categories\s+3 /);
    expect(text).toMatch(/languages\s+2 /);
    expect(text).toContain('dominant  50%  Music');
    expect(text).toContain('rows: 4');
    expect(text).toContain('attention is highly skewed');
  });

  test('labels the scope as filtered for filtered snapshots', () => {
    const lines = renderDashboardDocument(snapshotFor(rows(), 'filtered'), 'overview').text.split('\n');
    expect(lines[1].startsWith('scope: filtered')).toBe(true);
  });

  test('renders the panels of each specialised tab', () => {
    const snapshot = snapshotFor(rows());
    expect(renderDashboardDocument(snapshot, 'temporal').text).toContain('RECENCY BUCKETS');
    expect(renderDashboardDocument(snapshot, 'inequality').text).toContain('PERCENTILE LADDER');
    expect(renderDashboardDocument(snapshot, 'inequality').text).toContain('INEQUALITY METRICS');
    expect(renderDashboardDocument(snapshot, 'content').text).toContain('TOP CATEGORIES');
    expect(renderDashboardDocument(snapshot, 'locale').text).toContain('TOP LANGUAGES');
    expect(renderDashboardDocument(snapshot, 'reliability').text).toContain('MISSINGNESS PROFILE');
  });

  test('shows the Gini coefficient and HHI values in the inequality tab', () => {
    const snapshot = snapshotFor(rows());
    const text = renderDashboardDocument(snapshot, 'inequality').text;
    expect(text).toContain(snapshot.stats.attention.giniViews!.toFixed(3));
    expect(text).toContain(snapshot.stats.attention.hhiViews!.toFixed(3));
  });

  test('lists snapshot warnings in the reliability tab', () => {
    const text = renderDashboardDocument(snapshotFor(rows()), 'reliability').text;
    expect(text).toContain('warning  Dislikes unavailable');
    expect(text).toContain('rows covered  4');
  });

  test('abbreviates long category labels in content panels', () => {
    const text = renderDashboardDocument(snapshotFor(rows()), 'content').text;
    expect(text).toContain('Science + Tech');
    expect(text).not.toContain('Science & Technology');
  });

  test('falls back to the overview layout for unknown tab ids', () => {
    const snapshot = snapshotFor(rows());
    const fallback = renderDashboardDocument(snapshot, 'unknown' as DashboardTabId);
    expect(fallback.text).toBe(renderDashboardDocument(snapshot, 'overview').text);
  });
});
