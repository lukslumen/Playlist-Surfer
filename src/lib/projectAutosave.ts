import type { ColumnSchema } from '../types';

export const LAST_PROJECT_AUTOSAVE_VERSION = 1;

const DB_NAME = 'tubedata_explorer_autosave';
const STORE_NAME = 'project_snapshots';
const LAST_PROJECT_KEY = 'last_project';

export interface LastProjectAutosaveSnapshot {
  version: number;
  savedAt: string;
  fileName: string | null;
  sourceSchema: ColumnSchema[];
  rows: any[];
}

type StoredLastProjectAutosaveSnapshot = LastProjectAutosaveSnapshot & { id: string };

let dbPromise: Promise<IDBDatabase> | null = null;

function openAutosaveDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available.'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open autosave database.'));
  });

  return dbPromise;
}

function isValidColumnSchemaArray(value: unknown): value is ColumnSchema[] {
  return Array.isArray(value) && value.every((column) => (
    column
    && typeof column === 'object'
    && typeof (column as any).column_name === 'string'
    && typeof (column as any).column_type === 'string'
  ));
}

export function isValidLastProjectAutosaveSnapshot(value: unknown): value is LastProjectAutosaveSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as LastProjectAutosaveSnapshot;
  if (snapshot.version !== LAST_PROJECT_AUTOSAVE_VERSION) return false;
  if (typeof snapshot.savedAt !== 'string' || !snapshot.savedAt.trim()) return false;
  if (snapshot.fileName !== null && typeof snapshot.fileName !== 'string') return false;
  if (!isValidColumnSchemaArray(snapshot.sourceSchema)) return false;
  if (!Array.isArray(snapshot.rows)) return false;
  return true;
}

export function shouldAttemptLastProjectRestore(args: { currentRowCount: number; currentSchemaCount: number }) {
  return !(args.currentRowCount > 0 && args.currentSchemaCount > 0);
}

export async function saveLastProjectAutosaveSnapshot(snapshot: LastProjectAutosaveSnapshot): Promise<void> {
  const db = await openAutosaveDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to write autosave snapshot.'));
    const store = tx.objectStore(STORE_NAME);
    const payload: StoredLastProjectAutosaveSnapshot = { ...snapshot, id: LAST_PROJECT_KEY };
    store.put(payload);
  });
}

export async function clearLastProjectAutosaveSnapshot(): Promise<void> {
  const db = await openAutosaveDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to clear autosave snapshot.'));
    tx.objectStore(STORE_NAME).delete(LAST_PROJECT_KEY);
  });
}

export async function loadLastProjectAutosaveSnapshot(): Promise<LastProjectAutosaveSnapshot | null> {
  const db = await openAutosaveDb();
  const stored = await new Promise<StoredLastProjectAutosaveSnapshot | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    tx.onerror = () => reject(tx.error || new Error('Failed to read autosave snapshot.'));
    const request = tx.objectStore(STORE_NAME).get(LAST_PROJECT_KEY);
    request.onsuccess = () => resolve(request.result as StoredLastProjectAutosaveSnapshot | undefined);
    request.onerror = () => reject(request.error || new Error('Failed to read autosave snapshot.'));
  });

  if (!stored) return null;

  const candidate: LastProjectAutosaveSnapshot = {
    version: stored.version,
    savedAt: stored.savedAt,
    fileName: stored.fileName ?? null,
    sourceSchema: stored.sourceSchema,
    rows: stored.rows,
  };

  if (!isValidLastProjectAutosaveSnapshot(candidate)) {
    await clearLastProjectAutosaveSnapshot();
    return null;
  }

  return candidate;
}
