// Which parts of a video were actually played. Ranges are [start, end] positions in the video, in
// seconds; replaying a part does not count it twice.

export type WatchRange = [number, number];

/** Sorted, non-overlapping ranges; ranges that touch or overlap (within 0.5 s) are joined. */
export function mergeRanges(ranges: WatchRange[]): WatchRange[] {
  const sorted = ranges
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .map(([start, end]) => [Math.max(0, start), end] as WatchRange)
    .sort((a, b) => a[0] - b[0]);
  const merged: WatchRange[] = [];
  sorted.forEach(([start, end]) => {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 0.5) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  });
  return merged.map(([start, end]) => [Math.round(start * 10) / 10, Math.round(end * 10) / 10]);
}

/** Seconds of the video covered by the ranges, each part counted once. */
export function coveredSeconds(ranges: WatchRange[] | undefined): number {
  return mergeRanges(ranges ?? []).reduce((total, [start, end]) => total + (end - start), 0);
}

/**
 * The range one stretch of playback covered. When the playhead moved further than the wall clock
 * allows (a seek during playback), only the wall-clock time from the start position is counted.
 */
export function playbackRange(startPosition: number, endPosition: number, wallSeconds: number): WatchRange | null {
  if (!Number.isFinite(startPosition) || !Number.isFinite(endPosition)) return null;
  const moved = endPosition - startPosition;
  if (moved <= 0) return null;
  const plausible = moved <= wallSeconds * 2.2 + 1.5; // allows up to 2x playback speed
  return plausible ? [startPosition, endPosition] : [startPosition, startPosition + Math.max(0, wallSeconds)];
}
