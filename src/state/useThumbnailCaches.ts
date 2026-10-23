import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardThumbnailCacheEntry, DashboardThumbnailCacheSnapshot, DashboardThumbnailLoadProgress } from '../types';
import {
  applyThumbnailEntryFailed,
  applyThumbnailEntryLoaded,
  resetFailedThumbnailEntries,
  revokeDroppedThumbnailUrls,
  revokeThumbnailUrls,
  summarizeThumbnailProgress,
  THUMBNAIL_ZOOM_STEPS,
} from '../lib/thumbnailCache';

type Caches = Record<string, DashboardThumbnailCacheSnapshot>;
type ScopeKey = DashboardThumbnailCacheSnapshot['scopeKey'];

/**
 * Dashboard thumbnail caches per scope (full dataset, filtered view, saved views), the scope whose
 * loading progress is shown, and the tile zoom level.
 *
 * The ref is the source of truth so that many <img> load/error events in one tick all build on the
 * latest state, and no side effects (revoking object URLs, session ids) happen inside updaters.
 * Progress is derived from the cache, so it can't drift from it.
 */
export function useThumbnailCaches() {
  const [thumbnailCaches, setThumbnailCachesState] = useState<Caches>({});
  const cachesRef = useRef<Caches>(thumbnailCaches);
  const sessionCounterRef = useRef(0);
  const [progressScope, setProgressScope] = useState<{ scopeKey: ScopeKey; label: string } | null>(null);
  const [zoomIndex, setZoomIndex] = useState(2);

  const commit = useCallback((next: Caches) => {
    if (next === cachesRef.current) return;
    cachesRef.current = next;
    setThumbnailCachesState(next);
  }, []);

  /** A new session id: entries report load/error with it, so late events from old loads are ignored. */
  const nextThumbnailSessionId = useCallback(() => {
    sessionCounterRef.current += 1;
    return sessionCounterRef.current;
  }, []);

  const peekThumbnailSessionId = useCallback(() => sessionCounterRef.current, []);

  const clearAllThumbnailCaches = useCallback(() => {
    sessionCounterRef.current += 1;
    setProgressScope(null);
    (Object.values(cachesRef.current) as DashboardThumbnailCacheSnapshot[]).forEach((snapshot) => revokeThumbnailUrls(snapshot));
    commit({});
  }, [commit]);

  /** Replaces all caches (project load); new sessions start above `sessionFloor`. */
  const replaceThumbnailCaches = useCallback((next: Caches, sessionFloor: number) => {
    sessionCounterRef.current = Math.max(sessionCounterRef.current + 1, sessionFloor + 1);
    setProgressScope(null);
    (Object.values(cachesRef.current) as DashboardThumbnailCacheSnapshot[]).forEach((snapshot) => revokeThumbnailUrls(snapshot));
    commit(next);
  }, [commit]);

  /** Writes freshly built scope snapshots and shows progress for one of them. */
  const writeThumbnailScopes = useCallback((snapshots: DashboardThumbnailCacheSnapshot[], options?: { showProgressFor?: ScopeKey; onlyIfMissing?: boolean }) => {
    const current = cachesRef.current;
    const toWrite = options?.onlyIfMissing ? snapshots.filter((snapshot) => !current[snapshot.scopeKey]) : snapshots;
    if (!toWrite.length) return;
    const next = { ...current };
    toWrite.forEach((snapshot) => {
      revokeDroppedThumbnailUrls(current[snapshot.scopeKey], snapshot);
      next[snapshot.scopeKey] = snapshot;
    });
    commit(next);
    const shown = toWrite.find((snapshot) => snapshot.scopeKey === options?.showProgressFor);
    if (shown) setProgressScope({ scopeKey: shown.scopeKey, label: shown.label });
  }, [commit]);

  /** Removes the scopes matching `shouldRemove` and frees their object URLs. */
  const removeThumbnailScopes = useCallback((shouldRemove: (scopeKey: string) => boolean) => {
    const current = cachesRef.current;
    const keys = Object.keys(current).filter(shouldRemove);
    if (!keys.length) return;
    const next = { ...current };
    keys.forEach((key) => {
      revokeThumbnailUrls(next[key]);
      delete next[key];
    });
    commit(next);
  }, [commit]);

  const updateEntry = useCallback((
    scopeKey: ScopeKey,
    dedupeKey: string,
    update: (entry: DashboardThumbnailCacheEntry) => DashboardThumbnailCacheEntry,
    expectedSessionId?: number,
  ) => {
    const current = cachesRef.current;
    const snapshot = current[scopeKey];
    if (!snapshot?.entries?.length) return;
    if (Number.isFinite(expectedSessionId) && snapshot.sessionId !== Number(expectedSessionId)) return;
    const index = snapshot.entries.findIndex((entry) => entry.dedupeKey === dedupeKey);
    if (index < 0) return;
    const previous = snapshot.entries[index];
    const nextEntry = update(previous);
    if (nextEntry === previous) return;
    if (previous.objectUrl && nextEntry.objectUrl && previous.objectUrl !== nextEntry.objectUrl) {
      URL.revokeObjectURL(previous.objectUrl);
    }
    const entries = [...snapshot.entries];
    entries[index] = nextEntry;
    commit({ ...current, [scopeKey]: { ...snapshot, calculatedAt: new Date().toISOString(), entries } });
  }, [commit]);

  const handleThumbnailEntryLoad = useCallback((scopeKey: ScopeKey, sessionId: number, dedupeKey: string, candidateIndex: number, loadedUrl?: string) => {
    updateEntry(scopeKey, dedupeKey, (entry) => applyThumbnailEntryLoaded(entry, candidateIndex, loadedUrl), sessionId);
  }, [updateEntry]);

  const handleThumbnailEntryError = useCallback((scopeKey: ScopeKey, sessionId: number, dedupeKey: string, candidateIndex: number, failedUrl?: string) => {
    updateEntry(scopeKey, dedupeKey, (entry) => applyThumbnailEntryFailed(entry, candidateIndex, failedUrl), sessionId);
  }, [updateEntry]);

  const retryFailedThumbnails = useCallback((scopeKey: ScopeKey) => {
    const current = cachesRef.current;
    const snapshot = current[scopeKey];
    if (!snapshot?.entries?.length) return;
    const entries = resetFailedThumbnailEntries(snapshot.entries);
    if (!entries) return;
    commit({
      ...current,
      [scopeKey]: { ...snapshot, sessionId: nextThumbnailSessionId(), calculatedAt: new Date().toISOString(), entries },
    });
  }, [commit, nextThumbnailSessionId]);

  // Free every object URL when the app unmounts.
  useEffect(() => () => {
    (Object.values(cachesRef.current) as DashboardThumbnailCacheSnapshot[]).forEach((snapshot) => revokeThumbnailUrls(snapshot));
  }, []);

  const thumbnailLoadProgress = useMemo<DashboardThumbnailLoadProgress | null>(() => {
    if (!progressScope) return null;
    const summary = summarizeThumbnailProgress(thumbnailCaches[progressScope.scopeKey]?.entries || []);
    return { scopeKey: progressScope.scopeKey, label: progressScope.label, ...summary };
  }, [progressScope, thumbnailCaches]);

  const zoomOut = useCallback(() => setZoomIndex((current) => Math.max(0, current - 1)), []);
  const zoomIn = useCallback(() => setZoomIndex((current) => Math.min(THUMBNAIL_ZOOM_STEPS.length - 1, current + 1)), []);

  return {
    thumbnailCaches,
    thumbnailCachesRef: cachesRef,
    thumbnailLoadProgress,
    nextThumbnailSessionId,
    peekThumbnailSessionId,
    clearAllThumbnailCaches,
    replaceThumbnailCaches,
    writeThumbnailScopes,
    removeThumbnailScopes,
    handleThumbnailEntryLoad,
    handleThumbnailEntryError,
    retryFailedThumbnails,
    thumbnailTileSize: THUMBNAIL_ZOOM_STEPS[zoomIndex] ?? THUMBNAIL_ZOOM_STEPS[2],
    canThumbnailZoomOut: zoomIndex > 0,
    canThumbnailZoomIn: zoomIndex < THUMBNAIL_ZOOM_STEPS.length - 1,
    handleThumbnailZoomOut: zoomOut,
    handleThumbnailZoomIn: zoomIn,
  };
}
