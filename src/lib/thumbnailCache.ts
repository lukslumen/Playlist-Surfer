import { DashboardThumbnailCacheSnapshot } from '../types';

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
