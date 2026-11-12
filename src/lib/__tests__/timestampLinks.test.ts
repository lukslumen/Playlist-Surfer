import { describe, expect, test } from 'vitest';
import { parseTimestampLabel, splitTimestamps } from '../timestampLinks';

describe('parseTimestampLabel', () => {
  test('reads m:ss, mm:ss and h:mm:ss', () => {
    expect(parseTimestampLabel('4:05')).toBe(245);
    expect(parseTimestampLabel('12:34')).toBe(754);
    expect(parseTimestampLabel('1:02:03')).toBe(3723);
    expect(parseTimestampLabel('75:30')).toBe(4530);
  });

  test('rejects impossible times', () => {
    expect(parseTimestampLabel('4:65')).toBeNull();
    expect(parseTimestampLabel('1:75:00')).toBeNull();
    expect(parseTimestampLabel('abc')).toBeNull();
  });
});

describe('splitTimestamps', () => {
  test('finds YouTube chapter lines and keeps the text intact', () => {
    const text = '0:00 Intro\n4:05 The border\n1:02:03 Credits';
    const segments = splitTimestamps(text);
    expect(segments.filter((segment) => segment.kind === 'timestamp').map((segment) => segment.kind === 'timestamp' && segment.seconds)).toEqual([0, 245, 3723]);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
  });

  test('ignores parts of dates, versions, ratios and longer numbers', () => {
    expect(splitTimestamps('Published 2024:10:33, v1.2:30 and 16:9 widescreen, phone 0612:3456').every((segment) => segment.kind === 'text')).toBe(true);
  });

  test('leaves times past the end of the video as text', () => {
    const segments = splitTimestamps('Chapter at 12:00, live tonight at 19:30', 15 * 60);
    expect(segments.filter((segment) => segment.kind === 'timestamp').map((segment) => segment.text)).toEqual(['12:00']);
  });

  test('handles timestamps in brackets and at line ends', () => {
    expect(splitTimestamps('[2:15] quote (see 3:40)').filter((segment) => segment.kind === 'timestamp').map((segment) => segment.text)).toEqual(['2:15', '3:40']);
  });
});
