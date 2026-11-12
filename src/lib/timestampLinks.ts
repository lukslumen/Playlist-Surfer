// Finds video timestamps ("4:05", "12:34", "1:02:03") in free text such as descriptions, chapter lists
// and transcripts, so they can be shown as links that jump the player to that moment.

export type TimestampSegment =
  | { kind: 'text'; text: string }
  | { kind: 'timestamp'; text: string; seconds: number };

// Not part of a longer number, time or ratio: no digit or colon directly before or after.
const TIMESTAMP_RE = /(?<![\d:.])(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)(?![\d:])/g;

/** Seconds for "h:mm:ss" / "m:ss", or null when it is not a valid timestamp. */
export function parseTimestampLabel(label: string): number | null {
  const match = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/.exec(label.trim());
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  if (hours !== undefined && Number(minutes) > 59) return null;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/**
 * Splits text into plain parts and timestamps. With `maxSeconds` (the video's length, when known),
 * times beyond the end of the video are left as text: they are clock times or dates, not positions.
 */
export function splitTimestamps(text: string, maxSeconds?: number | null): TimestampSegment[] {
  const segments: TimestampSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(TIMESTAMP_RE)) {
    const seconds = parseTimestampLabel(match[0]);
    if (seconds === null || (maxSeconds && seconds > maxSeconds)) continue;
    if (match.index > last) segments.push({ kind: 'text', text: text.slice(last, match.index) });
    segments.push({ kind: 'timestamp', text: match[0], seconds });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}
