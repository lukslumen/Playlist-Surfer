import { useState, useCallback, useRef, useEffect } from 'react';
import { ColumnSchema, ImportOptions } from '../types';

export function useDuckDB() {
  const workerRef = useRef<Worker | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callbacksRef = useRef<Map<string, (data: any) => void>>(new Map());
  // The UI no longer waits for DuckDB (it downloads several MB of WebAssembly); requests wait here
  // until the engine is ready instead, and fail if it can't start.
  const readyRef = useRef<{ promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } | null>(null);
  if (!readyRef.current) {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    promise.catch(() => {});
    readyRef.current = { promise, resolve, reject };
  }

  useEffect(() => {
    const worker = new Worker(new URL('../worker/db.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e) => {
      const { id, type, payload } = e.data;
      const callback = callbacksRef.current.get(id);

      if (type === 'ERROR') {
        setError(payload.message);
        if (callback) callback({ error: payload.message });
      } else if (callback) {
        callback(payload || {});
      }

      callbacksRef.current.delete(id);
    };

    workerRef.current = worker;

    const id = Math.random().toString(36).substring(7);
    worker.postMessage({ type: 'INIT', id });
    callbacksRef.current.set(id, (data) => {
      if (data?.error) {
        readyRef.current?.reject(new Error(`The CSV engine (DuckDB) could not start: ${data.error}`));
        return;
      }
      setIsReady(true);
      readyRef.current?.resolve();
    });

    return () => {
      worker.terminate();
    };
  }, []);

  const execute = useCallback(async (type: string, payload?: any): Promise<any> => {
    await readyRef.current?.promise;
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error('Worker not initialized'));
        return;
      }

      const id = Math.random().toString(36).substring(7);
      callbacksRef.current.set(id, (data) => {
        if (data?.error) reject(new Error(data.error));
        else resolve(data);
      });

      workerRef.current.postMessage({ type, payload, id });
    });
  }, []);

  const peekCSV = useCallback(async (file: File): Promise<{ schema: ColumnSchema[] }> => {
    setIsIngesting(true);
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      const result = await execute('PEEK_CSV', { name: file.name, buffer });
      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsIngesting(false);
    }
  }, [execute]);

  const readCSVBuffer = useCallback(async (name: string, buffer: ArrayBuffer): Promise<{ schema: ColumnSchema[]; rows: any[] }> => {
    setIsIngesting(true);
    setError(null);
    try {
      const result = await execute('READ_CSV', { name, buffer });
      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsIngesting(false);
    }
  }, [execute]);

  const readCSV = useCallback(async (file: File): Promise<{ schema: ColumnSchema[]; rows: any[] }> => {
    const buffer = await file.arrayBuffer();
    return readCSVBuffer(file.name, buffer);
  }, [readCSVBuffer]);

  const ingestCSV = useCallback(async (
    file: File,
    options: ImportOptions,
  ): Promise<{ schema: ColumnSchema[] }> => {
    setIsIngesting(true);
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      const result = await execute('INGEST_CSV', {
        name: file.name,
        buffer,
        ...options,
      });
      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsIngesting(false);
    }
  }, [execute]);

  const query = useCallback(async (sql: string): Promise<any[]> => {
    const result = await execute('QUERY', { sql });
    return result.rows;
  }, [execute]);

  return { isReady, isIngesting, error, peekCSV, readCSV, readCSVBuffer, ingestCSV, query };
}
