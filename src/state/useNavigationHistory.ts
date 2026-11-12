import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EMPTY_NAVIGATION_HISTORY,
  moveNavigationCursor,
  recordNavigationEntry,
  type AppNavigationEntry,
  type NavigationHistoryState,
} from '../lib/navigation';

/**
 * Back/forward history of where the user was (view, filters, selected video or channel). Every new
 * location is recorded; going back or forward restores an entry without recording it again.
 */
export function useNavigationHistory(args: {
  enabled: boolean;
  currentEntry: AppNavigationEntry;
  restoreEntry: (entry: AppNavigationEntry) => void;
}) {
  const { enabled, currentEntry, restoreEntry } = args;
  const [history, setHistory] = useState<NavigationHistoryState>(EMPTY_NAVIGATION_HISTORY);
  const historyRef = useRef(history);
  historyRef.current = history;
  // While a restored entry is being applied (over several renders: the selection is cleared and set
  // again once the target is found), intermediate locations must not be recorded, or they would cut
  // off the forward history. Holds the restored entry's key until the app arrives there.
  const restoringKeyRef = useRef<string | null>(null);
  const restoringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRecordedKeyRef = useRef<string | null>(null);

  const stopRestoring = useCallback(() => {
    restoringKeyRef.current = null;
    if (restoringTimeoutRef.current) clearTimeout(restoringTimeoutRef.current);
    restoringTimeoutRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const key = JSON.stringify(currentEntry);
    if (restoringKeyRef.current) {
      lastRecordedKeyRef.current = key;
      if (key === restoringKeyRef.current) stopRestoring();
      return;
    }
    if (lastRecordedKeyRef.current === key) return;
    lastRecordedKeyRef.current = key;
    setHistory((current) => recordNavigationEntry(current, currentEntry));
  }, [currentEntry, enabled, stopRestoring]);

  const navigateHistoryByOffset = useCallback((offset: -1 | 1) => {
    const { state, entry } = moveNavigationCursor(historyRef.current, offset);
    if (!entry) return;
    historyRef.current = state;
    setHistory(state);
    stopRestoring();
    restoringKeyRef.current = JSON.stringify(entry);
    // Safety net: if the restored location never matches exactly, resume recording shortly after.
    restoringTimeoutRef.current = setTimeout(stopRestoring, 1500);
    restoreEntry(entry);
  }, [restoreEntry, stopRestoring]);

  /** Forget all history, e.g. after loading another project. */
  const resetNavigationHistory = useCallback(() => {
    historyRef.current = EMPTY_NAVIGATION_HISTORY;
    stopRestoring();
    lastRecordedKeyRef.current = null;
    setHistory(EMPTY_NAVIGATION_HISTORY);
  }, [stopRestoring]);

  return {
    navigateHistoryByOffset,
    resetNavigationHistory,
    canNavigateBack: history.cursor > 0,
    canNavigateForward: history.cursor >= 0 && history.cursor < history.entries.length - 1,
  };
}
