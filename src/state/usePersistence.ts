import { useCallback, useEffect, useRef } from 'react';
import type { ColumnSchema } from '../types';
import { savePersistedState } from '../lib/persistedState';
import { LAST_PROJECT_AUTOSAVE_VERSION, saveLastProjectAutosaveSnapshot } from '../lib/projectAutosave';

type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function shallowEqualRecords(a: Record<string, unknown> | null, b: Record<string, unknown>) {
  if (!a) return false;
  const keys = Object.keys(b);
  return keys.length === Object.keys(a).length && keys.every((key) => Object.is(a[key], b[key]));
}

/**
 * Saves the app state and the row snapshot to IndexedDB.
 * - App state is saved in an idle callback whenever any top-level field changes identity.
 * - Rows are saved when the dataset itself changes, not on every hide of the tab: at 100k rows a
 *   row snapshot is ~600 MB of serialization.
 * - Anything still pending is flushed when the page is hidden or unloaded.
 */
export function usePersistence(args: {
  state: Record<string, unknown>;
  rows: any[];
  schema: ColumnSchema[];
  fileName: string | null;
}) {
  const { state, rows, schema, fileName } = args;
  const latestStateRef = useRef<Record<string, unknown> | null>(null);
  const savedStateRef = useRef<Record<string, unknown> | null>(null);
  const rowsSnapshotRef = useRef({ rows, schema, fileName });
  rowsSnapshotRef.current = { rows, schema, fileName };
  const savedRowsRef = useRef<{ rows: any[]; schema: ColumnSchema[]; fileName: string | null } | null>(null);

  // Keep a stable reference while nothing changed, so the effect below only runs on real changes.
  if (!shallowEqualRecords(latestStateRef.current, state)) {
    latestStateRef.current = state;
  }
  const currentState = latestStateRef.current as Record<string, unknown>;

  const saveStateNow = useCallback((reason: string) => {
    const snapshot = latestStateRef.current;
    if (!snapshot || snapshot === savedStateRef.current) return;
    savedStateRef.current = snapshot;
    savePersistedState(snapshot).catch((error) => {
      savedStateRef.current = null;
      console.warn(`[state] Failed to save app state (${reason}).`, error);
    });
  }, []);

  const saveRowsNow = useCallback(async (reason: string) => {
    const current = rowsSnapshotRef.current;
    if (!current.rows.length || !current.schema.length) return;
    const saved = savedRowsRef.current;
    if (saved && saved.rows === current.rows && saved.schema === current.schema && saved.fileName === current.fileName) return;
    savedRowsRef.current = current;
    try {
      await saveLastProjectAutosaveSnapshot({
        version: LAST_PROJECT_AUTOSAVE_VERSION,
        savedAt: new Date().toISOString(),
        fileName: current.fileName ?? null,
        sourceSchema: current.schema,
        rows: current.rows,
      });
    } catch (error) {
      savedRowsRef.current = null;
      console.warn(`[autosave] Failed to persist snapshot (${reason}).`, error);
    }
  }, []);

  // App state: save when idle after each change.
  useEffect(() => {
    const win = window as IdleWindow;
    const handle: { idle?: number; timeout?: ReturnType<typeof setTimeout> } = {};
    if (win.requestIdleCallback) handle.idle = win.requestIdleCallback(() => saveStateNow('idle'), { timeout: 1200 });
    else handle.timeout = setTimeout(() => saveStateNow('timeout'), 120);
    return () => {
      if (handle.idle !== undefined) win.cancelIdleCallback?.(handle.idle);
      if (handle.timeout !== undefined) clearTimeout(handle.timeout);
    };
  }, [currentState, saveStateNow]);

  // Rows: save whenever the dataset changes.
  useEffect(() => {
    void saveRowsNow('dataset-change');
  }, [rows, schema, fileName, saveRowsNow]);

  // Flush pending work when the page goes away. IndexedDB writes during unload may not finish, so
  // hiding the tab (which usually comes first) flushes too.
  useEffect(() => {
    const flush = () => {
      saveStateNow('page-lifecycle');
      void saveRowsNow('page-lifecycle');
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
    };
  }, [saveRowsNow, saveStateNow]);

  /** The most recent state handed to the hook (used when restoring an autosaved dataset). */
  const getLatestPersistedState = useCallback(() => latestStateRef.current, []);

  return { getLatestPersistedState };
}
