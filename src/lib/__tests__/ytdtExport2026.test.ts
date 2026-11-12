import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildAttentionProfile } from '../attentionProfile';
import { buildDashboardTemplateSnapshot, normalizeTemplateRows, parseShortFlag } from '../dashboardTemplate';
import { applyFriendlyColumnMappings, buildChannelMetadataRows, channelFieldsFromVideoRow, detectImportKind, getColumnDisplayName } from '../data';
import { buildOverviewDrilldownFilter } from '../overviewDrilldown';
import { formatMetadataDisplay } from '../channelFieldFormatting';
import { buildFormats } from '../overviewProfile';

// YouTube Data Tools' video list export as of November 2026: the Shorts flag plus channel metadata
// columns on every video row. The fixture is synthetic, with the exact header of a real export.
const FIXTURE = path.join(__dirname, '..', '..', '..', 'e2e', 'fixtures', 'videolist-ytdt-2026.csv');

function readFixture(): Array<Record<string, any>> {
  const [headerLine, ...lines] = fs.readFileSync(FIXTURE, 'utf8').trim().split(/\r?\n/);
  const header = headerLine.split(',');
  return lines.map((line) => {
    const values: string[] = [];
    let current = '';
    let quoted = false;
    for (const char of line) {
      if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { values.push(current); current = ''; }
      else current += char;
    }
    values.push(current);
    const row: Record<string, any> = Object.fromEntries(header.map((name, index) => [name, values[index]]));
    ['viewCount', 'likeCount', 'commentCount', 'durationSec', 'channel_subscriberCount', 'channel_viewCount', 'channel_videoCount', 'channel_daysActive']
      .forEach((name) => { row[name] = row[name] === '' ? null : Number(row[name]); });
    return row;
  });
}

const rows = readFixture();
const schema = Object.keys(rows[0]).map((column_name) => ({ column_name, column_type: typeof rows[0][column_name] === 'number' ? 'BIGINT' : 'VARCHAR' }));

describe('YouTube Data Tools 2026 video export', () => {
  test('is imported as a video dataset, with readable column names', () => {
    expect(detectImportKind(schema, 'videolist_search446_2026_11_12-16_14_58.csv')).toBe('video');
    const mapped = applyFriendlyColumnMappings(schema, 'videolist_search446_2026_11_12-16_14_58.csv');
    const name = (column: string) => getColumnDisplayName(mapped.find((entry) => entry.column_name === column)!, mapped);
    expect(name('channel_subscriberCount')).toBe('Channel Subscribers');
    expect(name('isShort')).toBe('Is Short');
    expect(name('channel_publishedAt')).toBe('Channel Created');
  });

  test('channel metadata on video rows fills the generated channel table', () => {
    expect(channelFieldsFromVideoRow(rows[0])).toEqual({
      channel_created_at: '2012-06-26T11:22:13Z',
      channel_days_active: 5252,
      channel_country: 'GB',
      channel_total_views: 2499555,
      channel_subscriber_count: 27100,
      channel_video_count: 525,
    });
    const channels = buildChannelMetadataRows(rows);
    expect(channels).toHaveLength(3);
    const quickTips = channels.find((row) => row.channel_name === 'Quick Tips') as Record<string, any>;
    expect(quickTips).toMatchObject({ video_count_in_dataset: 10, channel_subscriber_count: 450000, channel_created_at: '2021-01-15T12:00:00Z' });
    expect(quickTips.channel_country).toBeUndefined();
  });

  test('reads the Shorts flag and splits videos by format', () => {
    expect([parseShortFlag('yes'), parseShortFlag('no'), parseShortFlag('TRUE'), parseShortFlag(''), parseShortFlag(undefined)]).toEqual([true, false, true, null, null]);
    const records = normalizeTemplateRows(rows);
    expect(buildFormats(records)).toEqual([
      { label: 'Shorts', filterValue: 'yes', count: 10, share: 10 / 30 },
      { label: 'Regular videos', filterValue: 'no', count: 20, share: 20 / 30 },
    ]);
    expect(buildFormats(normalizeTemplateRows([{ videoId: 'a' }]))).toEqual([]);
  });

  test('the overview mentions Shorts and channel subscribers', () => {
    const snapshot = buildDashboardTemplateSnapshot({ rows, scope: 'full' });
    expect(snapshot.profile?.summary).toContain('33% are Shorts.');
    expect(snapshot.profile?.medianChannelSubscribers).toBe(27100);
  });

  test('attention measures views per subscriber', () => {
    const attention = buildAttentionProfile(normalizeTemplateRows(rows));
    expect(attention.hasSubscribers).toBe(true);
    const first = attention.ranked.find((video) => video.videoId === 'synthVid002')!;
    expect(first.perSubscriber).toBeCloseTo(3 * 40_000 / 450_000);
  });

  test('clicking Shorts filters the isShort column on its stored value', () => {
    expect(buildOverviewDrilldownFilter({ kind: 'format', value: 'yes' }, schema)).toEqual({
      isShort: { filterKind: 'text', operator: 'equals', value: 'yes' },
    });
  });

  test('channel creation dates show as dates, also when parsed as timestamps', () => {
    expect(formatMetadataDisplay('channel_created_at', Date.UTC(2021, 0, 15, 12))).toBe('Jan 15, 2021');
    expect(formatMetadataDisplay('channel_created_at', '2021-01-15T12:00:00Z')).toBe('Jan 15, 2021');
    expect(formatMetadataDisplay('channel_subscriber_count', 450000)).toBe('450,000');
  });
});
