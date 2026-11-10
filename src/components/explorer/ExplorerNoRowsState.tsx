import type { InclusionView } from '../../types';

interface ExplorerNoRowsStateProps {
  isChannelScope?: boolean;
  onClearFilters?: () => void;
  /** Only passed when some sources are hidden. */
  onShowAllSources?: () => void;
  onToggleInclusionView?: () => void;
  inclusionView?: InclusionView;
}

const secondaryButtonClass = 'border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--grid-hover)]';

/** Shown over the table or the thumbnails when data is loaded but the current view hides every row. */
export function ExplorerNoRowsState({ isChannelScope = false, onClearFilters, onShowAllSources, onToggleInclusionView, inclusionView }: ExplorerNoRowsStateProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_82%,transparent)] p-6">
      <div className="pointer-events-auto w-full max-w-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 text-center shadow-sm">
        <p className="text-lg font-semibold text-[var(--text-main)]">No rows to show</p>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
          Data is loaded, but current view filters/scope settings hide all rows.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onClearFilters ? (
            <button
              type="button"
              onClick={onClearFilters}
              className="border border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_14%,transparent)]"
            >
              {isChannelScope ? 'Reset channel filters' : 'Clear filters'}
            </button>
          ) : null}
          {onShowAllSources ? (
            <button type="button" onClick={onShowAllSources} className={secondaryButtonClass}>
              Show all sources
            </button>
          ) : null}
          {onToggleInclusionView ? (
            <button type="button" onClick={onToggleInclusionView} className={secondaryButtonClass}>
              Switch to {inclusionView === 'included' ? 'Excluded' : 'Included'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
