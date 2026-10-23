import type { DashboardThumbnailCacheEntry, DashboardThumbnailCacheSnapshot } from '../types';
import { isSavedViewThumbnailScopeKey } from './dashboardThumbnails';

export const FILTERED_TEMP_THUMBNAIL_SCOPE = 'filtered-temp';

export const THUMBNAIL_ZOOM_STEPS = [88, 104, 128, 156, 192, 240, 320, 440, 620, 860, 1120];

export function createObjectUrl(bytes: Uint8Array, mimeType = 'image/jpeg') {
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export function buildThumbnailEntriesFromCacheSeed(args: {
  candidates: Array<{
    videoId: string;
    dedupeKey: string;
    title: string;
    rank: number;
    sourceUrl: string;
    candidateUrls?: string[];
  }>;
  seedSnapshot?: DashboardThumbnailCacheSnapshot;
}): DashboardThumbnailCacheSnapshot['entries'] {
  const seedByDedupe = new Map<string, DashboardThumbnailCacheSnapshot['entries'][number]>();
  (args.seedSnapshot?.entries || []).forEach((entry) => {
    if (!entry?.dedupeKey) return;
    if (!seedByDedupe.has(entry.dedupeKey)) seedByDedupe.set(entry.dedupeKey, entry);
  });
  return args.candidates.map((candidate) => {
    const candidateUrls = Array.from(new Set(
      (candidate.candidateUrls || [])
        .map((url) => String(url || '').trim())
        .filter(Boolean)
    ));
    const initialUrl = candidateUrls[0] || candidate.sourceUrl || '';
    const initialCandidateIndex = initialUrl ? 0 : -1;
    const initialStatus: DashboardThumbnailCacheSnapshot['entries'][number]['status'] = initialUrl ? 'pending' : 'failed';
    const baseEntry = {
      videoId: candidate.videoId,
      dedupeKey: candidate.dedupeKey,
      title: candidate.title,
      rank: candidate.rank,
      sourceUrl: initialUrl,
      candidateUrls,
      activeUrl: initialUrl,
      fallbackIndex: 0,
      activeCandidateIndex: initialCandidateIndex,
      status: initialStatus,
      error: initialUrl ? undefined : 'No valid thumbnail URL',
    };
    const seededEntry = seedByDedupe.get(candidate.dedupeKey);
    if (!seededEntry) return baseEntry;
    const seededActiveUrl = String(seededEntry.activeUrl || seededEntry.sourceUrl || '').trim();
    const seededActiveIndexFromUrl = seededActiveUrl ? candidateUrls.findIndex((url) => url === seededActiveUrl) : -1;
    const seededFallbackIndex = seededEntry.fallbackIndex ?? (seededActiveIndexFromUrl >= 0 ? seededActiveIndexFromUrl : 0);
    const seededIndex = Number.isFinite(seededEntry.activeCandidateIndex)
      ? Number(seededEntry.activeCandidateIndex)
      : Number(seededFallbackIndex);
    const normalizedSeededIndex = Number.isFinite(seededIndex)
      ? Math.max(0, Math.min(Math.floor(seededIndex), Math.max(candidateUrls.length - 1, 0)))
      : 0;
    if (seededEntry.status === 'loaded' && seededEntry.bytes?.length) {
      const mimeType = seededEntry.mimeType || 'image/jpeg';
      const bytes = new Uint8Array(seededEntry.bytes);
      const seededUrl = seededActiveUrl || candidateUrls[normalizedSeededIndex] || initialUrl;
      return {
        ...baseEntry,
        status: 'loaded' as const,
        sourceUrl: seededUrl || baseEntry.sourceUrl,
        activeUrl: seededUrl || baseEntry.activeUrl,
        fallbackIndex: normalizedSeededIndex,
        activeCandidateIndex: normalizedSeededIndex,
        mimeType,
        byteLength: seededEntry.byteLength ?? bytes.length,
        bytes,
        objectUrl: createObjectUrl(bytes, mimeType),
      };
    }
    if (seededEntry.status === 'loaded' && seededActiveUrl) {
      return {
        ...baseEntry,
        status: 'loaded' as const,
        sourceUrl: seededActiveUrl,
        activeUrl: seededActiveUrl,
        fallbackIndex: normalizedSeededIndex,
        activeCandidateIndex: normalizedSeededIndex,
      };
    }
    if (seededEntry.status === 'failed' && candidateUrls.length > 0) {
      return {
        ...baseEntry,
        status: 'failed' as const,
        activeUrl: '',
        fallbackIndex: Math.max(0, candidateUrls.length - 1),
        activeCandidateIndex: Math.max(0, candidateUrls.length - 1),
        error: seededEntry.error || 'Failed to load thumbnail',
      };
    }
    return baseEntry;
  });
}

export function summarizeThumbnailProgress(entries: DashboardThumbnailCacheSnapshot['entries']) {
  const total = entries.length;
  const failed = entries.filter((entry) => entry.status === 'failed').length;
  const completed = entries.filter((entry) => entry.status !== 'pending').length;
  return {
    total,
    completed,
    failed,
    loading: completed < total,
  };
}

export function revokeThumbnailUrls(snapshot?: DashboardThumbnailCacheSnapshot) {
  if (!snapshot) return;
  snapshot.entries.forEach((entry) => {
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  });
}

export function revokeDroppedThumbnailUrls(previous?: DashboardThumbnailCacheSnapshot, next?: DashboardThumbnailCacheSnapshot) {
  if (!previous) return;
  const nextUrls = new Set((next?.entries || []).map((entry) => entry.objectUrl).filter((value): value is string => Boolean(value)));
  previous.entries.forEach((entry) => {
    if (entry.objectUrl && !nextUrls.has(entry.objectUrl)) {
      URL.revokeObjectURL(entry.objectUrl);
    }
  });
}

const uniqueUrls = (urls: Array<string | undefined>) => Array.from(new Set(urls.map((url) => String(url || '').trim()).filter(Boolean)));
const clampIndex = (index: number, urls: string[]) => Math.max(0, Math.min(Math.floor(index), Math.max(urls.length - 1, 0)));

/**
 * A thumbnail finished loading from candidate `candidateIndex`. Reports from a candidate that is no
 * longer the active one (a stale <img> event) are ignored. Returns the same entry when nothing changes.
 */
export function applyThumbnailEntryLoaded(entry: DashboardThumbnailCacheEntry, candidateIndex: number, loadedUrl?: string): DashboardThumbnailCacheEntry {
  const resolvedUrl = String(loadedUrl || entry.objectUrl || entry.activeUrl || entry.sourceUrl || '').trim();
  if (!resolvedUrl) return entry;
  const urls = uniqueUrls(entry.candidateUrls || [entry.activeUrl, entry.sourceUrl, resolvedUrl]);
  const index = clampIndex(candidateIndex, urls);
  if (Number.isFinite(entry.activeCandidateIndex) && Number(entry.activeCandidateIndex) !== index) return entry;
  if (
    entry.status === 'loaded'
    && entry.activeUrl === resolvedUrl
    && (entry.fallbackIndex ?? 0) === index
    && (entry.activeCandidateIndex ?? 0) === index
  ) {
    return entry;
  }
  return {
    ...entry,
    status: 'loaded',
    sourceUrl: urls[index] || entry.sourceUrl,
    activeUrl: resolvedUrl,
    candidateUrls: urls,
    fallbackIndex: index,
    activeCandidateIndex: index,
    error: undefined,
  };
}

/**
 * A thumbnail failed to load from candidate `candidateIndex`: move on to the next candidate URL, or
 * mark the entry failed once all candidates are exhausted. Stale reports are ignored.
 */
export function applyThumbnailEntryFailed(entry: DashboardThumbnailCacheEntry, candidateIndex: number, failedUrl?: string): DashboardThumbnailCacheEntry {
  const urls = uniqueUrls(entry.candidateUrls || [entry.activeUrl, entry.sourceUrl]);
  if (!urls.length) {
    if (entry.status === 'failed' && !entry.activeUrl) return entry;
    return {
      ...entry,
      status: 'failed',
      activeUrl: '',
      fallbackIndex: 0,
      activeCandidateIndex: -1,
      candidateUrls: [],
      error: entry.error || 'No thumbnail URL available',
    };
  }
  const index = clampIndex(candidateIndex, urls);
  if (Number.isFinite(entry.activeCandidateIndex) && Number(entry.activeCandidateIndex) !== index) return entry;
  const currentUrl = String(failedUrl || entry.activeUrl || '').trim();
  const currentIndex = currentUrl ? urls.findIndex((url) => url === currentUrl) : -1;
  const fallbackIndex = Math.max(0, Math.min(
    Number.isFinite(entry.activeCandidateIndex) ? Number(entry.activeCandidateIndex) : (entry.fallbackIndex ?? 0),
    urls.length - 1,
  ));
  const nextIndex = (currentIndex >= 0 ? currentIndex : fallbackIndex) + 1;
  if (nextIndex < urls.length) {
    const nextUrl = urls[nextIndex];
    if (
      entry.status === 'pending'
      && entry.activeUrl === nextUrl
      && fallbackIndex === nextIndex
      && (entry.activeCandidateIndex ?? nextIndex) === nextIndex
    ) {
      return entry;
    }
    return {
      ...entry,
      status: 'pending',
      sourceUrl: nextUrl,
      activeUrl: nextUrl,
      candidateUrls: urls,
      fallbackIndex: nextIndex,
      activeCandidateIndex: nextIndex,
      error: undefined,
    };
  }
  if (
    entry.status === 'failed'
    && !entry.activeUrl
    && fallbackIndex === urls.length - 1
    && (entry.activeCandidateIndex ?? fallbackIndex) === fallbackIndex
  ) {
    return entry;
  }
  return {
    ...entry,
    status: 'failed',
    activeUrl: '',
    candidateUrls: urls,
    fallbackIndex: urls.length - 1,
    activeCandidateIndex: urls.length - 1,
    error: entry.error || 'Failed to load thumbnail',
  };
}

/** Puts failed entries back to their first candidate URL; null when there is nothing to retry. */
export function resetFailedThumbnailEntries(entries: DashboardThumbnailCacheEntry[]): DashboardThumbnailCacheEntry[] | null {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.status !== 'failed') return entry;
    const urls = uniqueUrls(entry.candidateUrls || [entry.sourceUrl]);
    if (!urls.length) return entry;
    changed = true;
    return {
      ...entry,
      status: 'pending' as const,
      sourceUrl: urls[0],
      activeUrl: urls[0],
      candidateUrls: urls,
      fallbackIndex: 0,
      activeCandidateIndex: 0,
      error: undefined,
    };
  });
  return changed ? next : null;
}

/**
 * Thumbnail caches restored from a project: give each scope a session id, normalise the active
 * candidate index, and stamp the versions they belong to. Returns the highest session id used.
 */
export function normalizeRestoredThumbnailCaches(
  caches: Record<string, DashboardThumbnailCacheSnapshot>,
  args: { sessionStart: number; datasetVersion: number; filteredViewVersion: number; savedViewsVersion?: number },
): { caches: Record<string, DashboardThumbnailCacheSnapshot>; maxSessionId: number } {
  let counter = args.sessionStart;
  const next = Object.fromEntries(Object.entries(caches).map(([scopeKey, snapshot]) => {
    counter += 1;
    const sessionId = Number.isFinite(snapshot.sessionId) ? Number(snapshot.sessionId) : counter;
    const entries = (snapshot.entries || []).map((entry) => {
      const normalizedIndex = Number.isFinite(entry.activeCandidateIndex)
        ? Number(entry.activeCandidateIndex)
        : Math.max(0, Number(entry.fallbackIndex ?? 0));
      return { ...entry, activeCandidateIndex: entry.activeUrl || entry.sourceUrl ? normalizedIndex : -1 };
    });
    return [scopeKey, {
      ...snapshot,
      sessionId,
      entries,
      datasetVersionAtCalculation: args.datasetVersion,
      filteredViewVersionAtCalculation: scopeKey === FILTERED_TEMP_THUMBNAIL_SCOPE ? args.filteredViewVersion : snapshot.filteredViewVersionAtCalculation,
      savedViewsVersionAtCalculation: isSavedViewThumbnailScopeKey(scopeKey)
        ? (args.savedViewsVersion ?? snapshot.savedViewsVersionAtCalculation ?? 0)
        : snapshot.savedViewsVersionAtCalculation,
    }];
  })) as Record<string, DashboardThumbnailCacheSnapshot>;
  const maxSessionId = Math.max(counter, ...Object.values(next).map((snapshot) => Number(snapshot.sessionId) || 0));
  return { caches: next, maxSessionId };
}
