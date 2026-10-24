import type { ViewScope } from '../../types';

/** The bottom status bar: how many rows are shown, whether filters apply, and the selection size. */
export function StatusFooter({
  hasLoadedData,
  viewScope,
  displayedRowCount,
  totalRowCount,
  isFilteringActive,
  selectedVideoCount,
  isEngineReady,
}: {
  hasLoadedData: boolean;
  viewScope: ViewScope;
  displayedRowCount: number;
  totalRowCount: number;
  isFilteringActive: boolean;
  selectedVideoCount: number;
  /** DuckDB (used to parse CSVs) loads in the background after the app appears. */
  isEngineReady: boolean;
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
        <span className={`h-1.5 w-1.5 rounded-full ${isEngineReady ? 'bg-green-500' : 'animate-pulse bg-amber-500'}`} />
        DuckDB-Wasm Engine: {isEngineReady ? 'Active' : 'Loading…'}
      </div>
    </footer>
  );
}
