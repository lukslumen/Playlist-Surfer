import type { ColumnSchema } from '../types';

export const LAST_PROJECT_AUTOSAVE_VERSION = 1;

const DB_NAME = 'tubedata_explorer_autosave';
export const AUTOSAVE_STORE_NAME = 'project_snapshots';
const STORE_NAME = AUTOSAVE_STORE_NAME;
const LAST_PROJECT_KEY = 'last_project';

export interface LastProjectAutosaveSnapshot {
  version: number;
  savedAt: string;
  fileName: string | null;
  sourceSchema: ColumnSchema[];
  rows: any[];
}

/**
 * Rows are stored in chunks: Chromium rejects a single IndexedDB value above ~133 MB, which a
 * snapshot of ~20k rows with long descriptions already exceeds. The snapshot record keeps only the
 * metadata and the chunk count. Records written before chunking carry `rows` inline and still load.
 */
export const AUTOSAVE_ROWS_PER_CHUNK = 1000;
const ROW_CHUNK_PREFIX = `${LAST_PROJECT_KEY}:rows:`;

type StoredLastProjectAutosaveSnapshot = Omit<LastProjectAutosaveSnapshot, 'rows'> & {
  id: string;
  rows?: any[];
  rowChunkCount?: number;
};

interface StoredRowChunk {
  id: string;
  rows: any[];
}

export function rowChunkId(index: number) {
  return `${ROW_CHUNK_PREFIX}${String(index).padStart(6, '0')}`;
}

export function splitRowsIntoChunks<T>(rows: T[], chunkSize = AUTOSAVE_ROWS_PER_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < rows.length; start += chunkSize) {
    chunks.push(rows.slice(start, start + chunkSize));
  }
  return chunks;
}

const ROW_CHUNK_RANGE = () => IDBKeyRange.bound(ROW_CHUNK_PREFIX, `${ROW_CHUNK_PREFIX}\uffff`);

let dbPromise: Promise<IDBDatabase> | null = null;

export function openAutosaveDb(): Promise<IDBDatabase> {
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
  // Let a later call try again instead of failing every save for the rest of the session.
  dbPromise.catch(() => {
    dbPromise = null;
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
  const chunks = splitRowsIntoChunks(snapshot.rows);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    // Report the underlying DOMException (quota, clone or size errors) rather than a generic message.
    let firstError: DOMException | null = null;
    const track = (request: IDBRequest) => {
      request.onerror = () => { firstError = firstError || request.error; };
    };
    const fail = () => reject(firstError || tx.error || new Error('Failed to write autosave snapshot.'));
    tx.oncomplete = () => resolve();
    tx.onerror = fail;
    tx.onabort = fail;

    // One transaction: either the whole new snapshot lands or the previous one stays intact.
    track(store.delete(ROW_CHUNK_RANGE()));
    chunks.forEach((rows, index) => {
      const chunk: StoredRowChunk = { id: rowChunkId(index), rows };
      track(store.put(chunk));
    });
    const { rows: _rows, ...meta } = snapshot;
    const payload: StoredLastProjectAutosaveSnapshot = { ...meta, id: LAST_PROJECT_KEY, rowChunkCount: chunks.length };
    track(store.put(payload));
  });
}

export async function clearLastProjectAutosaveSnapshot(): Promise<void> {
  const db = await openAutosaveDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to clear autosave snapshot.'));
    const store = tx.objectStore(STORE_NAME);
    store.delete(LAST_PROJECT_KEY);
    store.delete(ROW_CHUNK_RANGE());
  });
}

async function readRowChunks(db: IDBDatabase, chunkCount: number): Promise<any[] | null> {
  const chunks = await new Promise<StoredRowChunk[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    tx.onerror = () => reject(tx.error || new Error('Failed to read autosave rows.'));
    const request = tx.objectStore(STORE_NAME).getAll(ROW_CHUNK_RANGE());
    request.onsuccess = () => resolve((request.result as StoredRowChunk[]) || []);
    request.onerror = () => reject(request.error || new Error('Failed to read autosave rows.'));
  });
  if (chunks.length !== chunkCount) return null;
  // getAll returns records in key order, and chunk ids are zero-padded, so this keeps row order.
  return chunks.flatMap((chunk) => chunk.rows);
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

  const rows = typeof stored.rowChunkCount === 'number'
    ? await readRowChunks(db, stored.rowChunkCount)
    : stored.rows;

  const candidate: LastProjectAutosaveSnapshot = {
    version: stored.version,
    savedAt: stored.savedAt,
    fileName: stored.fileName ?? null,
    sourceSchema: stored.sourceSchema,
    rows: rows as any[],
  };

  if (!isValidLastProjectAutosaveSnapshot(candidate)) {
    await clearLastProjectAutosaveSnapshot();
    return null;
  }

  return candidate;
}
