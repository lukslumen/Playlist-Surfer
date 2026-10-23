import { useCallback, useState } from 'react';
import type { ColumnSchema } from '../types';
import { applyFriendlyColumnMappings } from '../lib/data';
import { readFileBufferWithProgress, waitForNextPaint } from '../lib/browser';
import { IMPORT_STEP_COUNT, type ImportProgress } from '../lib/importPlan';

export interface LongTaskProgressUpdate {
  title: string;
  detail: string;
  completed: number;
  total: number;
  indeterminate?: boolean;
}

/**
 * The CSV import flow: read the file, hold it while the import dialog is open, then run the chosen
 * import with progress, error reporting and cleanup. What an import *does* lives in lib/importPlan.
 */
export function useImportFlow(deps: {
  readCSVBuffer: (fileName: string, buffer: ArrayBuffer) => Promise<{ schema: ColumnSchema[]; rows: any[] }>;
  updateLongTaskProgress: (progress: LongTaskProgressUpdate | null) => void;
  setIsLoadingRows: (loading: boolean) => void;
  /** Called when a file could not be read or parsed. */
  onReadError?: (fileName: string, error: unknown) => void;
}) {
  const { readCSVBuffer, updateLongTaskProgress, setIsLoadingRows, onReadError } = deps;
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingSchema, setPendingSchema] = useState<any[]>([]);
  const [pendingRows, setPendingRows] = useState<any[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImportSubmitting, setIsImportSubmitting] = useState(false);

  const clearPendingImport = useCallback(() => {
    setPendingFile(null);
    setPendingRows([]);
    setPendingSchema([]);
  }, []);

  const closeImport = useCallback(() => {
    setIsImportOpen(false);
    clearPendingImport();
  }, [clearPendingImport]);

  /** Reads and parses a CSV, then opens the import dialog for it. */
  const openCsvForImport = useCallback(async (file: File) => {
    const title = 'Preparing CSV import';
    try {
      setImportError(null);
      setIsLoadingRows(true);
      updateLongTaskProgress({ title, detail: `Reading ${file.name}`, completed: 0, total: 100 });
      const buffer = await readFileBufferWithProgress(file, (completed, total) => {
        updateLongTaskProgress({
          title,
          detail: `Reading ${file.name}`,
          completed: Math.min(40, Math.round((completed / Math.max(total, 1)) * 40)),
          total: 100,
        });
      });
      updateLongTaskProgress({ title, detail: 'Parsing rows and inferring columns', completed: 50, total: 100, indeterminate: true });
      await waitForNextPaint();
      const { schema, rows } = await readCSVBuffer(file.name, buffer);
      updateLongTaskProgress({ title, detail: `Loaded ${rows.length.toLocaleString()} rows`, completed: 100, total: 100 });
      setPendingFile(file);
      setPendingSchema(applyFriendlyColumnMappings(schema, file.name));
      setPendingRows(rows);
      setIsImportOpen(true);
    } catch (error) {
      console.error('Failed to read CSV:', error);
      onReadError?.(file.name, error);
    } finally {
      updateLongTaskProgress(null);
      setIsLoadingRows(false);
    }
  }, [onReadError, readCSVBuffer, setIsLoadingRows, updateLongTaskProgress]);

  /**
   * Runs an import with the long-task overlay. `perform` reports steps through `progress`; on success
   * the dialog closes, on failure its message is shown in the dialog.
   */
  const runImport = useCallback(async (title: string, perform: (progress: ImportProgress) => Promise<void>) => {
    const progress: ImportProgress = async (detail, completed, options) => {
      updateLongTaskProgress({ title, detail, completed, total: IMPORT_STEP_COUNT, indeterminate: options?.indeterminate });
      await waitForNextPaint();
    };
    try {
      setImportError(null);
      setIsImportSubmitting(true);
      setIsLoadingRows(true);
      await progress('Preparing import settings', 1);
      await perform(progress);
      await progress('Finishing import', IMPORT_STEP_COUNT);
      closeImport();
    } catch (error) {
      console.error('Failed to import/merge CSV:', error);
      setImportError(error instanceof Error ? error.message : 'Failed to import or merge the CSV. Please try again.');
    } finally {
      updateLongTaskProgress(null);
      setIsImportSubmitting(false);
      setIsLoadingRows(false);
    }
  }, [closeImport, setIsLoadingRows, updateLongTaskProgress]);

  return {
    isImportOpen,
    setIsImportOpen,
    pendingFile,
    pendingSchema,
    pendingRows,
    importError,
    setImportError,
    isImportSubmitting,
    clearPendingImport,
    closeImport,
    openCsvForImport,
    runImport,
  };
}
