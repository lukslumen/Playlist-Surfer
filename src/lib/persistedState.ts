import { AUTOSAVE_STORE_NAME, openAutosaveDb } from './projectAutosave';

/**
 * App state (exclusions, notes, tags, views, lineage...) used to live in localStorage, whose ~5 MB
 * quota is exceeded from roughly 30k rows on: the write then failed silently and curation was lost
 * on reload. It now lives in IndexedDB next to the row autosave. The JSON format is unchanged and
 * the old localStorage value is read once as a fallback, then removed.
 */
export const LEGACY_STORAGE_KEY = 'tubedata_explorer_state';
const STATE_RECORD_ID = 'app_state';

interface StoredAppState {
  id: string;
  savedAt: string;
  json: string;
}

let bootStateJson: string | null = null;

function readLegacyState(): string | null {
  try {
    return localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return null;
  }
}

async function readStoredState(): Promise<StoredAppState | null> {
  const db = await openAutosaveDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE_NAME, 'readonly');
    const request = tx.objectStore(AUTOSAVE_STORE_NAME).get(STATE_RECORD_ID);
    request.onsuccess = () => resolve((request.result as StoredAppState | undefined) ?? null);
    request.onerror = () => reject(request.error || new Error('Failed to read app state.'));
  });
}

/** Loads the saved state before the first render, so App can read it synchronously. */
export async function preloadPersistedState(): Promise<void> {
  try {
    const stored = await readStoredState();
    bootStateJson = stored?.json ?? readLegacyState();
  } catch (error) {
    console.warn('[state] Could not read saved state from IndexedDB; falling back to localStorage.', error);
    bootStateJson = readLegacyState();
  }
}

/** The JSON preloaded by preloadPersistedState, or the legacy localStorage value. */
export function getBootPersistedStateJson(): string | null {
  return bootStateJson ?? readLegacyState();
}

export async function savePersistedState(state: unknown): Promise<void> {
  const record: StoredAppState = {
    id: STATE_RECORD_ID,
    savedAt: new Date().toISOString(),
    json: JSON.stringify(state),
  };
  const db = await openAutosaveDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to write app state.'));
    tx.onabort = () => reject(tx.error || new Error('Writing app state was aborted.'));
    tx.objectStore(AUTOSAVE_STORE_NAME).put(record);
  });
  bootStateJson = record.json;
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage may be unavailable (private mode); the IndexedDB copy is what counts.
  }
}
