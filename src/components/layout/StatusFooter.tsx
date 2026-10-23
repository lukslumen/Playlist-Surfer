import type { ViewScope } from '../../types';

/** The bottom status bar: how many rows are shown, whether filters apply, and the selection size. */
export function StatusFooter({
  hasLoadedData,
  viewScope,
  displayedRowCount,
  totalRowCount,
  isFilteringActive,
  selectedVideoCount,
}: {
  hasLoadedData: boolean;
  viewScope: ViewScope;
  displayedRowCount: number;
  totalRowCount: number;
  isFilteringActive: boolean;
  selectedVideoCount: number;
}) {
  return (
    <footer className="status-footer flex h-6 flex-shrink-0 items-center justify-between border-t border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 text-[11px] text-[var(--text-muted)]">
      <div>
        {hasLoadedData ? (
          <span>{viewScope === 'channels' ? 'Channels' : 'Videos'}: showing <b className="text-[var(--text-main)]">{displayedRowCount.toLocaleString()}</b> of {totalRowCount.toLocaleString()} rows</span>
        ) : 'No rows loaded'}
        {isFilteringActive && ' (Filtering Active)'}
        {viewScope === 'videos' && selectedVideoCount > 0 && (
          <span>
            {' - '}<b className="text-[var(--text-main)]">{selectedVideoCount.toLocaleString()}</b> selected
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        DuckDB-Wasm Engine: Active
      </div>
    </footer>
  );
}
