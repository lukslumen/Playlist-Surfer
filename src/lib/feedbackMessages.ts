import type { InclusionActionResult } from '../state/useInclusion';
import type { ToastOptions } from '../components/toast/ToastProvider';

export function errorDetail(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return undefined;
}

const plural = (count: number) => `${count.toLocaleString()} video${count === 1 ? '' : 's'}`;

/**
 * Feedback after exclude/restore. A full success needs none (the grid changes); say something when
 * nothing moved, or when only part of the selection did.
 */
export function describeInclusionResult(result: InclusionActionResult): ToastOptions | null {
  const excluding = result.kind === 'exclude';
  const already = excluding ? 'already excluded' : 'already included';
  if (result.changedCount === 0) {
    return {
      kind: 'warning',
      key: 'inclusion-result',
      message: excluding ? 'Nothing was excluded' : 'Nothing was restored',
      detail: `The selected ${result.requestedCount === 1 ? 'video is' : 'videos are'} ${already} or not part of this dataset.`,
    };
  }
  if (result.skippedCount > 0) {
    return {
      kind: 'info',
      key: 'inclusion-result',
      message: `${excluding ? 'Excluded' : 'Restored'} ${plural(result.changedCount)} of ${result.requestedCount.toLocaleString()}`,
      detail: `${plural(result.skippedCount)} ${result.skippedCount === 1 ? 'was' : 'were'} ${already} or not part of this dataset.`,
    };
  }
  return null;
}

export function readFailedToast(fileName: string, error: unknown): ToastOptions {
  return { kind: 'error', message: `Couldn't read ${fileName}`, detail: errorDetail(error) ?? 'The file could not be parsed as CSV.' };
}

export function restoreFailedToast(fileName: string, error: unknown): ToastOptions {
  return { kind: 'error', message: `Couldn't restore ${fileName}`, detail: errorDetail(error) ?? 'The backup could not be read.' };
}

export function autosaveRestoreFailedToast(error: unknown): ToastOptions {
  return {
    kind: 'error',
    key: 'autosave-restore',
    message: "Couldn't reopen your last project",
    detail: `${errorDetail(error) ? `${errorDetail(error)} ` : ''}Import the CSV or a project backup to continue.`,
  };
}

export function saveFailedToast(what: 'state' | 'rows', error: unknown): ToastOptions {
  return {
    kind: 'error',
    key: 'save-failed',
    message: what === 'state' ? "Couldn't save your notes, tags and exclusions in this browser" : "Couldn't save the dataset in this browser",
    detail: `They may be lost on reload. Export a project backup to keep your work.${errorDetail(error) ? ` (${errorDetail(error)})` : ''}`,
  };
}
